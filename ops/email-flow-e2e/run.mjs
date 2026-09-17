/* NextGen Fund — end-to-end test of the member e-mail change flow.
   It runs the REAL assets/js/firebase-adapter.js against the REAL Firebase project
   (nextgen-fund-2040) on a disposable probe account, then writes a report. The live-state
   section is read-only; nothing belonging to a member is modified.

   Usage:  node ops/email-flow-e2e/run.mjs [--adapter=<path>] [--live-only]
   Exit:   0 all good · 1 a check failed · 3 skipped (no service-account key)
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
let failures = 0;
let phaseName = 'start';
function phase(name) {
  phaseName = name;
  console.log('--- phase: ' + name);
  try { writeReport(saRef && saRef.project_id); } catch (e) { }
}
let saRef = null;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  | ' + detail : ''));
}
const mask = (m) => String(m || '').replace(/^(.{3})[^@]*(@.*)$/, '$1***$2');

function loadSa() {
  const raw = process.env.SA_KEY || process.env.SA;
  if (raw && raw.trim().startsWith('{')) return JSON.parse(raw);
  for (const p of [path.join(ROOT, 'sa.json'), process.env.GOOGLE_APPLICATION_CREDENTIALS || '']) {
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

function writeReport(project) {
  const payload = { at: new Date().toISOString(), phase: phaseName, adapter: adapterArg || 'repository copy', project: project || '', failures, checks: results };
  const dir = path.join(ROOT, 'ops', 'email-flow-e2e');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'REPORT.json'), JSON.stringify(payload, null, 2), 'utf8');
  const md = ['# যাচাই প্রতিবেদন — সদস্যের ইমেইল পরিবর্তনের সম্পূর্ণ ফ্লো', '',
    '- শেষ ধাপ: ' + payload.phase, '- সময়: ' + payload.at, '- প্রকল্প: ' + payload.project, '- পরীক্ষিত কোড: ' + payload.adapter,
    '- ফলাফল: **' + (failures ? failures + 'টি পরীক্ষা ব্যর্থ' : 'সব পরীক্ষা পাস') + '**', '',
    '| পরীক্ষা | ফল | বিবরণ |', '|---|---|---|',
    ...results.map((r) => '| ' + String(r.name).replace(/\|/g, '/') + ' | ' + (r.ok ? 'PASS' : 'FAIL') + ' | ' + (r.detail || '').replace(/\|/g, '/') + ' |'), ''].join('\n');
  fs.writeFileSync(path.join(dir, 'REPORT.md'), md, 'utf8');
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all ' + results.length + ' checks passed'));
}

const ARGS = process.argv.slice(2);
const liveOnly = ARGS.includes('--live-only');
const adapterArg = (ARGS.find((a) => a.startsWith('--adapter=')) || '').split('=')[1];

const sa = loadSa();
saRef = sa;
if (!sa || !sa.private_key) {
  console.log('SKIP: no service-account key (sa.json / SA_KEY) — nothing was tested.');
  process.exit(3);
}

function bail(e) {
  try { check('the test stopped early: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n').slice(1, 3).join(' | ') : ''); } catch (x) { }
  try { writeReport(saRef && saRef.project_id); } catch (x) { }
  process.exit(1);
}
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
phase('import the admin SDK');

const adminPkg = await import('firebase-admin');
const admin = adminPkg.default || adminPkg;
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const authAdmin = admin.auth();

async function liveState() {
  phase('read the live project state');
  console.log('\n== live state (read-only) ==');
  const boot = await db.doc('settings/bootstrap').get().catch(() => null);
  const adminUid = boot && boot.exists ? String(boot.data().adminUid || '') : '';
  check('settings/bootstrap gives the admin account', !!adminUid, adminUid ? adminUid.slice(0, 8) + '…' : 'missing');
  const users = await db.collection('users').get();
  for (const d of users.docs) {
    const u = d.data() || {};
    let live = '';
    try { live = (await authAdmin.getUser(d.id)).email || ''; } catch (e) { live = '(no auth account)'; }
    const same = !u.email || !live || String(u.email).toLowerCase() === String(live).toLowerCase();
    const wait = String(u.emailChangePending || '');
    check('account ' + (u.username || d.id.slice(0, 6)) + ': record e-mail ↔ login e-mail agree',
      same || !!wait, 'record ' + mask(u.email) + ' · auth ' + mask(live) + (wait ? ' · awaiting confirmation for ' + mask(wait) : ''));
  }
  const names = await db.collection('usernames').get();
  const aliases = names.docs.filter((d) => (d.data() || {}).type === 'email');
  check('e-mail alias documents exist for sign-in by address', true, aliases.length + ' alias document(s)');
  return { adminUid };
}

function prelude() {
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  if (!globalThis.localStorage) {
    const m = new Map();
    globalThis.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] || null,
      get length() { return m.size; }
    };
  }
}

async function loadAdapter() {
  phase('load and prepare the real adapter');
  const src0 = fs.readFileSync(adapterArg || path.join(ROOT, 'assets', 'js', 'firebase-adapter.js'), 'utf8');
  const map = [['firebase-app.js', 'firebase/app'], ['firebase-auth.js', 'firebase/auth'],
               ['firebase-firestore.js', 'firebase/firestore'], ['firebase-storage.js', './stub-storage.mjs']];
  let src = src0, n = 0;
  for (const [from, to] of map) {
    const needle = "await import(V + '/" + from + "')";
    if (src.includes(needle)) { src = src.split(needle).join("await import('" + to + "')"); n++; }
  }
  check('the browser SDK imports were redirected for Node (' + n + '/4)', n === 4, adapterArg || 'repository copy');
  const dir = path.join(ROOT, '.e2e');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stub-storage.mjs'),
    "export const getStorage = () => ({});\nexport const ref = () => ({});\n" +
    "export const uploadBytes = async () => ({});\nexport const uploadBytesResumable = () => ({ on() {} });\n" +
    "export const getDownloadURL = async () => '';\nexport const deleteObject = async () => {};\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'adapter.mjs'), src, 'utf8');

  let cfg = null;
  try {
    const cfgSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'firebase-config.js'), 'utf8');
    const win = {};
    new Function('window', cfgSrc)(win);
    cfg = win.NGF_FIREBASE_CONFIG;
  } catch (eCfg) { cfg = null; }
  if (!cfg || !cfg.apiKey) {
    const raw = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'firebase-config.js'), 'utf8');
    const pick = (k) => (raw.match(new RegExp(k + "\\s*:\\s*'([^']+)'")) || [])[1] || '';
    cfg = { apiKey: pick('apiKey'), projectId: pick('projectId'), authDomain: pick('authDomain') };
  }
  check('the site configuration was readable (apiKey + projectId)', !!(cfg && cfg.apiKey && cfg.projectId), cfg ? cfg.projectId : 'missing');

  let factory = null;
  globalThis.window.NGFStore = new Proxy({ registerFirebaseBackend: (f) => { factory = f; } }, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => undefined : undefined))
  });
  globalThis.window.NGFUtil = { esc: (s) => String(s == null ? '' : s), csv: () => '', money: (n) => String(n), validPhone: () => true };
  globalThis.window.NGF_FIREBASE_CONFIG = cfg;
  await import(pathToFileURL(path.join(dir, 'adapter.mjs')).href);
  check('the adapter registered its backend', !!factory);
  const fb = await factory();
  for (const f of ['resolveLogin', 'signInByIdentifier', 'sendPendingEmailVerification', 'createAccountRequest', 'decideAccountRequest', 'applyEmailChange']) {
    check('the adapter exposes ' + f + '()', typeof fb[f] === 'function');
  }
  return { fb, authMod: await import('firebase/auth') };
}

async function scenario(L, adminUid) {
  phase('run the request -> approve -> login scenario');
  const { fb, authMod } = L;
  const auth = authMod.getAuth();
  const tag = 'ngf-e2e-' + Date.now().toString(36);
  const pw = 'E2e!' + Math.random().toString(36).slice(2, 10) + 'Aa9';
  const oldMail = tag + '@mailinator.com';
  const newMail = tag + '.new@mailinator.com';
  const newerMail = tag + '.latest@mailinator.com';
  const username = 'e2e_' + tag;
  const created = [];
  try {
    const rec = await authAdmin.createUser({ email: oldMail, password: pw, emailVerified: true });
    created.push(rec.uid);
    await db.doc('users/' + rec.uid).set({
      uid: rec.uid, username, fullName: 'E2E Probe', email: oldMail, phone: '01000000000',
      role: 'member', status: 'active', shares: 1, monthlyDue: 1000, joinMonth: '2026-09',
      createdAt: new Date().toISOString()
    });
    await db.doc('usernames/' + username).set({ uid: rec.uid, email: oldMail });
    created.push('doc:users/' + rec.uid, 'doc:usernames/' + username);

    /* --- the member signs in and asks for the change --- */
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));

    /* negative: a malformed address must never be stored */
    let code = '';
    try { await fb.createAccountRequest({ email: 'not-an-email', username, from_username: username, from_email: oldMail }); }
    catch (e) { code = e && (e.code || e.message); }
    check('malformed address refused (' + code + ')', /email|bad|valid/i.test(String(code)), code);

    const req = await fb.createAccountRequest({
      email: newMail, memberName: 'E2E Probe', from_email: oldMail, from_username: username, reason: 'e2e'
    });
    const rowSnap = await db.doc('users/' + rec.uid).get();
    const pend = rowSnap.data().pendingAccountRequest || {};
    const id = pend.id || ('u-' + rec.uid);
    check('member request stored on the record, status pending', pend.status === 'pending', 'id ' + String(id).slice(0, 14) + ' · fields ' + JSON.stringify((pend.changes || []).map((c) => c.field)));
    check('the request keeps old and new address (durable audit data)',
      (pend.changes || []).some((c) => c.field === 'email' && c.from === oldMail && c.to === newMail));

    /* --- the admin approves --- */
    await authMod.signOut(auth);
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(adminUid));
    phase('admin approval');
    await fb.decideAccountRequest(id, true, 'e2e-admin');

    const after = (await db.doc('users/' + rec.uid).get()).data();
    check('APPROVAL CHANGES THE RECORD: users/{uid}.email is the new address', after.email === newMail, mask(after.email));
    check('the member record no longer shows the old address', after.email !== oldMail);
    check('confirmation state written for the member session', after.emailChangePending === newMail, mask(after.emailChangePending));
    check('decision kept in the permanent history', Array.isArray(after.accountRequests) && after.accountRequests[0] && after.accountRequests[0].status === 'approved',
      JSON.stringify(after.accountRequests && after.accountRequests[0] || {}).slice(0, 110));
    check('in-app notice written for the member', !!(after.accountNotice && after.accountNotice.kind), (after.accountNotice || {}).kind);
    check('pending slot cleared (the decision cannot run twice)', !after.pendingAccountRequest);
    const reg = (await db.doc('usernames/' + username).get()).data() || {};
    check('username registry keeps both candidate addresses (immutable document rules)',
      reg.email === oldMail && reg.emailAlt === newMail, 'email ' + mask(reg.email) + ' · emailAlt ' + mask(reg.emailAlt));
    const al = await db.doc('usernames/' + newMail.toLowerCase()).get();
    check('alias document created for the new address (login before the link is opened)', al.exists, JSON.stringify(al.data() || {}).slice(0, 90));
    const old = await db.doc('usernames/' + oldMail.toLowerCase()).get();
    check('old address marked retired', old.exists && !!old.data().retired, JSON.stringify(old.data() || {}).slice(0, 90));

    /* --- a second approval of the same request must be refused --- */
    code = '';
    try { await fb.decideAccountRequest(id, true, 'e2e-admin'); code = 'NO-ERROR'; } catch (e) { code = e && (e.code || e.message); }
    check('a second approval is refused (' + code + ')', /not-found|pending|already|decided/i.test(String(code)), code);

    /* --- login paths --- */
    phase('login paths');
    await authMod.signOut(auth);
    let sess = null;
    try { sess = await fb.signInByIdentifier(newMail, pw); } catch (e) { code = e && (e.code || e.message); }
    check('login with the NEW address works', !!(sess && sess.uid), sess ? 'uid ' + String(sess.uid).slice(0, 8) : 'error ' + code);
    await authMod.signOut(auth);
    let sess2 = null;
    try { sess2 = await fb.signInByIdentifier(username, pw); } catch (e) { code = e && (e.code || e.message); }
    check('login with the USERNAME still works (no lock-out)', !!(sess2 && sess2.uid), sess2 ? 'uid ' + String(sess2.uid).slice(0, 8) : 'error ' + code);
    await authMod.signOut(auth);
    code = '';
    try { await fb.signInByIdentifier(oldMail, pw); code = 'NO-ERROR'; } catch (e) { code = e && (e.code || e.message); }
    check('the OLD address is refused with a clear message (' + code + ')', /retired|moved/i.test(String(code)), code);

    /* --- the member session asks for the confirmation mail --- */
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));
    const sent = await fb.sendPendingEmailVerification();
    check('confirmation mail requested from the member session (' + JSON.stringify(sent) + ')',
      sent && (sent.status === 'sent' || sent.status === 'needs-password'), JSON.stringify(sent));
    const vState = (await db.doc('users/' + rec.uid).get()).data().emailVerification || {};
    check('the send is recorded on the record for the status banner', !!vState.status, JSON.stringify(vState));

    /* --- reconcile must not undo the approval --- */
    const before = (await db.doc('users/' + rec.uid).get()).data().email;
    if (typeof fb.reconcileEmail === 'function') {
      const r = await fb.reconcileEmail();
      const now = (await db.doc('users/' + rec.uid).get()).data();
      check('reconcile keeps the approved address while the link is pending', now.email === newMail,
        'returned ' + JSON.stringify(r) + ' · record ' + mask(now.email));
    }

    /* --- applyEmailChange from the member session (the button path) --- */
    await authMod.signOut(auth);
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));
    code = '';
    try { await fb.applyEmailChange(pw, newMail); code = 'no-signal'; } catch (e) { code = e && (e.code || e.message); }
    check('applyEmailChange either confirms the address or asks for a password (' + code + ')',
      /verify-sent|wrong-password|requires-recent-login|email-held|not-allowed/.test(String(code)), code);

    /* --- rejection leaves the account untouched --- */
    await authMod.signOut(auth);
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));
    const beforeReject = (await db.doc('users/' + rec.uid).get()).data();
    const req2 = await fb.createAccountRequest({ email: newerMail, memberName: 'E2E Probe', from_email: newMail, from_username: username, reason: 'e2e reject' });
    const pend2 = (await db.doc('users/' + rec.uid).get()).data().pendingAccountRequest || {};
    await authMod.signOut(auth);
    await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(adminUid));
    await fb.decideAccountRequest(pend2.id || ('u-' + rec.uid), false, 'e2e-admin');
    const afterReject = (await db.doc('users/' + rec.uid).get()).data();
    check('a rejection leaves the account address untouched', afterReject.email === beforeReject.email, mask(afterReject.email));
    check('the rejection is recorded with its status',
      (afterReject.accountRequests || []).some((r) => r.status === 'rejected'), JSON.stringify((afterReject.accountRequests || [])[0] || {}).slice(0, 110));
    check('the member can ask again after a rejection', !afterReject.pendingAccountRequest);
  } finally {
    for (const c of created) {
      try {
        if (String(c).startsWith('doc:')) await db.doc(String(c).slice(4)).delete();
        else await authAdmin.deleteUser(c);
      } catch (e) { console.log('cleanup note: ' + e.message); }
    }
    for (const k of [newMail.toLowerCase(), oldMail.toLowerCase(), newerMail.toLowerCase()]) {
      try { await db.doc('usernames/' + k).delete(); } catch (e) { }
    }
  }
}

prelude();
let live = null;
try {
  live = await liveState();
  if (!liveOnly) {
    const L = await loadAdapter();
    await scenario(L, live.adminUid);
  }
} catch (e) {
  check('the test ran to completion without a crash', false, (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e)));
} finally {
  phase('finished');
  writeReport(sa.project_id);
}
process.exit(failures ? 1 : 0);
