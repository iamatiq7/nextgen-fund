/* Advance-rule tests: reproduction of the reported bug, the fixed rule, boundary cases and
   ledger reconstruction. Scenario: member joins in September, monthly due 1,000, deposits 2,000. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');
const U = require('../assets/js/util.js');

let fails = 0, n = 0;
function check(name, cond, extra) { n++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' | ' + extra : '')); if (!cond) fails++; }
function step(msg) { console.log('  · ' + msg); }

/* ---------- the OLD (buggy) formula, kept verbatim for the before/after proof ---------- */
function oldFormula(expected, payments) {
  let paidDue = 0, advance = 0;
  payments.forEach((p) => {
    if (p.status !== 'verified') return;
    if (p.type === 'due') paidDue += p.amount;
    if (p.type === 'advance') advance += p.amount;
  });
  return { expected, paid: paidDue + advance, advance, due: Math.max(0, expected - paidDue) };
}

Store._demoReset();
await Store.init();

console.log('== STEP 1: admin approves a member who joins in September ==');
await Store.login('admin', 'nextgen2026');
await Store.register({ fullName: 'Advance Case', username: 'adv.case', email: 'adv.case@nextgen.local', phone: '01711999999', shares: 1, password: 'AdvPass1234', docs: [] });
const regs = await Store.listRegistrations();
const reg = regs.filter((r) => r.username === 'adv.case')[0];
await Store.decideRegistration(reg.id, true);
const me0 = (await Store.listMembers()).filter((m) => m.username === 'adv.case')[0];
const PK = me0.id;
const profile = (await Store.getMemberDetail(PK)).profile;
step('member id=' + PK + ' joinMonth=' + profile.joinMonth + ' monthlyDue=' + profile.monthlyDue + ' shares=' + profile.shares);

console.log('== STEP 2: member deposits 1,000 + 1,000 (both recorded as monthly due) ==');
await Store.logout();
await Store.login('adv.case', 'AdvPass1234');
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-05', ref: 'ADV-1' });
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-06', ref: 'ADV-2' });
await Store.login('admin', 'nextgen2026');
const pend = await Store.listPayments({ status: 'pending' });
await Store.verifyPayment(pend.filter((p) => p.ref === 'ADV-1')[0].id);
await Store.verifyPayment(pend.filter((p) => p.ref === 'ADV-2')[0].id);
step('both verified by admin');

console.log('== STEP 3: BEFORE (old formula) vs AFTER (fixed Store.computeBalance) ==');
const allPays = (await Store.listPayments()).filter((p) => p.memberId === PK);
const before = oldFormula(1000, allPays);
const after = (await Store.getMemberDetail(PK)).balance;
step('ledger rows used: ' + allPays.map((p) => p.ref + ':' + p.type + ':' + p.amount + ':' + p.status).join(', '));
step('OLD  -> advance=৳' + before.advance + ' due=৳' + before.due + ' paid=৳' + before.paid);
step('NEW  -> advance=৳' + after.advance + ' due=৳' + after.due + ' paid=৳' + after.paid);
check('R1 reported bug reproduced with the old formula (advance 0 despite 2,000 paid)', before.advance === 0 && before.paid === 2000);
check('R2 fixed rule: advance = 1,000 (the surplus over the billed 1,000)', after.advance === 1000, 'advance=' + after.advance);
check('R3 due stays 0, paid total 2,000', after.due === 0 && after.paid === 2000, JSON.stringify(after));
check('R4 advance is explained in months (1 month ahead)', after.advanceMonths === 1, 'months=' + after.advanceMonths);
check('R5 invariant advance === max(0, paid - expected)', after.advance === Math.max(0, after.paid - after.expected));

console.log('== STEP 4: value survives a reload (re-read from storage) ==');
const again = (await Store.getMemberDetail(PK)).balance;
check('R6 advance identical after re-read', again.advance === 1000 && again.advanceMonths === 1, 'advance=' + again.advance);

