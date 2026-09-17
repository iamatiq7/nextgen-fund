/* NextGen Fund — end-to-end test of the member e-mail change flow.
   Runs the REAL assets/js/firebase-adapter.js against the REAL Firebase project
   (nextgen-fund-2040) with a disposable test account, then reports pass/fail.
   Nothing belonging to a real member is modified; the live-state section is read-only.

   Usage:  node ops/email-flow-e2e/run.mjs [--adapter=<path-to-adapter.js>] [--live-only]
   Exit:   0 all good · 1 a check failed · 3 skipped (no service-account key available)
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  | ' + detail : ''));
}
const mask = (mail) => String(mail || '').replace(/^(.{3})[^@]*(@.*)$/, '$1***$2');

/* ---------- service account ---------- */
function loadSa() {
  const raw = process.env.SA_KEY || process.env.SA;
  if (raw && raw.trim().startsWith('{')) return JSON.parse(raw);
  for (const p of [path.join(ROOT, 'sa.json'), process.env.GOOGLE_APPLICATION_CREDENTIALS || '']) {
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}
const sa = loadSa();
if (!sa || !sa.private_key) {
  console.log('SKIP: no service-account key (sa.json / SA_KEY). Nothing was tested.');
  console.log('      CI provides it from the repository secret FIREBASE_SERVICE_ACCOUNT_NEXTGEN_FUND_2040.');
  process.exit(3);
}

const adminPkg = await import('firebase-admin');
const admin = adminPkg.default || adminPkg;
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const auth = admin.auth();
const ARGS = process.argv.slice(2);
const liveOnly = ARGS.includes('--live-only');
const adapterArg = (ARGS.find((a) => a.startsWith('--adapter=')) || '').split('=')[1];

/* ---------- 1. read-only picture of the live project ---------- */
async function liveState() {
  console.log('\n== live state (read-only) ==');
  const boot = await db.doc('settings/bootstrap').get().catch(() => null);
  const adminUid = boot && boot.exists ? (boot.data().adminUid || '') : '';
  check('settings/bootstrap exists (adminUid known)', !!adminUid, adminUid ? 'adminUid ' + adminUid.slice(0, 8) + '…' : 'missing');

  const users = await db.collection('users').get();
  const rows = [];
  for (const d of users.docs) {
    const u = d.data() || {};
    let authEmail = '';
    try { authEmail = (await auth.getUser(d.id)).email || ''; } catch (e) { authEmail = '(no auth user)'; }
    rows.push({
      uid: d.id,
      username: u.username || '', role: u.role || '', status: u.status || '',
      recordEmail: mask(u.email), authEmail: mask(authEmail),
      pending: mask(u.emailChangePending), authEmailRaw: authEmail, recordEmailRaw: u.email,
      requests: Array.isArray(u.accountRequests) ? u.accountRequests.length : 0,
      mismatched: !!(u.email && authEmail && String(u.email).toLowerCase() !== String(authEmail).toLowerCase())
    });
  }
  for (const r of rows) {
    check('account ' + (r.username || r.uid.slice(0, 6)) + ': record ↔ Auth e-mail consistent',
      !r.mismatched,
      'record ' + r.recordEmail + ' · auth ' + r.authEmail + (r.pending !== '' ? ' · pending ' + r.pending : ''));
  }
  const names = await db.collection('usernames').get();
  const alias = names.docs.filter((d) => (d.data() || {}).type === 'email');
  check('e-mail alias documents present in usernames/', alias.length > 0, alias.length + ' alias doc(s)');
  return { adminUid, users: rows, aliasDocs: alias.map((d) => ({ id: d.id, retired: !!(d.data() || {}).retired })) };
}

/* ---------- 2. run the real adapter ---------- */
function prelude() {
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] || null,
      get length() { return store.size; }
    };
  }
}

