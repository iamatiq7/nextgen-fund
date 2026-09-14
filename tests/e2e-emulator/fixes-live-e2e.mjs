/* E2E with the REAL production adapter code against the Firestore/Auth emulator.
   Proves: pending payment reduces due, approval auto-feeds the fund totals, admin name/password, edge guards. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SITE = '../../assets/js/';

globalThis.window = globalThis;
globalThis.self = globalThis;
window.NGF_FIREBASE_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-nextgen-fund.firebaseapp.com',
  projectId: 'demo-nextgen-fund',
  storageBucket: 'demo-nextgen-fund.appspot.com',
  messagingSenderId: '1',
  appId: '1:1:web:1'
};

window.NGFUtil = require(SITE + 'util.js');
const Store = require(SITE + 'store.js');
window.NGFStore = Store;
require('./adapter-live.js');

let fails = 0;
function check(n, c, x) { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? ' | ' + x : '')); if (!c) fails++; }
async function expectThrow(n, fn, code) {
  try { await fn(); check(n, false, 'no error'); }
  catch (e) { check(n, !code || e.code === code, (e.code || '?') + ' ' + (e.message || '').slice(0, 80)); }
}

await Store.init();
check('real adapter boots against emulator', Store.mode === 'firebase', 'mode=' + Store.mode);
if (Store.mode !== 'firebase') {
  try { await Store._fbFactory(); console.log("factory ok but mode demo?"); }
  catch (e) { console.log("FACTORY ERROR:", e && e.code, e && e.message); }
}

/* --- 1. first admin claims the fund --- */
await Store.setupAdmin({ fullName: 'E2E Admin', username: 'admin', email: 'admin@e2e.local', password: 'AdminPass123' });
let sess = await Store.getSession();
check('admin created + signed in', sess && sess.role === 'admin', sess && sess.username);

/* --- 2. member registers (pending) --- */
await Store.logout();
await Store.register({ fullName: 'E2E Member', username: 'e2e.member', email: 'e2e.member@e2e.local', password: 'MemberPass123', phone: '01711111111', shares: 1, docs: [] });
await Store.logout();
await Store.login('admin', 'AdminPass123');
const regs = await Store.listRegistrations();
const reg = regs.filter((r) => r.username === 'e2e.member')[0];
check('registration visible to admin', !!reg, reg && reg.status);
await Store.decideRegistration(reg.id, true);

/* --- 3. member sees a due of one month --- */
await Store.logout();
await Store.login('e2e.member', 'MemberPass123');
let acc = await Store.getMyAccount();
check('new member due = 1000 (1 month x 1000)', acc.balance.due === 1000, JSON.stringify(acc.balance));
const t0 = (await Store.getPublicSnapshot()).totalFunding;
check('fund total starts at 0 (no manual entries)', t0 === 0, 'totalFunding=' + t0);

/* --- 4. submitting a due payment drops the due immediately --- */
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'E2E-1000' });
acc = await Store.getMyAccount();
check('pending payment reduces due to 0 at once', acc.balance.due === 0, JSON.stringify(acc.balance));
check('pendingDue = 1000 exposed for the UI note', acc.balance.pendingDue === 1000);
const t1 = (await Store.getPublicSnapshot()).totalFunding;
check('pending payment is NOT in the fund total yet', t1 === 0, 'totalFunding=' + t1);

/* --- 5. admin approval auto-updates the fund totals --- */
await Store.logout();
await Store.login('admin', 'AdminPass123');
const pays = await Store.listPayments();
const mine = pays.filter((p) => p.ref === 'E2E-1000')[0];
check('payment listed for admin', !!mine, mine && mine.status);
await Store.verifyPayment(mine.id);
const snap = await Store.getPublicSnapshot();
const ft = snap.fundTotals || snap;
check('approval -> totals written to settings/public (spread on snapshot)', Object.keys(ft).length > 5, 'keys=' + Object.keys(ft).join(','));
check('totalFunding = 1000 (auto, no manual entry)', Number(ft.totalFunding) === 1000, 'totalFunding=' + ft.totalFunding);
check('memberDeposits = 1000', Number(ft.memberDeposits) === 1000, 'memberDeposits=' + ft.memberDeposits);
check('pendingDue cleared to 0 after approval', Number(ft.pendingDue) === 0, 'pendingDue=' + ft.pendingDue);
const row = (ft.months || []).filter((m) => m.month === '2026-09')[0];
check('September row carries funding 1000', !!row && Number(row.funding) === 1000, JSON.stringify(row));
await Store.logout();
await Store.login('e2e.member', 'MemberPass123');
acc = await Store.getMyAccount();
check('member view agrees (paid 1000, due 0)', acc.balance.paid === 1000 && acc.balance.due === 0, JSON.stringify(acc.balance));
await Store.logout();
await Store.login('admin', 'AdminPass123');

/* --- 6. admin profile: name + password (real adapter path) --- */
await Store.updateMyName('E2E Admin Renamed');
sess = await Store.getSession();
check('admin name change persisted (re-read from Firestore)', sess.fullName === 'E2E Admin Renamed', sess.fullName);
await expectThrow('wrong current password rejected', () => Store.changePassword('WRONG-PASS-1', 'AdminNewPass9'), 'wrong-credentials');
await Store.changePassword('AdminPass123', 'AdminNewPass9');
await Store.logout();
await expectThrow('old password no longer accepted', () => Store.login('admin', 'AdminPass123'), 'wrong-credentials');
const s2 = await Store.login('admin', 'AdminNewPass9');
check('new password logs in fine', s2.role === 'admin');
sess = await Store.getSession();
check('renamed admin still shown after re-login', sess.fullName === 'E2E Admin Renamed', sess.fullName);

/* --- 7. edge cases against the live rules --- */
await Store.logout();
await Store.login('e2e.member', 'MemberPass123');
await expectThrow('member cannot self-verify', () => Store.verifyPayment(mine.id));
await expectThrow('zero amount rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 0, date: '2026-09-14', ref: 'E2E-0' }), 'invalid');
await expectThrow('negative amount rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: -1000, date: '2026-09-14', ref: 'E2E-NEG' }), 'invalid');
await expectThrow('non-multiple rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1500, date: '2026-09-14', ref: 'E2E-1500' }), 'invalid');
await expectThrow('duplicate reference rejected', () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'E2E-1000' }), 'dup-ref');
await expectThrow('member cannot write fund settings', () => Store.saveSettings({ fundName: 'HACKED' }), 'forbidden');
await expectThrow('member cannot add finance entries', () => Store.upsertFinanceEntry({ kind: 'funding', month: '2026-09', amount: 5000, note: 'hack' }), 'forbidden');
await expectThrow('member cannot approve their own account', () => Store.decideRegistration('x', true), 'forbidden');
acc = await Store.getMyAccount();
check('books still balanced after bad input', acc.balance.due === 0 && acc.balance.paid === 1000, JSON.stringify(acc.balance));

console.log(fails === 0 ? 'REAL-ADAPTER E2E: ALL PASS' : 'REAL-ADAPTER E2E: ' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
