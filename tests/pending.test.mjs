/* Pending-payment status tests.
   Reproduces the reported bug ("Pending payments 6" / "Verify 6 submitted payment(s)"
   never cleared after verification) and locks every fix in place.

   Root cause under test:  listPayments('pending')  was called with a plain string while
   the filter only inspected filter.status, so the filter silently did nothing and every
   payment (verified and rejected included) was counted as pending.

   All numbers are measured as deltas from a baseline scan, so the seeded demo book
   (106 payments) does not make the expectations brittle.

   Run:  node tests/pending.test.mjs   */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');

const tinyDocs = ['nid-front', 'nid-back', 'profile-picture', 'nominee-passport-photo'].map((k) => ({
  kind: k, name: k + '.png', mime: 'image/png', size: 96,
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
}));
const U = require('../assets/js/util.js');

let fails = 0, n = 0;
function check(name, cond, extra) {
  n++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' | ' + extra : ''));
  if (!cond) fails++;
}
function step(msg) { console.log('  · ' + msg); }

/* The OLD filter, kept verbatim for the before/after proof. */
function oldPayFilter(list, filter) {
  if (filter && filter.status) list = list.filter((p) => p.status === filter.status);
  return list;
}

Store._demoReset();
await Store.init();

console.log('== STEP 1: shared summariser self-check ==');
check('P1 the shared payment summariser passes its own self-check', U.summarisePayments.selfCheck() === true);

console.log('== STEP 2: baseline of the seeded book ==');
await Store.login('admin', 'nextgen2026');
const base = await Store.paymentStats();
step('baseline: pending ' + base.counts.pending + ' (' + base.amounts.pending + ') · verified ' + base.counts.verified +
  ' (' + base.amounts.verified + ') · rejected ' + base.counts.rejected + ' · all ' + base.counts.all);
check('P2 the baseline book has no pending payments to start with', base.counts.pending === 0 && base.amounts.pending === 0);

console.log('== STEP 3: reproduce the reported bug with the old filter ==');
await Store.register({ fatherName: 'Father Name', motherName: 'Mother Name', nomineeRelation: 'Brother', fullName: 'Pending Case', username: 'pend.case', email: 'pend.case@nextgen.local', phone: '01711000001', nominee: 'Test Nominee', nomineeAddress: 'Test address', nomineeRelation: 'Brother', fatherName: 'Father Name', motherName: 'Mother Name', joinMonth: U.currentMonth(), shares: 1, password: 'PendPass1234', docs: tinyDocs.map((d) => Object.assign({}, d)) });
const reg = (await Store.listRegistrations()).filter((r) => r.username === 'pend.case')[0];
await Store.decideRegistration(reg.id, true);
const member = (await Store.listMembers()).filter((m) => m.username === 'pend.case')[0];
await Store.logout();
await Store.login('pend.case', 'PendPass1234');
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 6000, date: '2026-09-12', ref: 'PEND-BUG-1' });

await Store.login('admin', 'nextgen2026');
const allBefore = await Store.listPayments();
const pendingBefore = await Store.listPayments({ status: 'pending' });
step('ledger now: ' + allBefore.length + ' payments (pending ' + pendingBefore.length + ')');
await Store.verifyPayment(pendingBefore[0].id);

const allAfter = await Store.listPayments();
const pendingAfter = await Store.listPayments({ status: 'pending' });
step('after verifying: pending=' + pendingAfter.length + ' · all=' + allAfter.length);

const OLD_stringCall = oldPayFilter(allAfter, 'pending');
const NEW_stringCall = await Store.listPayments('pending');
const NEW_objectCall = await Store.listPayments({ status: 'pending' });
step('OLD string call -> ' + OLD_stringCall.length + ' rows | NEW string call -> ' + NEW_stringCall.length + ' | NEW object call -> ' + NEW_objectCall.length);

check('P3 the old string call really did return every payment (the reported "6")', OLD_stringCall.length === allAfter.length && OLD_stringCall.length > 0);
check('P4 a string filter now filters correctly', NEW_stringCall.length === 0, 'rows=' + NEW_stringCall.length);
check('P5 both filter shapes agree', NEW_stringCall.length === NEW_objectCall.length && NEW_stringCall.length === pendingAfter.length);
check('P6 verified payments are no longer reported as pending', NEW_stringCall.every((p) => p.status === 'pending'));

console.log('== STEP 4: stats tell the truth after verification ==');
let stats = await Store.paymentStats();
step('stats: pending ' + stats.counts.pending + ' (' + stats.amounts.pending + ') · verified ' + stats.counts.verified +
  ' (' + stats.amounts.verified + ') · rejected ' + stats.counts.rejected + ' · all ' + stats.counts.all + ' (' + stats.amounts.all + ')');