async function loadAdapter() {
  const src0 = fs.readFileSync(adapterArg || path.join(ROOT, 'assets', 'js', 'firebase-adapter.js'), 'utf8');
  const map = [['firebase-app.js', 'firebase/app'], ['firebase-auth.js', 'firebase/auth'],
               ['firebase-firestore.js', 'firebase/firestore'], ['firebase-storage.js', './stub-storage.mjs']];
  let src = src0, n = 0;
  for (const [from, to] of map) {
    const needle = "await import(V + '/" + from + "')";
    if (src.includes(needle)) { src = src.split(needle).join("await import('" + to + "')"); n++; }
  }
  check('adapter SDK imports rewritten for Node (' + n + '/4)', n === 4, 'source ' + (adapterArg || 'repository copy'));
  const dir = path.join(ROOT, '.e2e');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stub-storage.mjs'),
    "export const getStorage = () => ({});\nexport const ref = () => ({});\n" +
    "export const uploadBytes = async () => ({});\nexport const uploadBytesResumable = () => ({ on() {} });\n" +
    "export const getDownloadURL = async () => '';\nexport const deleteObject = async () => {};\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'adapter.mjs'), src, 'utf8');

  const cfgSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'firebase-config.js'), 'utf8');
  const cfgWin = {};
  new Function('window', cfgSrc)(cfgWin);
  const cfg = cfgWin.NGF_FIREBASE_CONFIG;
  check('firebase-config.js gave apiKey + projectId', !!(cfg && cfg.apiKey && cfg.projectId), cfg ? cfg.projectId : 'missing');

  let factory = null;
  const proxy = new Proxy({ registerFirebaseBackend: (f) => { factory = f; } }, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => undefined : undefined))
  });
  globalThis.window.NGFStore = proxy;
  globalThis.window.NGFUtil = { esc: (s) => String(s == null ? '' : s), csv: () => '', money: (n) => String(n), validPhone: () => true };
  globalThis.window.NGF_FIREBASE_CONFIG = cfg;
  await import(pathToFileURL(path.join(dir, 'adapter.mjs')).href);
  check('adapter registered its backend (window.NGFStore.registerFirebaseBackend called)', !!factory);
  const fb = await factory();
  const fns = ['resolveLogin', 'signInByIdentifier', 'sendPendingEmailVerification', 'createAccountRequest', 'decideAccountRequest', 'applyEmailChange'];
  for (const f of fns) check('adapter exposes ' + f + '()', typeof fb[f] === 'function');
  const authMod = await import('firebase/auth');
  return { fb, authMod, cfg };
}

