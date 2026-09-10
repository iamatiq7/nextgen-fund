/* Harness: verify demo-DB auto-reseed on seed-version mismatch */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Store = require('../assets/js/store.js');
const SEED = require('../assets/js/seed-data.js');

function findDbKey() {
  return Object.keys(Store._mem).find(k => {
    try { const v = JSON.parse(Store._mem[k]); return v && v.users && v.settings; } catch (e) { return false; }
  });
}
async function fresh() {
  Store._demoReset();
  await Store.init();
}
let fails = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails++; }

// 0. seed version
check('bundled seedVersion is 2', SEED.seedVersion === 2);

// 1. fresh init builds seed
await fresh();
let key = findDbKey();
check('fresh init stores a DB', !!key);
let db = JSON.parse(Store._mem[key]);
check('fresh DB has seedVersion 2', db.seedVersion === 2);
check('fresh DB has 14 members + admin', db.users.length === 15);
check('fresh DB has 106 payments', db.payments.length === 106);

// 2. stale DB (seedVersion 1, no payments) gets refreshed on init
Store._mem[key] = JSON.stringify({ seedVersion: 1, users: [{ id: 'x', role: 'admin' }], payments: [], registrations: [], finance: [], audit: [], settings: {} });
await Store.init();
db = JSON.parse(Store._mem[key]);
check('stale v1 DB auto-reseeded to v2', db.seedVersion === 2 && db.payments.length === 106);

// 3. DB without seedVersion (oldest builds) gets refreshed
Store._mem[key] = JSON.stringify({ users: [], payments: [], registrations: [], finance: [], audit: [], settings: {} });
await Store.init();
db = JSON.parse(Store._mem[key]);
check('versionless DB auto-reseeded', db.seedVersion === 2 && db.users.length === 15);

// 4. corrupt JSON gets rebuilt
Store._mem[key] = '{corrupt';
await Store.init();
db = JSON.parse(Store._mem[key]);
check('corrupt DB rebuilt', db.seedVersion === 2 && db.users.length === 15);

// 5. current-version DB is preserved (no data loss)
await fresh();
key = findDbKey();
db = JSON.parse(Store._mem[key]);
db.settings.fundName = 'Marked';
db.payments.push({ id: 'p-test', memberId: 'm-kazi-sujon', type: 'due', method: 'cash', amount: 5, date: '2026-09-09', ref: 'HARNESS-1', status: 'verified', submittedAt: '2026-09-09T00:00:00Z' });
Store._mem[key] = JSON.stringify(db);
await Store.init();
db = JSON.parse(Store._mem[key]);
check('current v2 DB preserved on re-init', db.settings.fundName === 'Marked' && db.payments.length === 107);

// 6. member login still works after reseed cycle
await fresh();
const s = await Store.login('kazi.atiqur.rahman', 'nextgen123');
check('member login works', s && s.role === 'member');
const acc = await Store.getMyAccount();
check('member account has filled profile', acc.profile.fullName === 'Kazi Atiqur Rahman' && acc.profile.shares === 3);
check('member balance computed (expected 27000)', acc.balance.expected === 27000);
check('member payment history non-empty', acc.payments.length === 9);

console.log(fails === 0 ? 'HARNESS: ALL PASS' : 'HARNESS: ' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
