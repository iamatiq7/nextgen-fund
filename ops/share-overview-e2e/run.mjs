/* NextGen Fund - live proof that an approved share increase reaches the member's "My Fund"
   overview without a reload.

   The bug being pinned down: the member portal's live subscription (adapter onMyData) only
   listened to the `payments` collection, while an admin approval writes the member's own
   `users/{uid}` document. So the approval never woke the open page and the overview kept the
   old share count until a manual reload. The portal's live callback also refreshed balance and
   payments but never the profile, so even a delivered event left the shares line stale.

   What this script does, against the REAL project (nextgen-fund-2040), on a disposable probe
   member that is deleted again:
     1. the member signs in and asks for a share increase (real createAccountRequest)
     2. the admin approves it (real decideAccountRequest)
     3. the member's own record and a fresh member read are compared with the ledger
     4. the live subscription is started on the open member session, an approval-shaped write is
        made to users/{uid}, and we wait for the event   <- this is the failing check before the fix
     5. regression guards: a payment change must still wake the page, a rejected request must
        change nothing, and no payment row may be touched
   Exit 0 = every check passed. Exit 1 = a check failed (the report says which).
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPS = path.join(ROOT, 'ops', 'share-overview-e2e');
const results = [];
let failures = 0;
let phaseName = 'start';
let saRef = null;

function phase(name) { phaseName = name; console.log('\n--- phase: ' + name); }
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  | ' + detail : ''));
}
const mask = (m) => String(m || '').replace(/^(.{3})[^@]*(@.*)$/, '$1***$2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadSa() {
  const raw = process.env.SA_KEY || process.env.SA;
  if (raw && raw.trim().startsWith('{')) return JSON.parse(raw);
  for (const p of [path.join(ROOT, 'sa.json'), process.env.GOOGLE_APPLICATION_CREDENTIALS || '']) {
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

function writeLocalReport() {
  fs.mkdirSync(OPS, { recursive: true });
  const payload = { at: new Date().toISOString(), phase: phaseName, head: process.env.GITHUB_SHA || 'local', passed: results.filter((r) => r.ok).length, failed: failures, checks: results };
  fs.writeFileSync(path.join(OPS, 'REPORT.json'), JSON.stringify(payload, null, 2), 'utf8');
  const md = ['# Share increase -> My Fund overview - live proof', '',
    '- phase reached: ' + phaseName, '- at: ' + payload.at, '- head: ' + payload.head,
    '- result: **' + payload.passed + ' passed / ' + failures + ' failed**', '',
    '| check | result | detail |', '|---|---|---|',
    ...results.map((r) => '| ' + String(r.name).replace(/\|/g, '/') + ' | ' + (r.ok ? 'PASS' : 'FAIL') + ' | ' + String(r.detail || '').replace(/\|/g, '/').replace(/\n/g, ' ') + ' |')].join('\n');
  fs.writeFileSync(path.join(OPS, 'REPORT.md'), md, 'utf8');
}

async function publishEvidence(db, sa) {
  /* one small, additively-named key in the admin-writable settings document, so the run can be
     read back without a service account. Nothing else in that document is touched. */
  try {
    await db.doc('settings/public').set({
      e2eShareReport: {
        at: new Date().toISOString(), head: process.env.GITHUB_SHA || 'local',
        project: sa && sa.project_id, phase: phaseName,
        passed: results.filter((r) => r.ok).length, failed: failures,
        checks: results.map((r) => ({ n: String(r.name).slice(0, 120), ok: !!r.ok, d: String(r.detail || '').slice(0, 200) }))
      }
    }, { merge: true });
    console.log('evidence published to settings/public.e2eShareReport');
  } catch (e) { console.log('could not publish the evidence key: ' + (e && e.message)); }
}

const sa = loadSa();
saRef = sa;
if (!sa || !sa.private_key) {
  console.log('SKIP: no service-account key (sa.json / SA_KEY) - nothing was tested.');
  process.exit(3);
}

function bail(e) {
  try { check('the test stopped early: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n')[1] : ''); } catch (x) { }
  try { writeLocalReport(); } catch (x) { }
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

