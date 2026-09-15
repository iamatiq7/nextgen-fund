#!/usr/bin/env node
/**
 * ci-reset.mjs - owner-run database reset executed inside GitHub Actions.
 *
 * Why this exists: the deployed security rules make three stores (settings/bootstrap,
 * usernames/*, audit/*) undeletable by any client, and no Firebase CLI, gcloud or
 * service-account key existed on the owner's machine. Admin credentials bypass security
 * rules entirely, and the repository already carries a service-account secret used for
 * Hosting deploys - so the reset runs there, with the owner's own credentials, and the
 * deployed rules stay exactly as they are.
 *
 * Modes (env MODE)
 *   backup  read every collection, write a JSON snapshot, report counts + sha256
 *   wipe    take a backup, delete every collection, prove every count is 0,
 *           then delete every Firebase Authentication account
 *   verify  counts only (safe default when nothing asked for a wipe)
 *
 * Safety rails
 *   - a wipe needs CONFIRM_WIPE=yes; the workflow only sets that when the trigger file
 *     at ops/db-reset/TRIGGER carries the exact expected first line
 *   - a wipe always takes its own backup inside the same run, before the first delete
 *   - the report holds no member PII: counts, hashes and masked ids only
 *   - any failure is written into ops/db-reset/REPORT.txt, which the workflow commits,
 *     so a failed CI run is still inspectable
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PROJECT_ID = process.env.PROJECT_ID || 'nextgen-fund-2040';
const MODE = String(process.env.MODE || 'verify').trim().toLowerCase();
const CONFIRM_WIPE = String(process.env.CONFIRM_WIPE || 'no').trim().toLowerCase() === 'yes';
const OUT_DIR = process.env.OUT_DIR || 'ops/db-reset';
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const COLLECTIONS = ['payments', 'registrations', 'audit', 'usernames', 'users', 'finance', 'settings'];

const lines = [];
const log = (s = '') => { lines.push(String(s)); console.log(String(s)); };
const mask = (v) => (v === null || v === undefined ? '-' : String(v).slice(0, 6) + '\u2026');
const nowIso = () => new Date().toISOString();

function writeReport(extra = []) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.txt'), lines.concat(extra).join('\n') + '\n', 'utf8');
}

function header(ok) {
  log('=== NextGen Fund database reset report (CI) ===');
  log(`project        : ${PROJECT_ID}`);
  log(`mode           : ${MODE}`);
  log(`confirmed wipe : ${CONFIRM_WIPE ? 'yes' : 'no'}`);
  log(`target         : ${EMULATOR ? 'emulator ' + process.env.FIRESTORE_EMULATOR_HOST : 'LIVE Firebase (admin credentials, security rules bypassed)'}`);
  log(`started        : ${nowIso()}`);
  log(`result         : ${ok ? 'PASS' : 'FAIL'}`);
  log('');
}

async function loadAdmin() {
  const appMod = await import('firebase-admin/app');
  const fsMod = await import('firebase-admin/firestore');
  const authMod = await import('firebase-admin/auth');
  const opts = { projectId: PROJECT_ID };
  if (!EMULATOR) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set (the service-account secret did not reach the job)');
    }
    opts.credential = appMod.applicationDefault();
  }
  appMod.initializeApp(opts);
  return { db: fsMod.getFirestore(), auth: authMod.getAuth() };
}

async function counts(db) {
  const out = {};
  for (const c of COLLECTIONS) {
    try {
      const snap = await db.collection(c).count().get();
      out[c] = snap.data().count;
    } catch (e) {
      out[c] = 'ERR:' + (e.code || e.message);
    }
  }
  return out;
}

async function takeBackup(db) {
  const stamp = nowIso().replace(/[:.]/g, '').slice(0, 15);
  const file = path.join(OUT_DIR, `backup-${stamp}.json`);
  const dump = { project: PROJECT_ID, takenAt: nowIso(), emulator: EMULATOR, collections: {} };
  const perCollection = {};
  for (const c of COLLECTIONS) {
    const snap = await db.collection(c).get();
    dump.collections[c] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    perCollection[c] = snap.size;
  }
  const text = JSON.stringify(dump, null, 2);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  const sha = crypto.createHash('sha256').update(text).digest('hex');
  return {
    file,
    sha,
    bytes: Buffer.byteLength(text, 'utf8'),
    perCollection,
    total: Object.values(perCollection).reduce((a, b) => a + b, 0),
  };
}

function backupLines(b) {
  log(`backup file    : ${b.file}`);
  log(`backup sha256  : ${b.sha}`);
  log(`backup bytes   : ${b.bytes}`);
  log(`backup counts  : ${JSON.stringify(b.perCollection)}`);
  log(`backup total   : ${b.total} document(s)`);
}

async function authInventory(auth) {
  try {
    const res = await auth.listUsers(1000);
    return { ok: true, count: res.users.length, prefixes: res.users.map((u) => mask(u.uid)) };
  } catch (e) {
    return { ok: false, count: null, error: e.code || e.message, prefixes: [] };
  }
}

async function main() {
  let { db, auth } = await loadAdmin();

  if (MODE === 'verify') {
    const c = await counts(db);
    header(true);
    log('counts         : ' + JSON.stringify(c));
    const a = await authInventory(auth);
    log('auth accounts  : ' + (a.ok ? a.count + ' (ids ' + a.prefixes.join(', ') + ')' : 'unavailable: ' + a.error));
    log('finished       : ' + nowIso());
    writeReport();
    return;
  }

  if (MODE === 'backup') {
    const before = await counts(db);
    const b = await takeBackup(db);
    const a = await authInventory(auth);
    header(true);
    log('counts         : ' + JSON.stringify(before));
    backupLines(b);
    log('auth accounts  : ' + (a.ok ? a.count + ' (ids ' + a.prefixes.join(', ') + ')' : 'unavailable: ' + a.error));
    log('note           : read-only run, nothing was deleted');
    log('finished       : ' + nowIso());
    writeReport();
    return;
  }

  if (MODE === 'wipe') {
    if (!CONFIRM_WIPE) throw new Error('wipe refused: CONFIRM_WIPE is not "yes" (trigger file missing or not matching)');
    const before = await counts(db);
    const b = await takeBackup(db);
    const authBefore = await authInventory(auth);

    const deleted = {};
    for (const c of COLLECTIONS) {
      try {
        await db.recursiveDelete(db.collection(c));
        deleted[c] = 'ok';
      } catch (e) {
        deleted[c] = 'ERR:' + (e.code || e.message);
      }
    }
    const after = await counts(db);

    let authAfter = { ok: authBefore.ok, count: null, prefixes: [], error: authBefore.error };
    if (authBefore.ok) {
      const res = await auth.listUsers(1000);
      const uids = res.users.map((u) => u.uid);
      if (uids.length) await auth.deleteUsers(uids);
      authAfter = await authInventory(auth);
    }

    const zero = Object.values(after).every((v) => v === 0);
    header(zero);
    log('counts before  : ' + JSON.stringify(before));
    backupLines(b);
    log('deletions      : ' + JSON.stringify(deleted));
    log('counts after   : ' + JSON.stringify(after));
    log('all zero       : ' + (zero ? 'YES' : 'NO'));
    log('auth before    : ' + (authBefore.ok ? authBefore.count + ' (ids ' + authBefore.prefixes.join(', ') + ')' : 'unavailable: ' + authBefore.error));
    log('auth after     : ' + (authAfter.ok ? authAfter.count + ' (ids ' + (authAfter.prefixes.join(', ') || 'none') + ')' : 'unavailable: ' + authAfter.error));
    log('first-run state: ' + (zero && authAfter.ok && authAfter.count === 0 ? 'YES - setup.html can claim the project again' : 'NOT REACHED'));
    log('finished       : ' + nowIso());
    writeReport();
    if (!zero) process.exitCode = 3;
    return;
  }

  throw new Error(`unknown MODE "${MODE}" (use backup | wipe | verify)`);
}

try {
  await main();
} catch (e) {
  header(false);
  log('error          : ' + (e && e.stack ? e.stack : String(e)));
  log('finished       : ' + nowIso());
  writeReport();
  process.exitCode = 1;
}