check('P7 pending returns to the baseline once everything is verified', stats.counts.pending === base.counts.pending && stats.amounts.pending === base.amounts.pending);
check('P8 the 6,000 moved into the verified bucket (no money lost)', stats.amounts.verified === base.amounts.verified + 6000, 'verified=' + stats.amounts.verified);
check('P9 counts add up', stats.counts.pending + stats.counts.verified + stats.counts.rejected + stats.counts.other === stats.counts.all);
check('P10 amounts add up', stats.amounts.pending + stats.amounts.verified + stats.amounts.rejected + stats.amounts.other === stats.amounts.all);
check('P11 stats equal a fresh raw scan (dashboard == records)', stats.counts.all === allAfter.length && stats.amounts.all === allAfter.reduce((a, p) => a + p.amount, 0));

console.log('== STEP 5: pending -> verified -> rejected each land in the right bucket ==');
await Store.logout();
await Store.login('pend.case', 'PendPass1234');
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 2000, date: '2026-09-13', ref: 'PEND-BUG-2' });
await Store.submitPayment({ type: 'advance', method: 'cash', amount: 1000, date: '2026-09-13', ref: 'PEND-BUG-3' });
await Store.login('admin', 'nextgen2026');
stats = await Store.paymentStats();
step('two submissions -> pending ' + stats.counts.pending + ' (' + stats.amounts.pending + ')');
check('P12 new submissions push pending up', stats.counts.pending === base.counts.pending + 2 && stats.amounts.pending === base.amounts.pending + 3000, JSON.stringify(stats.amounts));

const p2 = (await Store.listPayments('pending')).filter((p) => p.ref === 'PEND-BUG-2')[0];
await Store.verifyPayment(p2.id);
stats = await Store.paymentStats();
check('P13 verifying one drops pending to 1 row / 1,000', stats.counts.pending === base.counts.pending + 1 && stats.amounts.pending === base.amounts.pending + 1000, JSON.stringify(stats.amounts));
check('P14 the verified money lands in the verified bucket', stats.amounts.verified === base.amounts.verified + 8000, 'verified=' + stats.amounts.verified);

const p3 = (await Store.listPayments('pending'))[0];
await Store.rejectPayment(p3.id, 'statement e pai nai');
stats = await Store.paymentStats();
step('after reject -> pending ' + stats.counts.pending + ' · verified ' + stats.counts.verified + ' · rejected ' + stats.counts.rejected);
check('P15 rejected payments leave the pending bucket', stats.counts.pending === base.counts.pending);
check('P16 rejected money sits in its own bucket', stats.counts.rejected === base.counts.rejected + 1 && stats.amounts.rejected === base.amounts.rejected + 1000);
check('P17 nothing is counted twice', stats.amounts.pending + stats.amounts.verified + stats.amounts.rejected === stats.amounts.all);