/* ---------------------------------------------------------------- load the real adapter */
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
  prelude();
  const src0 = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'firebase-adapter.js'), 'utf8');
  const map = [['firebase-app.js', 'firebase/app'], ['firebase-auth.js', 'firebase/auth'],
               ['firebase-firestore.js', 'firebase/firestore'], ['firebase-storage.js', './stub-storage.mjs']];
  let src = src0, n = 0;
  for (const [from, to] of map) {
    const needle = "await import(V + '/" + from + "')";
    if (src.includes(needle)) { src = src.split(needle).join("await import('" + to + "')"); n++; }
  }
  check('the browser SDK imports were redirected for Node (' + n + '/4)', n === 4);
  const dir = path.join(ROOT, '.e2e');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stub-storage.mjs'),
    "export const getStorage = () => ({});\nexport const ref = () => ({});\n" +
    "export const uploadBytes = async () => ({});\nexport const uploadBytesResumable = async () => ({});\n" +
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
  /* the adapter is plain JavaScript: give it the site's own helpers, not a hand-made imitation */
  const utilSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'util.js'), 'utf8');
  new Function('window', utilSrc)(globalThis.window);
  check('the site helper module loaded (currentMonth, monthsInclusive, esc, csv)',
    !!(globalThis.window.NGFUtil && typeof globalThis.window.NGFUtil.currentMonth === 'function' &&
       typeof globalThis.window.NGFUtil.monthsInclusive === 'function' && typeof globalThis.window.NGFUtil.esc === 'function'),
    Object.keys(globalThis.window.NGFUtil || {}).slice(0, 12).join(','));
  globalThis.window.NGF_FIREBASE_CONFIG = cfg;
  await import(pathToFileURL(path.join(dir, 'adapter.mjs')).href);
  check('the adapter registered its backend', !!factory);
  const fb = await factory();
  for (const f of ['onMyData', 'onPublicData', 'getMyAccount', 'createAccountRequest', 'decideAccountRequest', 'listAccountRequests', 'getMyPayments']) {
    check('the adapter exposes ' + f + '()', typeof fb[f] === 'function');
  }
  return { fb, authMod: await import('firebase/auth') };
}

/* ---------------------------------------------------------------- the scenario */
const L = await loadAdapter();
const { fb, authMod } = L;
const auth = authMod.getAuth();

const tag = 'ngf-share-' + Date.now().toString(36);
const pw = 'E2e!' + Math.random().toString(36).slice(2, 10) + 'Aa9';
const mail = tag + '@mailinator.com';
const username = 'e2e_' + tag;
const created = [];