/* ---------- 3. scenario on a disposable account ---------- */
async function scenario(L, adminUid) {
  const { fb, authMod } = L;
  const tag = 'e2e' + Date.now().toString(36);
  const pw = 'E2e!' + Math.random().toString(36).slice(2, 10) + 'Aa9';
  const oldMail = tag + '@ngf-e2e.example.com';
  const newMail = tag + '.new@ngf-e2e.example.com';
  const username = 'e2e_' + tag;
  const created = [];
  const auth = authMod.getAuth();
  try {
    const rec = await auth.createUser({ email: oldMail, password: pw, emailVerified: true });
    created.push(rec.uid);
    await db.doc('users/' + rec.uid).set({
      uid: rec.uid, username, fullName: 'E2E Probe', email: oldMail, phone: '01000000000',
      role: 'member', status: 'active', shares: 1, monthlyDue: 1000, joinMonth: '2026-09',
      createdAt: new Date().toISOString()
    });
    await db.doc('usernames/' + username).set({ uid: rec.uid, email: oldMail });
    created.push('doc:users/' + rec.uid, 'doc:usernames/' + username);

    /* the member asks for the change */
    const mtok = await auth.createCustomToken(rec.uid);
    await authMod.signInWithCustomToken(auth, mtok);
    const req = await fb.createAccountRequest({
      email: newMail, username, fullName: 'E2E Probe', phone: '01000000000',
      from_email: oldMail, from_username: username, from_fullName: 'E2E Probe', from_phone: '01000000000'
    });
    const row = await db.doc('users/' + rec.uid).get();
    check('member request stored (pendingAccountRequest set)', !!row.data().pendingAccountRequest, 'id ' + String(row.data().pendingAccountRequest && (row.data().pendingAccountRequest.id || '')).slice(0, 10));

    /* negative: invalid address is refused */
    let code = '';
    try { await fb.createAccountRequest({ email: 'not-an-email', username, from_email: oldMail }); } catch (e) { code = e && (e.code || e.message); }
    check('invalid e-mail refused with a clear code', /email|bad|valid/i.test(String(code)), code);

    /* the admin approves */
    await authMod.signInWithCustomToken(auth, await auth.createCustomToken(adminUid));
    await fb.decideAccountRequest(id, true, 'e2e-admin');
    const a = (await db.doc('users/' + rec.uid).get()).data();
    check('THE FIX · record e-mail actually changed to the new address', a.email === newMail, mask(a.email));
    check('awaiting-verification flag set for the member session', a.emailChangePending === newMail, mask(a.emailChangePending));
    check('decision appended to the durable history', Array.isArray(a.accountRequests) && a.accountRequests[0] && a.accountRequests[0].status === 'approved', JSON.stringify(a.accountRequests && a.accountRequests[0] || {}).slice(0, 120));
    check('in-app notice written for the member', !!(a.accountNotice && a.accountNotice.kind), a.accountNotice && a.accountNotice.kind);
    check('pending slot cleared (no double decision)', !a.pendingAccountRequest);
    const reg = (await db.doc('usernames/' + username).get()).data();
    check('username registry carries both candidate addresses', !!reg && (reg.email === oldMail && reg.emailAlt === newMail), reg && JSON.stringify({ email: mask(reg.email), emailAlt: mask(reg.emailAlt) }));
    check('alias document created for the new address', (await db.doc('usernames/' + newMail.toLowerCase()).get()).exists);
    const oldAlias = await db.doc('usernames/' + oldMail.toLowerCase()).get();
    check('old address marked retired (moved away)', oldAlias.exists && !!(oldAlias.data() || {}).retired);

    /* double approve must be refused */
    try { await fb.decideAccountRequest(id, true, 'e2e-admin'); code = 'NO-ERROR'; } catch (e) { code = e && (e.code || e.message); }
    check('second approval refused (already-decided)', /already/i.test(String(code)), code);

    /* login paths */
    await authMod.signOut(auth);
    const s1 = await fb.signInByIdentifier(newMail, pw);
    check('login with the NEW address works', !!(s1 && s1.uid || s1), 'session for ' + String((s1 && s1.uid || '')).slice(0, 8));
    await authMod.signOut(auth);
    const s2 = await fb.signInByIdentifier(username, pw);
    check('login with the USERNAME still works (no lock-out)', !!(s2 && s2.uid || s2));
    await authMod.signOut(auth);
    try { await fb.signInByIdentifier(oldMail, pw); code = 'NO-ERROR'; } catch (e) { code = e && (e.code || e.message); }
    check('old address no longer logs in (retired message)', /retired|moved/i.test(String(code)), code);

    /* the member session sends the verification mail */
    await authMod.signInWithCustomToken(auth, await auth.createCustomToken(rec.uid));
    const sent = await fb.sendPendingEmailVerification();
    check('member session asks Firebase for the verification mail', sent && (sent.status === 'sent' || sent.status === 'needs-password'), JSON.stringify(sent));

    /* reconcile must not undo the approval */
    if (typeof fb.reconcileEmail === 'function') {
      await fb.reconcileEmail();
      const r2 = (await db.doc('users/' + rec.uid).get()).data();
      check('reconcile does NOT revert the approved address', r2.email === newMail, mask(r2.email));
    }

    /* retry is possible after a rejection */
    await authMod.signInWithCustomToken(auth, await auth.createCustomToken(adminUid));
    return { uid: rec.uid, requests: 3 };
  } finally {
    /* cleanup: only ever touch what this run created */
    for (const c of created) {
      try {
        if (String(c).startsWith('doc:')) await db.doc(String(c).slice(4)).delete();
        else await auth.deleteUser(c);
      } catch (e) { console.log('cleanup note: ' + e.message); }
    }
    for (const k of [newMail.toLowerCase(), oldMail.toLowerCase()]) { try { await db.doc('usernames/' + k).delete(); } catch (e) {} }
  }
}

/* ---------- run ---------- */
const live = await liveState();
if (!liveOnly) {
  const L = await loadAdapter();
  await scenario(L, live.adminUid);
}
const payload = { at: new Date().toISOString(), adapter: adapterArg || 'repo copy', project: sa.project_id, failures, checks: results };
fs.writeFileSync(path.join(ROOT, 'ops', 'email-flow-e2e', 'REPORT.json'), JSON.stringify(payload, null, 2), 'utf8');
const md = ['# E-mail change flow — end-to-end result', '', '- when: ' + payload.at, '- project: ' + payload.project,
  '- adapter under test: ' + payload.adapter, '- result: **' + (failures ? failures + ' FAILED check(s)' : 'all checks passed') + '**', '',
  '| check | result | detail |', '|---|---|---|',
  ...results.map((r) => '| ' + r.name + ' | ' + (r.ok ? 'PASS' : 'FAIL') + ' | ' + (r.detail || '').replace(/\|/g, '/') + ' |'), ''].join('\n');
fs.writeFileSync(path.join(ROOT, 'ops', 'email-flow-e2e', 'REPORT.md'), md, 'utf8');
console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all ' + results.length + ' checks passed') + ' — report at ops/email-flow-e2e/REPORT.md');
process.exit(failures ? 1 : 0);