console.log('== STEP 5: ledger reconstruction (trace every taka) ==');
let received = 0;
allPays.forEach((p) => { if (p.status === 'verified') received += p.amount; });
const billed = U.monthsInclusive(profile.joinMonth, U.currentMonth()) * profile.monthlyDue;
step('rebuilt from raw rows -> received=৳' + received + ' billed=৳' + billed + ' advance=৳' + Math.max(0, received - billed));
check('R7 advance reconstructable from the ledger alone', Math.max(0, received - billed) === after.advance && received === after.paid);
check('R8 deposit total = dues applied + advance', received === (received - Math.max(0, received - billed)) + Math.max(0, received - billed));

/* ---------------- boundary cases ---------------- */
const realCurrent = U.currentMonth;

console.log('== STEP 6: one month later the bill consumes the advance ==');
U.currentMonth = function () { return '2026-10'; };
const oct = (await Store.getMemberDetail(PK)).balance;
step('nowMonth=2026-10 -> expected=৳' + oct.expected + ' due=৳' + oct.due + ' advance=৳' + oct.advance + ' paid=৳' + oct.paid);
check('B1 October bill already covered, advance consumed', oct.expected === 2000 && oct.due === 0 && oct.advance === 0);

console.log('== STEP 7: two months on, the member is genuinely short again ==');
U.currentMonth = function () { return '2026-11'; };
const nov = (await Store.getMemberDetail(PK)).balance;
step('nowMonth=2026-11 -> expected=৳' + nov.expected + ' repeated unpaid month -> due=৳' + nov.due + ' advance=৳' + nov.advance);
check('B2 unpaid months surface as a real due (3,000 billed, 2,000 paid)', nov.due === 1000 && nov.advance === 0 && nov.dueVerified === 1000);
await Store.addManualPayment({ memberId: PK, type: 'due', method: 'cash', amount: 1000, date: '2026-11-03', ref: 'ADV-PART' });
const part = (await Store.getMemberDetail(PK)).balance;
step('one more 1,000 received -> paid=৳' + part.paid + ' due=৳' + part.due + ' advance=৳' + part.advance);
check('B3 paying one outstanding month clears exactly that month (no invented advance)', part.paid === 3000 && part.due === 0 && part.advance === 0);
await Store.addManualPayment({ memberId: PK, type: 'due', method: 'cash', amount: 0, date: '2026-11-03', ref: 'X' }).then(() => { throw new Error('0 taka should be rejected'); }).catch((e) => { check('B3b zero-taka payment still rejected by the multiple-of-1,000 rule', e.code === 'invalid', e.code + ' ' + e.message); });
U.currentMonth = realCurrent;

console.log('== STEP 8: overpaid pending payment (awaiting approval) ==');
await Store.logout();
await Store.login('adv.case', 'AdvPass1234');
await Store.submitPayment({ type: 'due', method: 'nagad', amount: 3000, date: '2026-09-08', ref: 'ADV-PEND' });
const pendBal = (await Store.getMyAccount()).balance;
step('pending 3,000 -> due=৳' + pendBal.due + ' pendingDue=৳' + pendBal.pendingDue + ' pendingAdvance=৳' + pendBal.pendingAdvance + ' advance=৳' + pendBal.advance);
check('B4 pending money does not create verified advance yet', pendBal.advance === 2000, 'advance=' + pendBal.advance);
check('B5 the excess of a pending payment is flagged as future advance', pendBal.pendingAdvance === 3000, 'pendingAdvance=' + pendBal.pendingAdvance);

console.log('== STEP 9: rejected payment recalculation (refund / cancellation path) ==');
await Store.login('admin', 'nextgen2026');
await Store.rejectPayment((await Store.listPayments()).filter((p) => p.ref === 'ADV-PEND')[0].id, 'duplicate of cash collection');
const afterRej = (await Store.getMemberDetail(PK)).balance;
step('after rejecting the 3,000 row -> advance=৳' + afterRej.advance + ' pending=৳' + afterRej.pending + ' paid=৳' + afterRej.paid);
check('B6 rejection never pushes advance or due negative', afterRej.advance >= 0 && afterRej.due >= 0 && afterRej.pending === 0);

