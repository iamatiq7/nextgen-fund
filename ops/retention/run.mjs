/* Retention job — what happens to a replaced login address when its window runs out.

   The policy and the arithmetic live in assets/js/ngf-retention.js, the same module the admin
   policy screen and the automated checks use, so the rule can never drift.

   What it does, per run
     1. reads settings/public.retention (the policy) and the ledger of replaced addresses
        (usernames/{address} with retired:true, joined with users/{uid} for usage counts)
     2. warns the admin about addresses that will expire inside the warning window: an audit entry
        and settings/public.retentionWarnings, which the admin console shows as a banner
     3. applies the configured behaviour to the addresses whose window has passed:
          anonymize -> the stored address is replaced by a masked marker (record kept, address gone)
          disable   -> the address stays, but stays permanently unusable for sign-in
          delete    -> the alias document is removed
        Audit rows are never touched: the fund keeps the history, the address itself goes.
     4. records the run in settings/public.jobRuns (the admin console's job dashboard) and in
        ops/retention/REPORT.txt

   Usage
     node ops/retention/run.mjs              # honour settings/public.jobControl
     DRY_RUN=true node ops/retention/run.mjs # show the plan, write nothing
*/
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const R = require('../assets/js/ngf-retention.js');          /* the shared, tested policy module */
const JOB = 'retention';
const keyPath = process.env.SA_KEY || './sa.json';
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const started = Date.now();
const pubRef = db.collection('settings').doc('public');

async function audit(o) {
  try { await db.collection('audit').add(Object.assign({ at: new Date().toISOString(), actor: 'service account' }, o)); } catch (e) { say('audit write refused: ' + e.message); }
}

const pub = (await pubRef.get()).data() || {};
const control = pub.jobControl || {};
const requested = !!(pub.jobRequests && pub.jobRequests[JOB]);
if (control.paused) {
  say('retention job is paused from the admin console' + (control.reason ? ' (' + control.reason + ')' : '') + ' — nothing done');
  await pubRef.set({ jobRuns: [{ id: 'r' + Date.now().toString(36), at: new Date().toISOString(), job: JOB, ok: true, applied: 0, note: 'paused', ms: Date.now() - started, by: 'schedule' }].concat(pub.jobRuns || []).slice(0, 30) }, { merge: true });
  fs.mkdirSync('ops/retention', { recursive: true });
  fs.writeFileSync('ops/retention/REPORT.txt', lines.join('\n') + '\n');
  process.exit(0);
}

const policy = R.normalizePolicy(pub.retention);
say('policy: keep ' + policy.defaultDays + ' day(s) · warn ' + policy.warnDaysBefore + ' day(s) before · behaviour ' + policy.behavior
  + ' · exceptions ' + policy.exceptions.length + (requested ? ' · manual run requested' : ''));

/* ---- ledger: every replaced address the fund still knows ---- */
const names = await db.collection('usernames').get();
const users = await db.collection('users').get();
const byUid = {};
users.forEach((d) => { byUid[d.id] = d.data() || {}; });
const ledger = [];
names.forEach((d) => {
  const v = d.data() || {};
  if (v.retired !== true) return;
  const u = byUid[v.uid] || {};
  const hit = (u.retiredAddressHits || {})[d.id] || {};
  ledger.push({
    address: d.id, uid: v.uid || '', username: u.username || '', anonymized: !!v.anonymized,
    retiredAt: v.retiredAt || v.createdAt || '', hits: Number(hit.count) || 0, lastHitAt: hit.lastAt || '',
    movedTo: v.movedTo || ''
  });
});
say('replaced addresses on record: ' + ledger.length + ' (of ' + names.size + ' registry documents)');

const nowIso = new Date().toISOString();
const plan = R.plan(ledger, policy, nowIso);
const sum = R.summarize(ledger, policy, nowIso);
say('active ' + sum.active + ' · expiring soon ' + sum.expiring + ' · expired ' + sum.expired);

/* ---- 1. warn the admin before anything expires ---- */
for (const w of plan.warn) {
  say('WARN ' + R.maskAddress(w.address) + ' | ' + w.daysLeft + ' day(s) left, expires ' + w.retainUntil.slice(0, 10));
  if (!dryRun) {
    await audit({
      action: 'retention.warn', objectType: 'email', objectId: w.uid,
      changes: [{ field: 'retain-until', from: '', to: String(w.retainUntil) }],
      detail: 'replaced address expires in ' + w.daysLeft + ' day(s): ' + R.maskAddress(w.address)
    });
  }
}
if (!dryRun) {
  await pubRef.set({
    retentionWarnings: plan.warn.map((w) => ({ address: R.maskAddress(w.address), uid: w.uid, retainUntil: w.retainUntil, daysLeft: w.daysLeft })),
    retentionWarningsAt: nowIso
  }, { merge: true });
}

/* ---- 2. apply the behaviour to the addresses whose window has passed ---- */
let applied = 0, failed = 0;
for (const item of plan.apply) {
  const ref = db.collection('usernames').doc(item.address);
  say('APPLY ' + item.action + ' ' + R.maskAddress(item.address) + ' | expired ' + String(item.retainUntil).slice(0, 10));
  if (dryRun) continue;
  try {
    if (item.action === 'delete') {
      await ref.delete();
    } else if (item.action === 'anonymize') {
      const doc = R.anonymizedDoc(item, policy, nowIso);
      await ref.delete();
      await ref.set(doc);
      if (item.uid) {
        await db.collection('users').doc(item.uid).set({ retentionApplied: { address: R.maskAddress(item.address), action: 'anonymize', at: nowIso } }, { merge: true });
      }
    } else {                                    /* disable: keep it, but mark it permanently unusable */
      const cur = (await ref.get()).data() || {};
      await ref.delete();
      await ref.set(Object.assign({}, cur, { retired: true, disabled: true, disabledAt: nowIso, uid: item.uid }));
    }
    await audit(Object.assign({ objectId: item.uid }, R.jobAuditDetail(item, policy, nowIso)));
    applied++;
  } catch (e) {
    failed++;
    say('FAILED ' + R.maskAddress(item.address) + ' | ' + ((e && e.message) || e));
    await audit({ action: 'retention.failed', objectType: 'email', objectId: item.uid, detail: 'retention apply failed: ' + ((e && e.code) || (e && e.message) || '') });
  }
}

say('');
say('result: ' + applied + ' applied, ' + failed + ' failed, ' + plan.warn.length + ' warning(s)');
say('mode: ' + (dryRun ? 'DRY RUN (nothing written)' : 'WRITE'));

if (!dryRun) {
  const runs = [{
    id: 'r' + Date.now().toString(36), at: new Date().toISOString(), job: JOB, ok: failed === 0,
    applied, failed, warnings: plan.warn.length, total: ledger.length, ms: Date.now() - started,
    by: requested ? 'admin request' : 'schedule', behavior: policy.behavior
  }].concat(pub.jobRuns || []).slice(0, 30);
  const patch = { jobRuns: runs, updatedAt: new Date().toISOString() };
  if (pub.jobRequests && pub.jobRequests[JOB]) {
    patch.jobRequests = Object.assign({}, pub.jobRequests, { [JOB]: Object.assign({}, pub.jobRequests[JOB], { status: 'done', doneAt: new Date().toISOString() }) });
  }
  await pubRef.set(patch, { merge: true });
}

fs.mkdirSync('ops/retention', { recursive: true });
fs.writeFileSync('ops/retention/REPORT.txt', lines.join('\n') + '\n');