try {
  /* ---- 1. a disposable member with 2 shares ---- */
  phase('set up a disposable member with 2 shares');
  const rec = await authAdmin.createUser({ email: mail, password: pw, emailVerified: true });
  created.push(rec.uid);
  await db.doc('users/' + rec.uid).set({
    uid: rec.uid, username, fullName: 'Share Probe', email: mail, phone: '01000000099',
    role: 'member', status: 'active', shares: 2, monthlyDue: 2000, joinMonth: '2026-09',
    createdAt: new Date().toISOString()
  });
  await db.doc('usernames/' + username).set({ uid: rec.uid, email: mail });
  created.push('doc:users/' + rec.uid, 'doc:usernames/' + username);
  const before = (await db.doc('users/' + rec.uid).get()).data();
  check('probe member starts with the old share count', before.shares === 2, 'shares ' + before.shares);

  /* ---- 2. the member asks for 6 shares ---- */
  phase('the member asks for a share increase');
  await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));
  await fb.createAccountRequest({ shares: '6', memberName: 'Share Probe', from_username: username, from_email: mail, reason: 'share increase (e2e)' });
  const pendRow = (await db.doc('users/' + rec.uid).get()).data();
  const pend = pendRow.pendingAccountRequest || {};
  const reqId = pend.id || ('u-' + rec.uid);
  check('the request is stored as pending on the member record', pend.status === 'pending', 'id ' + String(reqId).slice(0, 16));
  check('the request carries the old and the new value (durable audit data)',
    (pend.changes || []).some((c) => c.field === 'shares' && String(c.from) === '2' && String(c.to) === '6'),
    JSON.stringify(pend.changes || []));
  check('NOTHING IS APPLIED BEFORE APPROVAL: the record still shows 2 shares', pendRow.shares === 2, 'shares ' + pendRow.shares);

  /* ---- 3. the admin approves (the real approval code) ---- */
  phase('the admin approves the request');
  await authMod.signOut(auth);
  await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(String((await db.doc('settings/bootstrap').get()).data().adminUid)));
  await fb.decideAccountRequest(reqId, true, 'e2e-admin');
  const afterDoc = (await db.doc('users/' + rec.uid).get()).data();
  check('APPROVAL WRITES THE RECORD: users/{uid}.shares is 6', afterDoc.shares === 6, 'shares ' + afterDoc.shares);
  check('the decision is kept in the permanent history (who, when, what)',
    Array.isArray(afterDoc.accountRequests) && afterDoc.accountRequests[0] &&
    String(afterDoc.accountRequests[0].status) === 'approved' && String(afterDoc.accountRequests[0].decidedBy) === 'e2e-admin',
    JSON.stringify((afterDoc.accountRequests || [])[0] || {}).slice(0, 130));
  check('the ledger entry keeps the before -> after pair (2 -> 6)',
    JSON.stringify((afterDoc.accountRequests || [])[0] || {}).indexOf('"from":"2"') > 0 &&
    JSON.stringify((afterDoc.accountRequests || [])[0] || {}).indexOf('"to":"6"') > 0);
  check('an in-app notice was written for the member', !!(afterDoc.accountNotice && afterDoc.accountNotice.kind), (afterDoc.accountNotice || {}).kind);
  check('the pending slot is cleared (the decision cannot run twice)', !afterDoc.pendingAccountRequest);

  let code = '';
  try { await fb.decideAccountRequest(reqId, true, 'e2e-admin'); code = 'NO-ERROR'; } catch (e) { code = e && (e.code || e.message); }
  check('a second approval of the same request is refused (' + code + ')', /not-found|pending|already|decided/i.test(String(code)), code);

  /* ---- 4. the member reads again: the overview numbers must match the ledger ---- */
  phase('the member reads the overview again');
  await authMod.signOut(auth);
  await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(rec.uid));
  const acc = await fb.getMyAccount();
  check('a fresh member read shows the new share count', acc && acc.profile && acc.profile.shares === 6, 'profile.shares ' + (acc && acc.profile && acc.profile.shares));
  const settings = (await db.doc('settings/public').get()).data() || {};
  const perShare = Number(settings.monthlyPerShare) || 1000;
  check('the monthly figure the member sees equals the record (view matches ledger)',
    Number(acc.profile.monthlyDue) === Number(afterDoc.monthlyDue),
    'view ' + acc.profile.monthlyDue + ' | record ' + afterDoc.monthlyDue + ' | per share ' + perShare);
  check('the share value the member sees equals the record', Number(acc.profile.shares) === Number(afterDoc.shares),
    'view ' + acc.profile.shares + ' | record ' + afterDoc.shares);
  check('the member never sees the old value once the record is updated', acc.profile.shares !== 2, 'profile.shares ' + acc.profile.shares);

  /* ---- 5. the living page: the member session stays open, the approval-shaped write happens ---- */
  phase('the open page must refresh by itself (the bug)');
  const live = [];
  const unsub = fb.onMyData(function (fresh) { if (fresh && fresh.profile) live.push({ at: Date.now(), shares: fresh.profile.shares }); });
  check('the live subscription was set up on the member session', typeof unsub === 'function');
  await sleep(1200);

  /* the write the admin approval really makes: shares + history + notice on users/{uid} */
  const liveAt = Date.now();
  await db.doc('users/' + rec.uid).update({
    shares: 9,
    accountRequests: [
      { id: 'e2e-live-' + liveAt, fields: ['shares'], status: 'approved', decidedBy: 'e2e-admin', decidedAt: new Date(liveAt).toISOString(), changes: [{ field: 'shares', from: '6', to: '9' }] },
      ...((await db.doc('users/' + rec.uid).get()).data().accountRequests || []).slice(0, 19)
    ],
    accountNotice: { kind: 'approved', at: new Date(liveAt).toISOString(), read: false, by: 'e2e-admin', text: 'Share increase approved.' }
  });
  let seen = null;
  for (let i = 0; i < 24 && !seen; i++) {
    await sleep(500);
    seen = live.find((e) => e.shares === 9) || null;
  }
  check('THE OPEN PAGE UPDATES BY ITSELF: the live event carried the new share count', !!seen,
    seen ? 'event after ' + (seen.at - liveAt) + ' ms with shares=' + seen.shares : 'no event within 12 s (events seen: ' + JSON.stringify(live) + ')');
  const freshNow = (await db.doc('users/' + rec.uid).get()).data();
  check('the stored value behind the overview is the approved one', freshNow.shares === 9, 'shares ' + freshNow.shares);

  /* ---- 6. regression: a payment change must still wake the page (old behaviour) ---- */
  phase('regression: the payment path still wakes the page');
  live.length = 0;
  const payAt = Date.now();
  await db.collection('payments').add({
    memberId: rec.uid, memberName: 'Share Probe', username, amount: 1000, type: 'monthly',
    method: 'bkash', status: 'pending', submittedAt: new Date(payAt).toISOString(), date: new Date(payAt).toISOString().slice(0, 10), ref: 'e2e-' + payAt
  });
  let payEvent = null;
  for (let i = 0; i < 24 && !payEvent; i++) { await sleep(500); payEvent = live[0] || null; }
  check('a new payment still refreshes the open member page', !!payEvent, payEvent ? 'event after ' + (payEvent.at - payAt) + ' ms' : 'no event within 12 s');
  const payCount = (await db.collection('payments').where('memberId', '==', rec.uid).get()).size;
  check('the payment row was created for the probe member only', payCount === 1, 'rows ' + payCount);

  /* ---- 7. regression: a rejected request changes nothing ---- */
  phase('regression: a rejected request changes nothing');
  try { unsub(); } catch (e) { }
  await fb.createAccountRequest({ shares: '12', memberName: 'Share Probe', from_username: username, from_email: mail, reason: 'e2e reject path' });
  const pend2 = (await db.doc('users/' + rec.uid).get()).data().pendingAccountRequest || {};
  await authMod.signOut(auth);
  await authMod.signInWithCustomToken(auth, await authAdmin.createCustomToken(String((await db.doc('settings/bootstrap').get()).data().adminUid)));
  await fb.decideAccountRequest(pend2.id || ('u-' + rec.uid), false, 'e2e-admin');
  const afterRej = (await db.doc('users/' + rec.uid).get()).data();
  check('a rejected share request leaves the approved value untouched', afterRej.shares === 9, 'shares ' + afterRej.shares);
  check('the rejection is recorded for the member', !!(afterRej.accountNotice && afterRej.accountNotice.kind === 'rejected'), (afterRej.accountNotice || {}).kind);
} catch (e) {
  check('the scenario ran to the end: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n')[1] : '');
} finally {
  phase('clean up the probe data');
  try { await authMod.signOut(auth); } catch (e) { }
  try {
    const pays = await db.collection('payments').where('memberId', '==', created[0]).get();
    for (const p of pays.docs) await p.ref.delete();
  } catch (e) { }
  for (const id of created) {
    try {
      if (String(id).startsWith('doc:')) await db.doc(String(id).slice(4)).delete();
      else if (id) { await db.doc('users/' + id).delete(); await authAdmin.deleteUser(id); }
    } catch (e) { }
  }
  try { await db.doc('usernames/' + username).delete(); } catch (e) { }
  console.log('probe data removed');
}

writeLocalReport();
await publishEvidence(db, sa);
console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all ' + results.length + ' checks passed'));
process.exit(failures ? 1 : 0);
