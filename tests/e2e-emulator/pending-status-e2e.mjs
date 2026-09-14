/* Pending-status E2E with the REAL production adapter against the Firestore/Auth emulator
   (real firestore.rules in force, only the 4 SDK imports swapped for local shims).

   Proves end to end:
     - the old call shape listPayments('pending') counted every payment as pending
       (the "Pending payments 6 / Verify 6 submitted payment(s)" report),
     - the fixed shape counts only real pending rows, on the real backend too,
     - verifying clears the pending count/amount and moves the money to verified,
     - the member portal and the fund aggregate agree,
     - duplicate references are refused on both the member and the admin path.

   Run:  node tests/e2e-emulator/pending-status-e2e.mjs      (emulators on 8080 / 9099) */
import { createRequire } from 'module';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const CANDIDATES = ['../../assets/js/', '../../ngf-build/assets/js/', '../../../ngf-build/assets/js/'];
const SITE = CANDIDATES.find((p) => fs.existsSync(fileURLToPath(new URL(p + 'store.js', import.meta.url))));
if (!SITE) { console.error('cannot locate assets/js/store.js from', import.meta.url); process.exit(2); }
console.log('# adapter source:', SITE);

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

let fails = 0, n = 0;
function check(name, c, x) { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (x !== undefined ? ' | ' + x : '')); if (!c) fails++; }
function step(m) { console.log('  · ' + m); }
async function expectThrow(name, fn, code) {
  try { await fn(); check(name, false, 'no error'); }
  catch (e) { check(name, !code || e.code === code, (e.code || '?') + ' ' + (e.message || '').slice(0, 90)); }
}
function oldPayFilter(list, filter) {
  if (filter && filter.status) list = list.filter((p) => p.status === filter.status);
  return list;
}

await Store.init();
check('E1 the real adapter boots against the emulator', Store.mode === 'firebase', 'mode=' + Store.mode);

console.log('== 1. fund owner + one approved member ==');
await Store.setupAdmin({ fullName: 'Pend Admin', username: 'admin', email: 'admin@e2e.local', password: 'AdminPass123' });
await Store.logout();
await Store.register({ fullName: 'Pend Member', username: 'pend.member', email: 'pend.member@e2e.local', password: 'MemberPass123', phone: '01712222222', shares: 1, docs: [] });
await Store.logout();
await Store.login('admin', 'AdminPass123');
const reg = (await Store.listRegistrations()).filter((r) => r.username === 'pend.member')[0];
await Store.decideRegistration(reg.id, true);

console.log('== 2. the member submits 6,000 + 1,000; both must show as pending ==');
await Store.logout();
await Store.login('pend.member', 'MemberPass123');
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 6000, date: '2026-09-14', ref: 'PEND-E2E-1' });
await Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-E2E-2' });
await Store.login('admin', 'AdminPass123');

let all = await Store.listPayments();
let pend = await Store.listPayments('pending');
let stats = await Store.paymentStats();
step('ledger: ' + all.length + ' payments | pending(' + pend.length + ') | stats pending ' + stats.counts.pending + ' / ' + stats.amounts.pending);
check('E2 the pending filter returns exactly the two submitted payments', pend.length === 2);
check('E3 stats agree with the filter', stats.counts.pending === 2 && stats.amounts.pending === 7000);
check('E4 the demo store and the real adapter expose the same summariser', typeof Store._fb.paymentStats === 'function' && window.NGFUtil.summarisePayments.selfCheck() === true);

