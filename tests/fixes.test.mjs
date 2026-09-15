/* Tests for the new fixes: pending-aware due, deposit-funded totals, admin profile, edge cases */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');

const tinyDocs = ['nid-front', 'nid-back', 'profile-picture', 'nominee-passport-photo'].map((k) => ({
  kind: k, name: k + '.png', mime: 'image/png', size: 96,
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
}));

let fails = 0;
function check(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')); if (!cond) fails++; }
async function expectThrow(name, fn, code) {
  try { await fn(); check(name, false, 'no error'); }
  catch (e) { check(name, !code || e.code === code, e.code + ' ' + e.message); }
}

Store._demoReset();
await Store.init();

/* ---- member: register -> approve ---- */
await Store.register({ fullName: 'Fix Test Member', username: 'fix.test', email: 'fix.test@nextgen.local', phone: '01711111111', occupation: '', nominee: 'Test Nominee', nomineeAddress: 'Test address', joinMonth: U.currentMonth(), address: '', shares: 1, password: 'FixPass1234', docs: tinyDocs.map((d) => Object.assign({}, d)) });
await Store.login('admin', 'nextgen2026');
const regs = await Store.listRegistrations();
const reg = regs.find((r) => r.username === 'fix.test');
check('registration created', !!reg);
await Store.decideRegistration(reg.id, true);
await Store.logout();

await Store.login('fix.test', 'FixPass1234');
let acc = await Store.getMyAccount();
check('new member monthlyDue = 1000', acc.profile.monthlyDue === 1000);
check('new member due = 1000 (1 month)', acc.balance.due === 1000, 'due=' + acc.balance.due);
check('nothing pending yet', acc.balance.pendingDue === 0);

/* ---- submitting a due payment immediately reduces the due ---- */
const beforeTotal = (await Store.getPublicSnapshot()).totalFunding;
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'FIXTEST-1000' });
acc = await Store.getMyAccount();
check('due drops to 0 right after submitting (pending counts)', acc.balance.due === 0, 'due=' + acc.balance.due);
check('pendingDue shows 1000', acc.balance.pendingDue === 1000);
check('dueVerified still 1000 (not yet approved)', acc.balance.dueVerified === 1000);
const midTotal = (await Store.getPublicSnapshot()).totalFunding;
check('pending payment does NOT enter the fund total yet', midTotal === beforeTotal, midTotal + ' vs ' + beforeTotal);

/* ---- admin approves -> fund total grows by exactly the deposit ---- */
await Store.logout();
await Store.login('admin', 'nextgen2026');
const pays = await Store.listPayments();
const mine = pays.find((p) => p.ref === 'FIXTEST-1000');
await Store.verifyPayment(mine.id);
const afterTotal = (await Store.getPublicSnapshot()).totalFunding;
check('approval adds exactly 1000 to the fund total (no manual entry)', afterTotal === beforeTotal + 1000, afterTotal + ' vs ' + (beforeTotal + 1000));
const snapRow = (await Store.getPublicSnapshot()).months.filter((m) => m.month === '2026-09')[0];
check('September row: funding equals member deposits (incl. the new 1000)', !!snapRow && snapRow.deposits >= 1000 && snapRow.funding === snapRow.deposits, JSON.stringify(snapRow));

/* ---- admin profile: name + password ---- */
await Store.updateMyName('Kazi Atiqur Rahman');
await Store.logout();
const sess = await Store.login('admin', 'nextgen2026');
check('admin display name saved', sess.fullName === 'Kazi Atiqur Rahman', sess.fullName);
await expectThrow('wrong current password rejected', () => Store.changePassword('WRONG-PASS', 'NewAdminPass9'), 'wrong-credentials');
await Store.changePassword('nextgen2026', 'NewAdminPass9');
await Store.logout();
await expectThrow('old password no longer works', () => Store.login('admin', 'nextgen2026'), 'wrong-credentials');
const s2 = await Store.login('admin', 'NewAdminPass9');
check('new password works + secret stays persisted', s2.role === 'admin');
await Store.logout();
const s3 = await Store.login('admin', 'NewAdminPass9');
check('new password persists across re-login', s3.role === 'admin');

/* ---- edge cases never break the balances ---- */
await Store.logout();
await Store.login('fix.test', 'FixPass1234');
await expectThrow('zero amount rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 0, date: '2026-09-14', ref: 'EDGE-0' }), 'invalid');
await expectThrow('negative amount rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: -1000, date: '2026-09-14', ref: 'EDGE-NEG' }), 'invalid');
await expectThrow('non-multiple rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1500, date: '2026-09-14', ref: 'EDGE-1500' }), 'invalid');
await expectThrow('string amount rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 'abc', date: '2026-09-14', ref: 'EDGE-STR' }), 'invalid');
await expectThrow('duplicate reference rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'FIXTEST-1000' }), 'dup-ref');
const acc2 = await Store.getMyAccount();
check('balance still coherent after bad inputs (due 0, paid 1000)', acc2.balance.due === 0 && acc2.balance.paid === 1000, JSON.stringify(acc2.balance));
check('no negative amounts anywhere', acc2.balance.due >= 0 && acc2.balance.paid >= 0);

console.log(fails === 0 ? 'FIX TESTS: ALL PASS' : 'FIX TESTS: ' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
