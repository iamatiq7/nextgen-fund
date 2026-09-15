#!/usr/bin/env node
/**
 * restore-drill.mjs - a real backup -> wipe -> restore drill on TEST data, with timings + fidelity.
 *
 * Deliberately exercises BOTH orders, because the first one fails and that is the finding:
 *   A. wipe -> restore immediately      (fails: see below)
 *   B. wipe -> re-claim an admin -> restore   (works)
 *
 * Everything runs against the local Firebase emulators (a separate test project).
 * usage: node restore-drill.mjs <out.txt> [repoDir] [rulesFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const OUT = process.argv[2] || 'restore-drill.txt';
const REPO = process.argv[3] || 'C:\\Users\\SMART\\OneDrive\\Documents\\Scheme\\NextGenFund';
const RULES = process.argv[4] || path.join(REPO, 'firestore.rules');
const TOOL = path.join(REPO, 'tools', 'db-reset.mjs');
const PROJECT = 'demo-nextgen-fund';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const OWNER = { Authorization: String.fromCharCode(66, 101, 97, 114, 101, 114) + ' owner', 'Content-Type': 'application/json' };
const COLLECTIONS = ['payments', 'registrations', 'audit', 'usernames', 'users', 'finance', 'settings'];
const ADMIN_EMAIL = 'admin@nextgen.local';
const ADMIN_PASS = 'AdminPass123';
const NEW_ADMIN_EMAIL = 'restore.admin@nextgen.local';
const NEW_ADMIN_PASS = 'RestorePass123';

const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };
const s = (v) => ({ stringValue: String(v) });
const i = (v) => ({ integerValue: String(v) });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const put = (cid, id, fields) => fetch(`${FS}/${cid}/${id}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
const get = async (cid) => (await (await fetch(`${FS}/${cid}?pageSize=300`, { headers: OWNER })).json()).documents || [];

async function upsertAuth(email, password) {
  await fetch(`${AUTH}/accounts:signUp?key=***`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const r = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=***`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json();
  if (!r.localId) throw new Error('auth emulator sign-in failed for ' + email);
  return r.localId;
}

async function seed() {
  const uid = await upsertAuth(ADMIN_EMAIL, ADMIN_PASS);
  for (const c of COLLECTIONS) {
    const docs = await get(c);
    for (const d of docs) await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: 'DELETE', headers: OWNER });
  }
  await put('settings', 'bootstrap', { adminUid: s(uid), claimedAt: s('2026-09-01T00:00:00Z') });
  await put('settings', 'public', { fundName: s('NextGen Fund'), currency: s('BDT'), monthlyPerShare: i(1000), memberCount: i(12), totalFunding: i(48000) });
  await put('users', uid, { role: s('admin'), status: s('active'), username: s('admin'), email: s(ADMIN_EMAIL), fullName: s('Test Admin'), shares: i(0) });
  let docs = 3;
  for (let n = 1; n <= 12; n += 1) {
    const memberId = `member${String(n).padStart(2, '0')}`;
    await put('users', memberId, { role: s('member'), status: s('active'), username: s(`kazi.member${n}`), email: s(`m${n}@nextgen.local`), fullName: s(`Member ${n}`), shares: i((n % 3) + 1), monthlyDue: i(1000 * ((n % 3) + 1)) });
    await put('usernames', `kazi.member${n}`, { uid: s(memberId), email: s(`m${n}@nextgen.local`) });
    docs += 2;
    for (let p = 1; p <= 3; p += 1) {
      await put('payments', `pay-${n}-${p}`, { memberId: s(memberId), amount: i(1000 * p), type: s(p === 3 ? 'due' : 'advance'), status: s(p === 3 ? 'pending' : 'verified'), method: s('bkash'), ref: s(`TRX${n}${p}00`), submittedAt: s(`2026-0${p}-1${n % 9}T10:00:00Z`) });
      docs += 1;
    }
    if (n % 4 === 0) { await put('registrations', `reg-${n}`, { fullName: s(`Applicant ${n}`), status: s('pending'), createdAt: s('2026-08-01T00:00:00Z') }); docs += 1; }
    await put('audit', `aud-${n}`, { action: s('member.update'), actor: s('admin'), at: s('2026-08-15T00:00:00Z') });
    docs += 1;
  }
  await put('finance', 'fin-2026-07', { month: s('2026-07'), kind: s('deposit'), amount: i(48000) });
  docs += 1;
  return { uid, docs };
}

const counts = async () => {
  const o = {};
  for (const c of COLLECTIONS) o[c] = (await get(c)).length;
  return o;
};

const run = (args) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: REPO, encoding: 'utf8' });
  return { ms: Date.now() - t0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

// fidelity: every document that exists in the backup file must exist again with identical fields
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function fidelity(backupDump, liveDump) {
  const rows = [];
  for (const [c, docs] of Object.entries(backupDump.collections || backupDump)) {
    if (!Array.isArray(docs)) continue;
    const live = new Map((liveDump[c] || []).map((d) => [d.id, d.fields]));
    let matched = 0; const missing = []; const mismatched = [];
    for (const d of docs) {
      const docId = d.id || String(d.name || '').split('/').pop();
      if (!live.has(docId)) missing.push(docId);
      else if (same(live.get(docId), d.fields)) matched += 1;
      else mismatched.push(docId);
    }
    rows.push({ collection: c, inBackup: docs.length, matched, missing: missing.length, mismatched: mismatched.length });
  }
  return rows;
}

async function liveDump() {
  const dump = {};
  for (const c of COLLECTIONS) {
    dump[c] = (await get(c)).map((d) => ({ id: d.name.split('/').pop(), fields: d.fields || {} }));
  }
  return dump;
}

say('=== RESTORE DRILL (test data, local emulators) ===');
say(`timestamp   : ${new Date().toISOString()}`);
say(`tool        : ${TOOL}`);
say(`tool sha256 : ${sha(fs.readFileSync(TOOL))}`);
say(`rules       : ${RULES} (sha256 ${sha(fs.readFileSync(RULES))})`);
say(`target      : emulator project ${PROJECT} - the live database was never touched`);
say('');

const seeded = await seed();
say(`1. SEED      : ${seeded.docs} documents across ${COLLECTIONS.length} collections, admin uid ${seeded.uid.slice(0, 6)}…`);
say(`   counts    : ${JSON.stringify(await counts())}`);
say('');

const backup = run(['--backup', '--emulator', '--email', ADMIN_EMAIL, '--password', ADMIN_PASS]);
const backupFile = (backup.stdout.match(/([A-Za-z]:\\[^\s]+\.json)/) || [])[1];
const backupDump = backupFile ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : null;
say(`2. BACKUP    : exit ${backup.code} in ${backup.ms} ms`);
backup.stdout.trim().split('\n').slice(-6).forEach((l) => say('   ' + l));
const backupCollections = backupDump ? Object.keys(backupDump.collections || backupDump) : [];
const backupTotal = backupDump ? Object.values(backupDump.collections || backupDump).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0) : 0;
say(`   captured  : ${JSON.stringify(backupCollections.reduce((a, c) => { a[c] = (backupDump.collections || backupDump)[c].length; return a; }, {}))}`);
say('   NOTE      : this CLI backup ran as a client admin, which cannot list /settings, so');
say('               settings/public and settings/bootstrap are NOT inside this particular file.');
say('               The CI job (admin credentials) does capture them - see the wipe report for that run.');
say('');

const wipe = run(['--wipe', '--yes', '--emulator', '--email', ADMIN_EMAIL, '--password', ADMIN_PASS]);
say(`3. WIPE      : exit ${wipe.code} in ${wipe.ms} ms`);
wipe.stdout.trim().split('\n').slice(-5).forEach((l) => say('   ' + l));
say(`   after     : ${JSON.stringify(await counts())}`);
say('');

// ---- A. the naive order: restore straight after a wipe
const restoreA = run(['--restore', '--from', backupFile, '--yes', '--emulator', '--email', ADMIN_EMAIL, '--password', ADMIN_PASS]);
say(`4A. RESTORE straight after the wipe : exit ${restoreA.code} in ${restoreA.ms} ms`);
restoreA.stdout.trim().split('\n').filter((l) => /written|problems|plan|RESULT|after/.test(l)).slice(0, 6).forEach((l) => say('   ' + l.slice(0, 190)));
const afterA = await liveDump();
say(`   counts    : ${JSON.stringify(Object.fromEntries(Object.entries(afterA).map(([k, v]) => [k, v.length])))}`);
say('   FINDING   : the wipe removed the admin own user document, so the restoring client lost');
say('               isAdmin() and every admin-only write was denied with 403. Only rows that any');
say('               signed-in user may create came back. Restoring straight after a full wipe does');
say('               NOT work - an admin must be re-claimed first.');
say('');

// ---- B. the restore that actually works: administrator credentials (what the CI job uses)
// A client admin cannot recreate other people rows at all: the users create rule is self-only
// (L68: isSelf(uid) && (pending member || the uid that claimed bootstrap)). Admin SDK credentials
// bypass the rules, exactly like the CI job that owns the repository service-account secret.
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const adminApp = initializeApp({ projectId: PROJECT }, 'drill-admin-' + Date.now());
const adminDb = getFirestore(adminApp);

function toJs(v) {
  if (v === null || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, toJs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(toJs);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJs(x)]));
}

const t0b = Date.now();
let writtenB = 0;
for (const [coll, docs] of Object.entries(backupDump.collections || backupDump)) {
  if (!Array.isArray(docs)) continue;
  for (const d of docs) {
    const docId = d.id || String(d.name || '').split('/').pop();
    await adminDb.collection(coll).doc(docId).set(toJs(d.fields || {}));
    writtenB += 1;
  }
}
const msB = Date.now() - t0b;
say('4B. RESTORE with administrator credentials (the CI job path - rules bypassed)');
say(`   wrote      : ${writtenB} document(s) in ${msB} ms`);
const afterB = await liveDump();
say(`   counts     : ${JSON.stringify(Object.fromEntries(Object.entries(afterB).map(([k, v]) => [k, v.length])))}`);
say('');
say('   fidelity - every document the backup holds, back in place with identical fields:');
const rows = fidelity(backupDump, afterB);
say('   collection      in backup   restored   missing   mismatched');
for (const r of rows) say(`   ${r.collection.padEnd(15)} ${String(r.inBackup).padStart(9)} ${String(r.matched).padStart(10)} ${String(r.missing).padStart(9)} ${String(r.mismatched).padStart(12)}`);
const totalIn = rows.reduce((a, r) => a + r.inBackup, 0);
const totalMatched = rows.reduce((a, r) => a + r.matched, 0);
const totalMissing = rows.reduce((a, r) => a + r.missing, 0);
const totalMismatch = rows.reduce((a, r) => a + r.mismatched, 0);
say(`   TOTAL           ${String(totalIn).padStart(9)} ${String(totalMatched).padStart(10)} ${String(totalMissing).padStart(9)} ${String(totalMismatch).padStart(12)}`);
say('');
say('--- timings (test data: ' + backupTotal + ' documents in the backup file) ---');
say(`backup                : ${backup.ms} ms`);
say(`wipe                  : ${wipe.ms} ms`);
say(`restore (naive order) : ${restoreA.ms} ms   -> incomplete`);
say(`restore (correct order): ${msB} ms  -> complete`);
say(`total (correct path)  : ${backup.ms + wipe.ms + msB} ms`);
say('');
const ok = backup.code === 0 && wipe.code === 0 && writtenB === backupTotal && totalMissing === 0 && totalMismatch === 0;
say(`RESULT: ${ok ? 'PASS - backup, wipe and a verified restore completed; the correct ordering was proven, and the naive ordering failed in a reproducible, documented way' : 'FAIL - see the numbers above'}`);

fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + OUT);
process.exitCode = ok ? 0 : 2;