console.log('== STEP 6: duplicate references are refused on both entry paths ==');
const otherMember = (await Store.listMembers()).filter((m) => m.username !== 'pend.case')[0];
let adminDup = null;
try {
  await Store.addManualPayment({ memberId: member.id, type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-BUG-1', note: '' });
} catch (e) { adminDup = e.code; }
check('P18 the admin cannot record a reference that already exists for that member', adminDup === 'dup-ref', 'code=' + adminDup);

const beforeManual = await Store.paymentStats();
await Store.addManualPayment({ memberId: otherMember.id, type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-MANUAL-1', note: 'cash handed to the admin' });
const afterManual = await Store.paymentStats();
step('a new manual entry: all ' + beforeManual.counts.all + ' -> ' + afterManual.counts.all + ', verified ' + beforeManual.counts.verified + ' -> ' + afterManual.counts.verified);
check('P19 a new manual entry is added once and lands straight in the verified bucket', afterManual.counts.all === beforeManual.counts.all + 1 && afterManual.counts.verified === beforeManual.counts.verified + 1 && afterManual.counts.pending === beforeManual.counts.pending);

await Store.logout();
await Store.login('pend.case', 'PendPass1234');
let memberDup = null;
try { await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-BUG-1' }); } catch (e) { memberDup = e.code; }
check('P20 a member cannot submit the same transaction ID twice', memberDup === 'dup-ref', 'code=' + memberDup);

/* a rejected reference may be submitted again - that is the documented recovery path */
let reuseOk = true;
let reuseErr = '';
try { await Store.submitPayment({ type: 'advance', method: 'cash', amount: 1000, date: '2026-09-15', ref: 'PEND-BUG-3' }); } catch (e) { reuseOk = false; reuseErr = e.code + ' ' + e.message; }
check('P21 a rejected reference can be submitted again', reuseOk, reuseErr);
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-15', ref: 'PEND-4' });

await Store.login('admin', 'nextgen2026');
const s3 = await Store.paymentStats();
step('pending now: ' + s3.counts.pending + ' rows / ' + s3.amounts.pending + ' tk');

console.log('== STEP 7: the member portal sees the same numbers ==');
const memberRows = (await Store.listPayments()).filter((p) => p.memberId === member.id);
const mStats = U.summarisePayments(memberRows);
step('member ledger: ' + memberRows.map((p) => p.ref + ':' + p.status).join(', '));
check('P22 the member footer counts only real pending rows', mStats.counts.pending === 2 && mStats.counts.verified === 2 && mStats.counts.rejected === 1, JSON.stringify(mStats.counts));
check('P23 the member pending amount is the two open rows only (2,000)', mStats.amounts.pending === 2000, 'pending amount=' + mStats.amounts.pending);
check('P24 the rejected 1,000 never counts as money received', mStats.amounts.verified === 8000, 'verified=' + mStats.amounts.verified);

console.log('== STEP 8: legacy duplicate rows are surfaced for the admin to fix ==');
const dbx = Store._d();
dbx.payments.unshift({
  id: 'p-legacy-dup', memberId: member.id, memberName: member.fullName, type: 'due', method: 'bkash',
  amount: 1000, date: '2026-09-16', ref: 'PEND-4', senderNumber: '', note: 'legacy row, injected by the test',
  status: 'verified', submittedAt: '2026-09-16T00:00:00.000Z', verifiedAt: '2026-09-16T00:00:00.000Z', verifiedBy: 'admin', rejectReason: ''
});
Store._save();
const s4 = await Store.paymentStats();
const dup = s4.duplicates.filter((d) => d.ref === 'PEND-4')[0];
step('duplicates: ' + JSON.stringify(s4.duplicates.map((d) => d.ref + ' x' + d.count + ' = ' + d.amount)));
check('P25 a legacy row with a repeated reference is reported as a duplicate', !!dup && dup.count === 2 && dup.amount === 2000);
check('P26 the duplicate is still counted once per row in the totals', s4.amounts.verified === s3.amounts.verified + 1000);

console.log('== STEP 9: bad filters fail loudly instead of silently matching everything ==');
let threw = 0;
for (const bad of ['foo', { status: 'foo' }, 'PENDING ']) {
  try { await Store.listPayments(bad); } catch (e) { threw++; }
}
check('P27 an unknown status throws instead of returning every payment', threw === 3, 'threw=' + threw);
let okAll = 0;
for (const good of [null, undefined, '']) {
  const r = await Store.listPayments(good);
  if (r.length === s4.counts.all) okAll++;
}
check('P28 a null/empty filter still means "everything"', okAll === 3, 'ok=' + okAll);

console.log('== STEP 10: a state change cannot be applied twice ==');
let doubleThrew = false;
const verifiedOne = (await Store.listPayments()).filter((p) => p.status === 'verified')[0];
try { await Store.verifyPayment(verifiedOne.id); } catch (e) { doubleThrew = true; }
check('P29 verifying an already verified payment is refused', doubleThrew);
let rejectThrew = false;
try { await Store.rejectPayment(verifiedOne.id, 'x'); } catch (e) { rejectThrew = true; }
check('P30 rejecting an already verified payment is refused', rejectThrew);
const s5 = await Store.paymentStats();
check('P31 the refused attempts changed nothing', s5.counts.verified === s4.counts.verified && s5.amounts.all === s4.amounts.all);

console.log('== STEP 11: the member balance agrees with the ledger buckets ==');
const bal = (await Store.getMemberDetail(member.id)).balance;
const mRows2 = U.summarisePayments((await Store.listPayments()).filter((p) => p.memberId === member.id));
step('member balance: paid=' + bal.paid + ' pending=' + bal.pending + ' due=' + bal.due + ' advance=' + bal.advance);
check('P32 paid equals the verified rows of this member (8,000 + the injected 1,000)', bal.paid === mRows2.amounts.verified, 'paid=' + bal.paid + ' verified rows=' + mRows2.amounts.verified);
check('P33 pending equals the open rows of this member (2,000)', bal.pending === mRows2.amounts.pending, 'pending=' + bal.pending + ' rows=' + mRows2.amounts.pending);

console.log('== STEP 12: the audit log records every state change ==');
const auditLog = await Store.listAudit ? await Store.listAudit() : (Store._d().audit || []);
const acts = (auditLog || []).map((x) => x.action);
step('audit actions seen: ' + JSON.stringify(Array.from(new Set(acts)).slice(0, 12)));
check('P34 verification and rejection are both in the audit log', acts.indexOf('payment-verified') >= 0 && acts.indexOf('payment-rejected') >= 0);
check('P35 a manual entry is in the audit log', acts.indexOf('payment-recorded-manually') >= 0);
check('P36 submissions are in the audit log', acts.indexOf('payment-submitted') >= 0);

console.log(fails === 0 ? 'PENDING TESTS: ALL PASS (' + n + ' checks)' : 'PENDING TESTS: ' + fails + ' FAILURES of ' + n);
process.exit(fails === 0 ? 0 : 1);
