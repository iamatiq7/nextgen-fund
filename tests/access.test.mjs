/* Access-control & credit-rule tests (role gating data layer + 1000 tk multiples) */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');

let fails = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails++; }
async function expectReject(name, fn, code) {
  try { await fn(); check(name + ' (rejected)', false); }
  catch (e) { check(name + ' (rejected, ' + (code || e.code) + ')', !code || e.code === code); }
}

// fresh store + member session
Store._demoReset();
await Store.init();
const member = await Store.login('kazi.sujon', 'nextgen123'); // 1 share, monthlyDue 1000
check('member session', member.role === 'member');

// --- 1000 tk multiples: rejected amounts ---
await expectReject('credit 100 tk', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 100, date: '2026-09-10', ref: 'MULTI-TEST-100' }));
await expectReject('credit 500 tk', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 500, date: '2026-09-10', ref: 'MULTI-TEST-500' }));
await expectReject('credit 999 tk', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 999, date: '2026-09-10', ref: 'MULTI-TEST-999' }));
await expectReject('credit 1500 tk', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1500, date: '2026-09-10', ref: 'MULTI-TEST-1500' }));
await expectReject('credit 2500 tk (advance)', () => Store.submitPayment({ type: 'advance', method: 'nagad', amount: 2500, date: '2026-09-10', ref: 'MULTI-TEST-2500' }));

// --- accepted amounts ---
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-10', ref: 'MULTI-OK-1000' });
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 2000, date: '2026-09-10', ref: 'MULTI-OK-2000' });
await Store.submitPayment({ type: 'advance', method: 'bkash', amount: 5000, date: '2026-09-10', ref: 'MULTI-OK-5000' });
let pays = await Store.getMyPayments();
check('1000 accepted + pending', pays.some(p => p.ref === 'MULTI-OK-1000' && p.amount === 1000 && p.status === 'pending'));
check('2000 accepted', pays.some(p => p.ref === 'MULTI-OK-2000' && p.amount === 2000));
check('5000 advance accepted', pays.some(p => p.ref === 'MULTI-OK-5000' && p.amount === 5000));

// --- admin manual recording follows the same rule ---
await Store.logout();
await Store.login('admin', 'nextgen2026');
const members = await Store.listMembers();
const sujon = members.find(m => m.username === 'kazi.sujon');
await expectReject('admin manual 500 tk', () => Store.addManualPayment({ memberId: sujon.id, type: 'due', method: 'cash', amount: 500 }));
await Store.addManualPayment({ memberId: sujon.id, type: 'due', method: 'cash', amount: 3000, note: 'Sep cash' });
pays = await Store.getMyPayments.call(Store); // wrong session (admin) -> should throw? getMyPayments requires login, admin IS logged in; returns admin's own (none). Use admin view instead:
const adminPays = await Store.listPayments();
check('admin manual 3000 recorded verified', adminPays.some(p => p.memberId === sujon.id && p.amount === 3000 && p.status === 'verified' && p.note.includes('recorded by admin')));

// --- ledger traceability: entries survive reset of in-memory cache (re-init) ---
await Store.init();
const again = await Store.listPayments();
check('ledger persists after re-init', again.some(p => p.ref === 'MULTI-OK-1000') && again.some(p => p.memberId === sujon.id && p.amount === 3000));

console.log(fails === 0 ? 'ACCESS TESTS: ALL PASS' : 'ACCESS TESTS: ' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