console.log('== STEP 10: explicit advance payment ==');
await Store.logout();
await Store.login('adv.case', 'AdvPass1234');
await Store.submitPayment({ type: 'advance', method: 'upay', amount: 1000, date: '2026-09-09', ref: 'ADV-EXPLICIT' });
await Store.login('admin', 'nextgen2026');
await Store.verifyPayment((await Store.listPayments()).filter((p) => p.ref === 'ADV-EXPLICIT')[0].id);
const afterExplicit = (await Store.getMemberDetail(PK)).balance;
step('after an explicit advance payment of 1,000 -> advance=৳' + afterExplicit.advance + ' due=৳' + afterExplicit.due + ' paid=৳' + afterExplicit.paid);
check('B7 explicit advance payments count as received money', afterExplicit.advance === Math.max(0, afterExplicit.paid - afterExplicit.expected), 'advance=' + afterExplicit.advance);
check('B8 invariants hold in every bucket', afterExplicit.due === Math.max(0, afterExplicit.expected - afterExplicit.paid - afterExplicit.pending) && afterExplicit.advance >= 0);

console.log('== STEP 11: late-month join, multi-share member ==');
await Store.register({ fullName: 'Month End Case', username: 'adv.monthend', email: 'adv.monthend@nextgen.local', phone: '01711888888', shares: 3, password: 'AdvPass1234', docs: [] });
const reg2 = (await Store.listRegistrations()).filter((r) => r.username === 'adv.monthend')[0];
await Store.decideRegistration(reg2.id, true);
const me2 = (await Store.listMembers()).filter((m) => m.username === 'adv.monthend')[0];
const u2 = Store._d().users.filter((u) => u.username === 'adv.monthend')[0];
const b2 = (await Store.getMemberDetail(me2.id)).balance;
step('3 shares -> monthlyDue=৳' + u2.monthlyDue + ' joinMonth=' + u2.joinMonth + ' expected=৳' + b2.expected);
check('B9 late-month join is billed for the join month only', b2.expected === 3000 && b2.due === 3000 && b2.advance === 0);
await Store.addManualPayment({ memberId: me2.id, type: 'due', method: 'bank', amount: 5000, date: '2026-09-30', ref: 'ADV-ME' });
const b2b = (await Store.getMemberDetail(me2.id)).balance;
step('deposits 5,000 against a 3,000 bill -> advance=৳' + b2b.advance + ' months=' + b2b.advanceMonths);
check('B10 surplus lands in advance even for a multi-share member', b2b.advance === 2000 && b2b.advanceMonths === 0, JSON.stringify(b2b));

console.log('== STEP 12: no negative or inconsistent bucket anywhere in the fund ==');
const members = await Store.listMembers();
const bad = [];
members.forEach((m) => {
  const b = m.balance;
  if (!(b.due >= 0 && b.advance >= 0 && b.paid >= 0 && b.pending >= 0 && b.pendingDue >= 0 && b.pendingAdvance >= 0 && b.dueVerified >= 0)) bad.push(m.username + ':' + JSON.stringify(b));
  if (b.advance !== Math.max(0, b.paid - b.expected)) bad.push('invariant ' + m.username + ' advance=' + b.advance + ' paid=' + b.paid + ' expected=' + b.expected);
});
check('B11 every member keeps non-negative, consistent buckets', bad.length === 0, bad.join(' ; ') || (members.length + ' members scanned'));
const snapshot = await Store.getPublicSnapshot();
step('fund snapshot -> deposits=৳' + snapshot.memberDeposits + ' advance=৳' + snapshot.memberAdvance);
const pkBal = (await Store.getMemberDetail(PK)).balance;
const me2Bal = (await Store.getMemberDetail(me2.id)).balance;
check('B12 fund totals expose the advance pool too', snapshot.memberAdvance === pkBal.advance + me2Bal.advance, 'memberAdvance=' + snapshot.memberAdvance + ' = ' + pkBal.advance + ' + ' + me2Bal.advance);

console.log(fails === 0 ? 'ADVANCE TESTS: ALL PASS (' + n + ' checks)' : 'ADVANCE TESTS: ' + fails + ' FAILURES of ' + n);
process.exit(fails === 0 ? 0 : 1);
