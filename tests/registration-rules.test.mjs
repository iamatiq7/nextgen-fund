/* NextGen Fund - registration rules (mobile number, nominee, join month, documents)
   Run:  node tests/registration-rules.test.mjs */
import { createRequire } from 'node:module';
import assert from 'node:assert';
const require = createRequire(import.meta.url);
const dir = new URL('../assets/js/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const U = require(dir + 'util.js');
const Store = require(dir + 'store.js');

/* the demo store keeps the admin session in memory: set it so the admin-only reads work */
Store.mode = 'demo';
Store._session = { uid: 'test-admin', username: 'test-admin', role: 'admin', status: 'active' };

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const docs = ['nid-front', 'nid-back', 'profile-picture', 'nominee-passport-photo'].map((k) => ({ kind: k, name: k + '.png', mime: 'image/png', size: 96, data: tiny }));
let n = 0;
function base(patch) {
  n++;
  return Object.assign({
    fullName: 'Rule Test ' + n, username: 'rule.test.' + n, email: 'rule.test.' + n + '@ngf.local',
    phone: '01712345678', occupation: 'Service', nominee: 'Nominee ' + n, nomineeAddress: 'Village, Thana, District', nomineeRelation: 'Brother', fatherName: 'Father Name', motherName: 'Mother Name',
    address: 'Member address', joinMonth: '2026-06', shares: '1', password: 'password123', docs: docs.map((d) => Object.assign({}, d))
  }, patch || {});
}
async function attempt(patch) {
  try { const r = await Store.register(base(patch)); return { ok: true, r }; }
  catch (e) { return { ok: false, msg: String((e && e.message) || e) }; }
}

console.log('== mobile number: exactly 11 digits, starting 01 ==');
let r = await attempt({});
ok('a valid 01xxxxxxxxx number is accepted', r.ok, r.msg);
r = await attempt({ phone: '0171234567' });          /* 10 digits */
ok('10 digits -> "Wrong mobile number"', !r.ok && /Wrong mobile number/.test(r.msg), r.msg);
r = await attempt({ phone: '017123456789' });        /* 12 digits */
ok('12 digits -> refused', !r.ok && /Wrong mobile number/.test(r.msg), r.msg);
r = await attempt({ phone: '02712345678' });         /* does not start with 01 */
ok('a number not starting with 01 -> refused', !r.ok && /Wrong mobile number/.test(r.msg), r.msg);
r = await attempt({ phone: '017-1234 5678' });       /* separators are ignored */
ok('spaces and dashes are stripped before checking', r.ok, r.msg);
r = await attempt({ phone: '০১৭১২৩৪৫৬৭৮' });          /* Bangla digits */
ok('Bangla digits are accepted and normalised', r.ok, r.msg);
r = await attempt({ phone: '' });
ok('an empty number -> refused', !r.ok && /Wrong mobile number/.test(r.msg), r.msg);
r = await attempt({ phone: 'abcdefghijk' });
ok('letters -> refused', !r.ok && /Wrong mobile number/.test(r.msg), r.msg);

console.log('== nominee name, nominee address, join month, documents ==');
r = await attempt({ nominee: '' });
ok('nominee name missing -> refused', !r.ok && /Nominee name/.test(r.msg), r.msg);
r = await attempt({ nomineeAddress: '' });
ok('nominee address missing -> refused', !r.ok && /Nominee address/.test(r.msg), r.msg);
r = await attempt({ joinMonth: '' });
ok('join month missing -> refused', !r.ok && /Join month/.test(r.msg), r.msg);
r = await attempt({ joinMonth: '2026-13' });
ok('a malformed join month -> refused', !r.ok && /Join month/.test(r.msg), r.msg);
r = await attempt({ docs: docs.slice(0, 3) });
ok('one missing document -> refused', !r.ok && /Required documents/.test(r.msg), r.msg);
r = await attempt({ docs: [] });
ok('no documents -> refused', !r.ok && /Required documents/.test(r.msg), r.msg);
r = await attempt({ nomineePhone: '0171234567' });
ok('a bad nominee mobile -> refused', !r.ok && /nominee mobile/.test(r.msg), r.msg);


console.log('== father, mother and the relation with the nominee ==');
r = await attempt({ fatherName: '' });
ok("father's name missing -> refused", !r.ok && /Father/.test(r.msg), r.msg);
r = await attempt({ motherName: '' });
ok("mother's name missing -> refused", !r.ok && /Mother/.test(r.msg), r.msg);
r = await attempt({ nomineeRelation: '' });
ok('relation with the nominee missing -> refused', !r.ok && /Relation with the nominee/.test(r.msg), r.msg);

console.log('== the reported bug: all four documents attached, old Settings labels present ==');
const legacyBackup = [];
try {
  const db = Store._d();
  legacyBackup.push(db.settings && db.settings.docRequirements);
  db.settings.docRequirements = ['Photo ID (NID / Birth Certificate)', 'Passport-size Photograph'];
  Store._save();
} catch (e) { }
const bugCase = await attempt({ username: 'bug.case', email: 'bug.case@ngf.local' });
ok('a registration with all four documents is accepted even while old Settings labels exist', bugCase.ok, bugCase.msg);
try {
  const db = Store._d();
  db.settings.docRequirements = legacyBackup[0] || [];
  Store._save();
} catch (e) { }

console.log('== what actually lands in the record ==');
const good = await attempt({ phone: '01700000099', joinMonth: '2026-06', username: 'rule.record', email: 'rule.record@ngf.local' });
ok('the record is created', good.ok && good.r && good.r.ok);
const regs = await Store.listRegistrations();
const rec = regs.find((x) => x.username === 'rule.record');
ok('the join month is stored', !!rec && rec.joinMonth === '2026-06', rec && rec.joinMonth);
ok('the nominee address is stored', !!rec && rec.nomineeAddress === 'Village, Thana, District', rec && rec.nomineeAddress);
ok('the father, mother and relation are stored', !!rec && rec.fatherName === 'Father Name' && rec.motherName === 'Mother Name' && rec.nomineeRelation === 'Brother', rec && (rec.fatherName + '/' + rec.motherName + '/' + rec.nomineeRelation));
ok('the normalised phone is stored', !!rec && rec.phone === '01700000099', rec && rec.phone);
ok('all four documents travel with the record', !!rec && (rec.docs || []).length === 4);
ok('the profile picture is kept on the record', !!rec && (rec.docs || []).some((d) => d.kind === 'profile-picture' && d.data));

console.log('== the ledger starts at the chosen month ==');
const dec = await Store.decideRegistration(rec.id, true, '');
ok('the registration is approved', !!(dec && dec.ok));
const members = await Store.listMembers();
const m = members.find((x) => x.username === 'rule.record');
ok('the member keeps the chosen join month after approval', !!m && m.joinMonth === '2026-06', m && m.joinMonth);
const monthsFromJan = U.monthsInclusive('2026-06', '2026-09');
ok('month counting helper counts from the join month only', monthsFromJan === 4, 'June..September = ' + monthsFromJan);

console.log('');
console.log('checks: ' + (pass + fail) + '   pass: ' + pass + '   fail: ' + fail);
console.log('RESULT: ' + (fail ? 'FAILURES PRESENT' : 'ALL PASS'));
process.exit(fail ? 1 : 0);
