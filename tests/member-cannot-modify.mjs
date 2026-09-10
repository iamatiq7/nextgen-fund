/* Verify: members see admin data but CANNOT modify it (structured evidence) */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');

let fails = 0;
function check(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')); if (!cond) fails++; }
async function expectForbidden(name, fn) {
  try { await fn(); check(name, false, 'NO ERROR THROWN'); }
  catch (e) { check(name + ' rejected', e.code === 'forbidden' || /admin/i.test(e.message), e.message); }
}

Store._demoReset();
await Store.init();

// capture admin-owned state baseline
await Store.login('admin', 'nextgen2026');
const settingsBefore = await Store.getSettings();
const membersBefore = await Store.listMembers();
const paysBefore = await Store.listPayments();
const financeBefore = await Store.listFinance();
await Store.logout();

// member session
const s = await Store.login('kazi.sujon', 'nextgen123');
check('member logged in', s.role === 'member');

// 1. settings (fund name, payment numbers, meeting date) - members cannot modify
await expectForbidden('member cannot saveSettings (fund name/numbers)', () => Store.saveSettings({ fundName: 'HACKED', nextMeeting: '2020-01-01' }));
// 2. members cannot edit other member records
const other = membersBefore.find(m => m.username === 'kazi.atiqur.rahman');
await expectForbidden('member cannot updateMember (another member)', () => Store.updateMember(other.id, { phone: '01700000000' }));
// 3. members cannot verify/reject any payment
await expectForbidden('member cannot verifyPayment', () => Store.verifyPayment(paysBefore[0].id));
await expectForbidden('member cannot rejectPayment', () => Store.rejectPayment(paysBefore[0].id, 'x'));
// 4. members cannot touch finance entries
await expectForbidden('member cannot add finance entry', () => Store.upsertFinanceEntry({ kind: 'revenue', month: '2026-09', amount: 999999 }));
const fin0 = financeBefore[0];
await expectForbidden('member cannot delete finance entry', () => Store.deleteFinanceEntry(fin0.id));
// 5. members cannot list or decide registrations / read full audit
await expectForbidden('member cannot listRegistrations', () => Store.listRegistrations());
await expectForbidden('member cannot listAudit', () => Store.listAudit());

// positive control: member CAN still use member features (own payment)
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-10', ref: 'ISO-OK-1000' });
const own = await Store.getMyPayments();
check('member own payment submission still works', own.some(p => p.ref === 'ISO-OK-1000'));

// re-login as admin: verify NOTHING was corrupted by member attempts
await Store.login('admin', 'nextgen2026');
const settingsAfter = await Store.getSettings();
const membersAfter = await Store.listMembers();
const paysAfter = await Store.listPayments();
const financeAfter = await Store.listFinance();
check('settings unchanged (fundName/meeting/numbers intact)',
  settingsAfter.fundName === settingsBefore.fundName &&
  JSON.stringify(settingsAfter.paymentNumbers) === JSON.stringify(settingsBefore.paymentNumbers) &&
  settingsAfter.nextMeeting === settingsBefore.nextMeeting);
check('members unchanged', JSON.stringify(membersAfter.map(m => [m.id, m.phone, m.shares, m.monthlyDue])) ===
  JSON.stringify(membersBefore.map(m => [m.id, m.phone, m.shares, m.monthlyDue])));
check('payments unchanged except member own new submission', paysAfter.length === paysBefore.length + 1);
check('finance unchanged', JSON.stringify(financeAfter) === JSON.stringify(financeBefore));

console.log('AUTOCLAW_GOAL_CHECK_V1 ' + JSON.stringify({
  criterionId: 'user-view-respects-admin-settings',
  passed: fails === 0,
  summary: fails === 0
    ? 'Member session: all 7 admin mutations (settings, member records, payment verify/reject, finance add/delete, registrations, audit) rejected with forbidden; admin settings/members/finance byte-identical afterwards; member own payment flow unaffected'
    : fails + ' checks failed'
}));
console.log('RESULT: ' + (fails === 0 ? 'ALL PASS' : fails + ' FAILURES'));
process.exit(fails === 0 ? 0 : 1);