console.log('== 3. duplicate references are refused by the real backend ==');
await expectThrow('E5 the admin cannot record a reference that already exists for that member',
  () => Store.addManualPayment({ memberId: pend[0].memberId, type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-E2E-1', note: '' }), 'dup-ref');
await Store.logout();
await Store.login('pend.member', 'MemberPass123');
await expectThrow('E6 the member cannot submit the same transaction ID twice',
  () => Store.submitPayment({ type: 'due', method: 'bkash', amount: 1000, date: '2026-09-14', ref: 'PEND-E2E-1' }), 'dup-ref');

console.log('== 4. while it waits, the member sees it as pending only (never as paid) ==');
let acc = await Store.getMyAccount();
step('member balance while pending: pending=' + acc.balance.pending + ' paid=' + acc.balance.paid + ' due=' + acc.balance.due);
check('E7 the submitted money is pending, not paid', acc.balance.pending === 7000 && acc.balance.paid === 0, JSON.stringify(acc.balance));
check('E8 the member pending line quotes the whole 7,000', acc.balance.pendingDue + acc.balance.pendingAdvance === 7000, 'due=' + acc.balance.pendingDue + ' adv=' + acc.balance.pendingAdvance);

console.log('== 5. the admin verifies one of the two ==');
await Store.logout();
await Store.login('admin', 'AdminPass123');
const p2 = (await Store.listPayments('pending')).filter((p) => p.ref === 'PEND-E2E-2')[0];
await Store.verifyPayment(p2.id);

all = await Store.listPayments();
pend = await Store.listPayments('pending');
stats = await Store.paymentStats();
step('after verifying 1,000: pending(' + pend.length + ') | stats pending ' + stats.counts.pending + ' / ' + stats.amounts.pending + ' | verified ' + stats.counts.verified + ' / ' + stats.amounts.verified);
check('E9 pending drops to the remaining single row / 6,000', stats.counts.pending === 1 && stats.amounts.pending === 6000);
check('E10 the verified money is counted once', stats.counts.verified === 1 && stats.amounts.verified === 1000);
check('E11 the OLD call shape would have shown 2 pending rows here', oldPayFilter(all, 'pending').length === 2 && stats.counts.pending === 1,
  'old=' + oldPayFilter(all, 'pending').length + ' real=' + stats.counts.pending);
check('E12 stats equal a fresh raw scan', stats.counts.all === all.length && stats.amounts.all === all.reduce((a, p) => a + p.amount, 0));

let snap = await Store.getPublicSnapshot();
step('fund aggregate after the admin write: pendingDue=' + snap.pendingDue + ' deposits=' + snap.memberDeposits + ' funding=' + snap.totalFunding);
check('E13 the fund aggregate now reports the 6,000 that is really pending', snap.pendingDue === 6000, 'pendingDue=' + snap.pendingDue);
check('E14 only verified money is counted as deposits', snap.memberDeposits === 1000, 'deposits=' + snap.memberDeposits);

console.log('== 6. verify the rest: every surface must clear ==');
const p1 = (await Store.listPayments('pending'))[0];
await Store.verifyPayment(p1.id);
all = await Store.listPayments();
pend = await Store.listPayments('pending');
stats = await Store.paymentStats();
step('after verifying all: pending(' + pend.length + ') | stats pending ' + stats.counts.pending + ' / ' + stats.amounts.pending + ' | verified ' + stats.counts.verified + ' / ' + stats.amounts.verified);
check('E15 the pending list is empty', pend.length === 0);
check('E16 the pending count and amount are zero', stats.counts.pending === 0 && stats.amounts.pending === 0);
check('E17 both payments are verified and counted once (7,000)', stats.counts.verified === 2 && stats.amounts.verified === 7000);
check('E18 the OLD shape would still report 2 pending rows (the reported bug)', oldPayFilter(all, 'pending').length === 2 && stats.counts.pending === 0);
check('E19 stats equal a fresh raw scan', stats.counts.all === all.length && stats.amounts.all === all.reduce((a, p) => a + p.amount, 0));

snap = await Store.getPublicSnapshot();
check('E20 the fund pending total clears', snap.pendingDue === 0, 'pendingDue=' + snap.pendingDue);
check('E21 the fund counts the money exactly once (7,000)', snap.memberDeposits === 7000 && snap.totalFunding === 7000, 'deposits=' + snap.memberDeposits);

console.log('== 7. the member portal reflects it ==');
await Store.logout();
await Store.login('pend.member', 'MemberPass123');
acc = await Store.getMyAccount();
step('member balance after verify: paid=' + acc.balance.paid + ' pending=' + acc.balance.pending + ' due=' + acc.balance.due + ' advance=' + acc.balance.advance);
check('E22 no pending money is left in the member view', acc.balance.pending === 0, 'pending=' + acc.balance.pending);
check('E23 all 7,000 is shown as paid', acc.balance.paid === 7000, 'paid=' + acc.balance.paid);
check('E24 the 6,000 overpayment is explained as advance', acc.balance.advance === 6000 && acc.balance.advanceMonths === 6, 'advance=' + acc.balance.advance + ' months=' + acc.balance.advanceMonths);
const mine = await Store.getMyPayments();
const mStats = window.NGFUtil.summarisePayments(mine);
step('member ledger: ' + mine.map((p) => p.ref + ':' + p.status).join(', '));
check('E25 the member history footer agrees (2 verified, 0 pending)', mStats.counts.verified === 2 && mStats.counts.pending === 0, JSON.stringify(mStats.counts));

console.log('== 7b. a decided payment cannot be flipped again (live adapter parity) ==');
await Store.logout();
await Store.login('admin', 'AdminPass123');
const decided = (await Store.listPayments()).filter((p) => p.status === 'verified')[0];
await expectThrow('E27 rejecting an already verified payment is refused on the live backend',
  () => Store.rejectPayment(decided.id, 'trying to flip it'), 'invalid');
await expectThrow('E28 verifying an already verified payment is refused on the live backend',
  () => Store.verifyPayment(decided.id), 'invalid');
await expectThrow('E29 a payment id that does not exist is refused',
  () => Store.verifyPayment('does-not-exist'), 'not-found');
const afterFlip = await Store.paymentStats();
const snapAfterFlip = await Store.getPublicSnapshot();
step('after the refused flips: verified ' + afterFlip.counts.verified + ' / ' + afterFlip.amounts.verified + ' · deposits ' + snapAfterFlip.memberDeposits);
check('E30 the refused attempts changed nothing', afterFlip.counts.verified === 2 && afterFlip.amounts.verified === 7000 && snapAfterFlip.memberDeposits === 7000);

console.log('== 8. audit trail ==');
await Store.logout();
await Store.login('admin', 'AdminPass123');
const audit = await Store.listAudit();
step('audit actions: ' + JSON.stringify(Array.from(new Set(audit.map((a) => a.action)))));
const ver = audit.filter((a) => a.action === 'payment-verified');
check('E26 every verification is in the audit log with actor + detail', ver.length === 2 && ver.every((a) => a.actor && a.detail), JSON.stringify(ver[0] || {}));
/* the registration audit entry used to be written AFTER signOut, so the rules
   rejected it and it was never stored - it must be there now. */
const regAudit = audit.filter((a) => a.action === 'registration-submitted');
check('E31 the registration audit entry survives (written before sign-out)', regAudit.length === 1, JSON.stringify(regAudit[0] || {}));
const subAudit = audit.filter((a) => a.action === 'payment-submitted');
check('E32 both member submissions are in the audit log', subAudit.length === 2, JSON.stringify(subAudit.map((a) => a.detail)));

console.log(fails === 0 ? 'REAL-ADAPTER PENDING E2E: ALL PASS (' + n + ' checks)' : 'REAL-ADAPTER PENDING E2E: ' + fails + ' FAILURES of ' + n);
process.exit(fails === 0 ? 0 : 1);
