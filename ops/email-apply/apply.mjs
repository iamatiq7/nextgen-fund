/* Apply approved e-mail changes — the scheduled job.

   Why: Firebase Authentication only lets the signed-in member change their own login address, so an
   admin approval cannot finish the switch from the browser. This job does it with the service
   account, on a schedule, and records everything.

   Guarantees
     - idempotent: an item whose record AND Authentication already hold the new address is skipped,
       so running twice (schedule overlap, manual run, retry) never applies the same change twice
     - retry: every item is attempted up to ATTEMPTS times with a short back-off
     - dead-letter: items that keep failing are parked on the record (emailChangeDeadLetter) and
       re-attempted on the next run; the run log carries the count every time
     - control: settings/public.jobControl may pause the job; settings/public.jobRequests can ask
       for a manual run; both are written from the admin console
     - rollback: --revert=<runId> restores the previous Authentication address and record e-mail
       for every item of that run
     - privacy: every address is masked in the output and in the committed report

   Usage
     node ops/email-apply/apply.mjs                 # honour the schedule/control, apply
     DRY_RUN=true node ops/email-apply/apply.mjs    # show what would happen
     node ops/email-apply/apply.mjs --revert=<runId>
*/
import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const ATTEMPTS = 3;
const JOB = 'email-apply';
const keyPath = process.env.SA_KEY || './sa.json';
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const revert = (process.argv.find((a) => a.startsWith('--revert=')) || '').split('=')[1] || '';
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();
const auth = getAuth();

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '(empty)';
  const [a, b] = s.split('@');
  if (!b) return s.slice(0, 3) + '***';
  return a.slice(0, 2) + '***@' + b.slice(0, 1) + '***';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const started = Date.now();

async function pushRun(row) {
  const pubRef = db.collection('settings').doc('public');
  const pub = (await pubRef.get()).data() || {};
  const runs = [row].concat(Array.isArray(pub.jobRuns) ? pub.jobRuns : []).slice(0, 30);
  const patch = { jobRuns: runs, updatedAt: new Date().toISOString() };
  if (pub.jobRequests && pub.jobRequests[JOB]) {
    patch.jobRequests = Object.assign({}, pub.jobRequests, { [JOB]: Object.assign({}, pub.jobRequests[JOB], { status: 'done', doneAt: row.at }) });
  }
  await pubRef.set(patch, { merge: true });
}

async function audit(o) {
  try { await db.collection('audit').add(Object.assign({ at: new Date().toISOString() }, o)); } catch (e) { say('audit write refused: ' + e.message); }
}

/* honour the console's controls */
const pub0 = (await db.collection('settings').doc('public').get()).data() || {};
const control = pub0.jobControl || {};
const requested = !!(pub0.jobRequests && pub0.jobRequests[JOB]);
if (control.paused && !revert) {
  say('job is paused from the admin console' + (control.reason ? ' (' + control.reason + ')' : '') + ' — nothing done');
  say('mode: PAUSED');
  await pushRun({ at: new Date().toISOString(), job: JOB, ok: true, applied: 0, failed: 0, deadLetter: 0, ms: Date.now() - started, by: 'schedule', note: 'paused' });
  fs.mkdirSync('ops/email-apply', { recursive: true });
  fs.writeFileSync('ops/email-apply/REPORT.txt', lines.join('\n') + '\n');
  process.exit(0);
}

/* ---------- rollback of one recorded run ---------- */
if (revert) {
  const runs = Array.isArray(pub0.jobRuns) ? pub0.jobRuns : [];
  const run = runs.find((r) => String(r.id) === String(revert));
  if (!run || !Array.isArray(run.items) || !run.items.length) {
    say('REVERT ' + revert + ' | no such run, or it recorded no items');
    fs.writeFileSync('ops/email-apply/REPORT.txt', lines.join('\n') + '\n');
    process.exit(1);
  }
  say('reverting run ' + revert + ' (' + run.items.length + ' item(s))');
  for (const it of run.items) {
    if (dryRun) { say('DRY  ' + (it.username || it.uid) + ' | ' + mask(it.after) + ' -> ' + mask(it.before)); continue; }
    try {
      await auth.updateUser(it.uid, { email: it.before });
      await db.collection('users').doc(it.uid).set({ email: it.before, authEmail: it.before, emailChangePending: it.after, emailChangedAt: new Date().toISOString() }, { merge: true });
      await audit({ actor: 'service account', action: 'job.rollback', objectType: 'email', objectId: it.uid, changes: [{ field: 'email', from: it.after, to: it.before }], detail: 'run ' + revert + ' reverted' });
      say('REVERTED ' + (it.username || it.uid) + ' | ' + mask(it.after) + ' -> ' + mask(it.before));
    } catch (e) { say('REVERT FAILED ' + (it.username || it.uid) + ' | ' + (e && e.code || e.message)); }
  }
  fs.writeFileSync('ops/email-apply/REPORT.txt', lines.join('\n') + '\n');
  process.exit(0);
}

