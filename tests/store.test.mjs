/* NextGen Fund — end-to-end store test (Node, no dependencies)
   Run:  node tests/store.test.mjs
   Covers the full verification plan at the data-layer level:
   register → approve/reject → login → payments → verify → balances →
   finance edits → dashboard snapshot → CSV exports → access checks. */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const dir = new URL('../assets/js/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/* ---- localStorage shim (must exist before store.js loads) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const U = require(dir + 'util.js');
const Store = require(dir + 'store.js');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
async function throws(fn, codePart, name) {
  try { await fn(); ok(name, false, 'expected an error, got none'); }
  catch (e) { ok(name, String(e.message + ' ' + (e.code || '')).toLowerCase().includes(codePart.toLowerCase()), 'got: ' + e.message); }
}

console.log('== 0 · sha256 sanity ==');
ok('sha256("abc")', U.sha256('abc') === crypto.createHash('sha256').update('abc').digest('hex'));
ok('sha256("nextgen123")', U.sha256('nextgen123') === crypto.createHash('sha256').update('nextgen123').digest('hex'));
ok('monthsInclusive(2026-01..2026-09)=9', U.monthsInclusive('2026-01', '2026-09') === 9);

console.log('== 1 · fresh demo store & seed ==');
await Store.init();
ok('mode is demo', Store.mode === 'demo');
ok('seeded admin exists', await Store.adminExists() === true);
const snap0 = await Store.getPublicSnapshot();
ok('seed total funding = 162000', snap0.totalFunding === 162000, 'got ' + snap0.totalFunding);
ok('seed months = 9', snap0.months.length === 9);
ok('seed member count = 14', snap0.memberCount === 14);
ok('monthly deposit 2026-01 = 21000', snap0.months[0].funding === 21000);
ok('monthly deposit 2026-09 = 7000', snap0.months[8].funding === 7000);

console.log('== 2 · admin login (positive + negative) ==');
await throws(() => Store.login('admin', 'wrong-pass'), 'wrong', 'wrong password rejected');
await throws(() => Store.listRegistrations(), 'admin', 'visitor cannot list registrations');
const adminSess = await Store.login('admin', 'nextgen2026');
ok('admin login ok', adminSess.role === 'admin');

console.log('== 3 · finance manager: edit cycle → dashboard reflects ==');
await Store.upsertFinanceEntry({ kind: 'revenue', month: '2026-09', amount: 5000, note: 'test revenue' });
await Store.upsertFinanceEntry({ kind: 'loss', month: '2026-08', amount: 1200, note: 'test loss' });
const snap1 = await Store.getPublicSnapshot();
ok('total revenue updated to 5000', snap1.totalRevenue === 5000);
ok('total loss updated to 1200', snap1.totalLoss === 1200);
ok('net = funding + revenue − loss', snap1.net === 162000 + 5000 - 1200, 'got ' + snap1.net);
const m09 = snap1.months.find((m) => m.month === '2026-09');
ok('2026-09 row carries funding+revenue', m09.funding === 7000 && m09.revenue === 5000);
await Store.saveSettings({ nextMeeting: '2026-10-09', meetingNote: 'E2E test meeting' });
const snap2 = await Store.getPublicSnapshot();
ok('next meeting date reflected without code change', snap2.nextMeeting === '2026-10-09');

console.log('== 4 · registrations with documents ==');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const regA = {
  fullName: 'Test Member One', username: 'test.member.one', email: 'test.one@example.com',
  phone: '01711111111', address: 'Dhaka', occupation: 'Engineer', nominee: 'Test Nominee', shares: '1',
  password: 'testpass123',
  docs: [
    { kind: 'Photo ID (NID / Birth Certificate)', name: 'id.png', mime: 'image/png', size: 96, data: tinyPng },
    { kind: 'Passport-size Photograph', name: 'photo.png', mime: 'image/png', size: 96, data: tinyPng }
  ]
};
const regB = { ...regA, fullName: 'Test Member Two', username: 'test.member.two', email: 'test.two@example.com', phone: '01722222222' };
await Store.register(regA);
await Store.register(regB);
const pend = await Store.listRegistrations('pending');
ok('2 new registrations pending (plus 1 seeded sample)', pend.length === 3, 'got ' + pend.length);
ok('documents stored with the pending record', pend.find((r) => r.username === 'test.member.one').docs.length === 2);
await Store.register({ ...regA, username: 'nodocs.member', email: 'nodocs.member@nextgen.local', docs: [] });
const nod = (await Store.listRegistrations()).find((r) => r.username === 'nodocs.member');
ok('registration without documents now allowed (admin collects files directly)', !!nod && nod.docs.length === 0);
await throws(() => Store.register({ ...regA, username: 'test.member.one', email: 'other@x.com' }), 'taken', 'duplicate username rejected');

console.log('== 5 · admin accept / reject decisions ==');
const regAid = pend.find((r) => r.username === 'test.member.one').id;
const regBid = pend.find((r) => r.username === 'test.member.two').id;
const decA = await Store.decideRegistration(regAid, true, '');
ok('approve recorded with timestamp', !!decA.decidedAt && decA.status === 'approved');
await Store.decideRegistration(regBid, false, 'documents unreadable');
const decided = (await Store.listRegistrations()).find((r) => r.id === regBid);
ok('reject recorded with reason', decided.status === 'rejected' && decided.note === 'documents unreadable');

console.log('== 6 · member login rules ==');
await Store.login('admin', 'nextgen2026'); // back to admin
const mA = await Store.login('test.member.one', 'testpass123');
ok('approved member can log in', mA.role === 'member');
await throws(() => Store.login('test.member.two', 'testpass123'), 'not approved', 'rejected applicant cannot log in');

console.log('== 7 · member balance & payment submission ==');
let acc = await Store.getMyAccount();
ok('new member expected = 1 month × 1000', acc.balance.expected === 1000, 'got ' + acc.balance.expected);
ok('due = 1000 before paying', acc.balance.due === 1000 && acc.balance.paid === 0);
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-09', ref: 'TXN-A1', senderNumber: '01711111111', note: 'Sep due' });
await Store.submitPayment({ type: 'advance', method: 'nagad', amount: 3000, date: '2026-09-09', ref: 'TXN-A2' });
await Store.submitPayment({ type: 'due', method: 'bank', amount: 1000, date: '2026-09-09', ref: 'BNK-77' });
await throws(() => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-09', ref: 'TXN-A1' }), 'already submitted', 'duplicate transaction ID rejected');
await throws(() => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-09', ref: 'x' }), 'reference', 'short transaction ID rejected');
const myPays = await Store.getMyPayments();
ok('member sees exactly own 3 payments', myPays.length === 3 && myPays.every((p) => p.memberName === 'Test Member One'));

console.log('== 8 · admin verification → balances update ==');
await Store.login('admin', 'nextgen2026');
const pendingPays = await Store.listPayments({ status: 'pending' });
const ids = Object.fromEntries(pendingPays.map((p) => [p.ref, p.id]));
ok('3 pending payments visible to admin', pendingPays.length === 3);
await Store.verifyPayment(ids['TXN-A1']);
await Store.rejectPayment(ids['BNK-77'], 'no matching bank statement entry');
await Store.verifyPayment(ids['TXN-A2']);
await Store.login('test.member.one', 'testpass123');
acc = await Store.getMyAccount();
ok('verified due payment clears due (1000−1000=0)', acc.balance.due === 0, 'due=' + acc.balance.due);
ok('verified advance = 3000', acc.balance.advance === 3000);
ok('total paid = 4000 (due 1000 + advance 3000)', acc.balance.paid === 4000, 'paid=' + acc.balance.paid);
ok('rejected payment not counted & reason stored', acc.payments.find((p) => p.ref === 'BNK-77').rejectReason.includes('bank'));

console.log('== 9 · manual admin payment entry ==');
await Store.login('admin', 'nextgen2026');
const members = await Store.listMembers();
const me = members.find((m) => m.username === 'test.member.one');
await Store.addManualPayment({ memberId: me.id, type: 'due', method: 'cash', amount: 3000, date: '2026-09-09', ref: 'CASH-1', note: 'collected at meeting' });
acc = await Store.getMemberDetail(me.id);
ok('manual cash payment verified immediately', acc.balance.paid === 7000 && acc.balance.due === 0, 'paid=' + acc.balance.paid);

console.log('== 9b · payment edge-case matrix (clarity audit evidence) ==');
// E1: pending payments must NOT count in the balance until verified
await Store.login('admin', 'nextgen2026');
const memE = members.find((m) => m.username === 'test.member.one');
const balBefore = (await Store.getMemberDetail(memE.id)).balance;
await Store.login('test.member.one', 'testpass123');
await Store.submitPayment({ type: 'due', method: 'rocket', amount: 1000, date: '2026-09-09', ref: 'RKT-E1' });
const balPending = (await Store.getMyAccount()).balance;
ok('E1 pending payment does not change balance', balPending.paid === balBefore.paid && balPending.due === balBefore.due, `paid ${balPending.paid}`);
// E2: verifying it applies immediately
await Store.login('admin', 'nextgen2026');
const pend2 = await Store.listPayments({ status: 'pending' });
const e1 = pend2.find((p) => p.ref === 'RKT-E1');
await Store.verifyPayment(e1.id);
const balE2 = (await Store.getMemberDetail(memE.id)).balance;
ok('E2 verification applies amount immediately', balE2.paid === balBefore.paid + 1000, 'paid=' + balE2.paid);
// E3: overpaying due floors at 0 and does not create advance
await Store.login('test.member.one', 'testpass123');
await Store.submitPayment({ type: 'due', method: 'upay', amount: 99000, date: '2026-09-09', ref: 'UPY-E3' });
await Store.login('admin', 'nextgen2026');
await Store.verifyPayment((await Store.listPayments({ status: 'pending' })).find((p) => p.ref === 'UPY-E3').id);
const balE3 = (await Store.getMemberDetail(memE.id)).balance;
ok('E3 overpay of due floors due at 0', balE3.due === 0, 'due=' + balE3.due);
// E4: rejected submission allows resubmitting the same TrxID
await Store.login('test.member.one', 'testpass123');
await Store.submitPayment({ type: 'advance', method: 'bkash', amount: 1000, date: '2026-09-09', ref: 'BK-E4' });
await Store.login('admin', 'nextgen2026');
await Store.rejectPayment((await Store.listPayments({ status: 'pending' })).find((p) => p.ref === 'BK-E4').id, 'wrong amount');
await Store.login('test.member.one', 'testpass123');
await Store.submitPayment({ type: 'advance', method: 'bkash', amount: 2000, date: '2026-09-09', ref: 'BK-E4' });
ok('E4 rejected TrxID can be resubmitted', true);
// E5: every payment (incl. rejected) is traceable in the ledger
const allPays = await (async () => { await Store.login('admin', 'nextgen2026'); return Store.listPayments(); })();
ok('E5 ledger contains pending/verified/rejected records',
  ['pending', 'verified', 'rejected'].every((s) => allPays.some((p) => p.status === s)),
  `total ${allPays.length} records`);
const csvLedger = await Store.exportPaymentsCSV();
ok('E5b ledger CSV exportable with statuses', csvLedger.includes('RKT-E1') && csvLedger.includes('BK-E4'));
await Store.login('test.member.one', 'testpass123'); // restore session for step 10


console.log('== 10 · access isolation ==');
await Store.login('test.member.one', 'testpass123');
await throws(() => Store.listMembers(), 'admin', 'member cannot list all members');
await throws(() => Store.listPayments(), 'admin', 'member cannot list all payments');
await throws(() => Store.verifyPayment('p-001'), 'admin', 'member cannot verify payments');
await throws(() => Store.exportPaymentsCSV(), 'admin', 'member cannot export ledger');
const mine = await Store.getMyPayments();
ok('member ledger contains only own payments', mine.every((p) => p.memberName === 'Test Member One'));
await Store.logout();
await throws(() => Store.listRegistrations(), 'admin', 'logged-out visitor blocked from admin APIs');
await throws(() => Store.getMyAccount(), 'log in', 'logged-out visitor blocked from portal APIs');

console.log('== 11 · password change ==');
await Store.login('test.member.one', 'testpass123');
await Store.changePassword('testpass123', 'newpass45678');
await throws(() => Store.login('test.member.one', 'testpass123'), 'wrong', 'old password no longer works');
ok('new password works', (await Store.login('test.member.one', 'newpass45678')).role === 'member');

console.log('== 12 · CSV exports ==');
await Store.login('admin', 'nextgen2026');
const memCsv = await Store.exportMembersCSV();
const payCsv = await Store.exportPaymentsCSV();
const finCsv = await Store.exportFinanceCSV();
ok('members CSV contains test member with balances', memCsv.includes('Test Member One') && memCsv.includes('107000'));
ok('members CSV has 14 seeded + 1 new member rows', memCsv.trim().split('\n').length === 16, 'lines=' + memCsv.trim().split('\n').length);
const payLines = payCsv.trim().split('\n');
ok('payments CSV = 106 seeded + 8 new + header', payLines.length === 115, 'lines=' + payLines.length);
ok('payments CSV carries methods/refs/status', payCsv.includes('TXN-A1') && payCsv.includes('bkash') && payCsv.includes('verified') && payCsv.includes('rejected'));
ok('finance CSV contains the test revenue entry', finCsv.includes('revenue,2026-09,5000'));

console.log('== 13 · audit trail ==');
const audit = await Store.listAudit();
ok('audit records admin decisions', audit.some((a) => a.action === 'registration-approved') && audit.some((a) => a.action === 'payment-verified'));
ok('audit records submissions', audit.some((a) => a.action === 'payment-submitted'));

console.log('\n================================');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