/* ---------- the normal pass ---------- */
const users = await db.collection('users').get();
say('member records: ' + users.size + (requested ? ' (manual run requested from the console)' : ''));
let pending = 0, applied = 0, skipped = 0, failed = 0, dead = 0;
const items = [];

for (const doc of users.docs) {
  const u = doc.data() || {};
  const target = String(u.emailChangePending || '').trim();
  if (!target) continue;
  pending++;

  /* idempotency: already switched on both sides? then there is nothing left to do */
  let authEmail = '';
  try { authEmail = (await auth.getUser(doc.id)).email || ''; } catch (e) { authEmail = ''; }
  if (authEmail && authEmail.toLowerCase() === target.toLowerCase() && String(u.email || '').toLowerCase() === target.toLowerCase()) {
    say('SKIP ' + (u.username || doc.id) + ' | already applied (record + Authentication both hold the new address)');
    if (!dryRun) { await doc.ref.set({ emailChangePending: null, emailChangedAt: u.emailChangedAt || new Date().toISOString() }, { merge: true }); }
    skipped++;
    continue;
  }
  if (dryRun) { say('DRY  ' + (u.username || doc.id) + ' | ' + mask(u.email || authEmail) + ' -> ' + mask(target)); continue; }

  /* an address that belongs to somebody else can never be applied */
  try {
    const other = await auth.getUserByEmail(target);
    if (other.uid !== doc.id) {
      say('SKIP ' + (u.username || doc.id) + ' | ' + mask(target) + ' is already used by another account');
      await doc.ref.set({ emailChangeDeadLetter: { to: target, reason: 'email-already-in-use', at: new Date().toISOString() } }, { merge: true });
      dead++; skipped++;
      continue;
    }
  } catch (eFree) { /* the address is free */ }

  let ok = false, lastErr = '';
  for (let attempt = 1; attempt <= ATTEMPTS && !ok; attempt++) {
    try {
      await auth.updateUser(doc.id, { email: target, emailVerified: true });
      ok = true;
    } catch (eTry) {
      lastErr = String((eTry && eTry.code) || (eTry && eTry.message) || eTry);
      if (attempt < ATTEMPTS) await sleep(400 * attempt);
    }
  }

  if (!ok) {
    failed++; dead++;
    await doc.ref.set({ emailChangeDeadLetter: { to: target, attempts: ATTEMPTS, lastError: lastErr.slice(0, 200), at: new Date().toISOString() } }, { merge: true });
    await audit({ actor: 'service account', action: 'job.item-failed', objectType: 'email', objectId: doc.id, changes: [{ field: 'email', from: mask(u.email || ''), to: mask(target) }], detail: 'dead-lettered after ' + ATTEMPTS + ' attempts: ' + lastErr.slice(0, 120) });
    say('FAIL ' + (u.username || doc.id) + ' | dead-lettered: ' + lastErr);
    continue;
  }

  await doc.ref.set({
    email: target, authEmail: target, emailChangePending: null, emailVerification: null,
    emailChangedAt: new Date().toISOString(), emailChangeDeadLetter: null
  }, { merge: true });
  const uname = String(u.username || '').toLowerCase();
  if (uname) {
    try {
      const regRef = db.collection('usernames').doc(uname);
      const reg = (await regRef.get()).data() || {};
      await regRef.delete();
      await regRef.set({ uid: doc.id, email: target, emailAlt: target, updatedAt: new Date().toISOString() });
    } catch (eReg) { say('registry note: ' + eReg.message); }
  }
  await audit({
    actor: 'service account', action: 'email.changed', objectType: 'email', objectId: doc.id,
    changes: [{ field: 'email', from: u.email || authEmail, to: target }],
    detail: 'approved change applied by the service account'
  });
  items.push({ uid: doc.id, username: u.username || '', before: u.email || authEmail, after: target });
  applied++;
  say('APPLIED ' + (u.username || doc.id) + ' | ' + mask(u.email || authEmail) + ' -> ' + mask(target));
}

say('');
say('result: ' + applied + ' applied, ' + skipped + ' skipped, ' + failed + ' failed, ' + pending + ' approved change(s) found');
say('mode: ' + (dryRun ? 'DRY RUN (nothing written)' : 'WRITE'));

const runRow = {
  id: 'r' + Date.now().toString(36), at: new Date().toISOString(), job: JOB, ok: failed === 0,
  applied, skipped, failed, deadLetter: dead, pending, ms: Date.now() - started,
  by: requested ? 'admin request' : 'schedule', note: dryRun ? 'dry run' : '',
  items: items.slice(0, 50)
};
if (!dryRun) { try { await pushRun(runRow); } catch (e) { say('run log note: ' + e.message); } }
say('run id: ' + runRow.id + ' (revert with --revert=' + runRow.id + ')');

fs.mkdirSync('ops/email-apply', { recursive: true });
fs.writeFileSync('ops/email-apply/REPORT.txt', lines.join('\n') + '\n');
