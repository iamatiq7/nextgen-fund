#!/usr/bin/env node
/**
 * data-safety-check.mjs - hand-verify the Firestore security model against the project's own
 * rules inside the emulator (a separate TEST project, never the live database).
 *
 * Every check states what an attacker/curious user would try and what the rules answer.
 * usage: node data-safety-check.mjs <out.txt>
 */
import fs from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, addDoc, deleteDoc, collection, getDocs, query, where, updateDoc,
} from 'firebase/firestore';

const RULES = process.argv[3] || 'C:\\Users\\SMART\\OneDrive\\Documents\\Scheme\\NextGenFund\\firestore.rules';
const OUT = process.argv[2] || 'data-safety-check.txt';
const PROJECT = 'demo-nextgen-fund';
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };
let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1; else fail += 1;
  say(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`);
};

say('=== Firestore security model: hand verification in the emulator (test project) ===');
say(`timestamp : ${new Date().toISOString()}`);
say(`project   : ${PROJECT}  (emulator only - the live database was never touched)`);
say(`rules     : ${RULES}`);
say(`rules sha256: ${(await import('node:crypto')).createHash('sha256').update(fs.readFileSync(RULES)).digest('hex')}`);
say('');

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

// ---- seed with rules disabled (the "someone already added data" state)
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const c of ['users', 'usernames', 'payments', 'registrations', 'audit', 'finance', 'settings']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  await setDoc(doc(db, 'settings/bootstrap'), { adminUid: 'adminUID1', claimedAt: '2026-09-14T00:00:00Z' });
  await setDoc(doc(db, 'settings/public'), { fundName: 'NextGen Fund', memberCount: 2 });
  await setDoc(doc(db, 'users/member1'), { role: 'member', status: 'active', username: 'kazi.ibrahim', email: 'a@nextgen.local' });
  await setDoc(doc(db, 'users/member2'), { role: 'member', status: 'active', username: 'kazi.quddus', email: 'b@nextgen.local' });
  await setDoc(doc(db, 'usernames/kazi.ibrahim'), { uid: 'member1', email: 'a@nextgen.local' });
  await setDoc(doc(db, 'payments/pay1'), { memberId: 'member1', amount: 2000, status: 'verified' });
  await setDoc(doc(db, 'registrations/reg1'), { fullName: 'Someone', status: 'pending' });
  await setDoc(doc(db, 'audit/a1'), { action: 'admin.claim' });
});
say('seeded: settings/bootstrap + settings/public + 2 users + 1 username + 1 payment + 1 registration + 1 audit row');
say('');

const anon = testEnv.unauthenticatedContext().firestore();
const member1 = testEnv.authenticatedContext('member1').firestore();
const member2 = testEnv.authenticatedContext('member2').firestore();
const admin = testEnv.authenticatedContext('adminUID1').firestore();

say('--- anonymous visitor (not signed in) ---');
check('anonymous CANNOT read another person\'s user document', await assertFails(getDoc(doc(anon, 'users/member1'))).then(() => true).catch(() => false));
check('anonymous CANNOT list the users collection', await assertFails(getDocs(collection(anon, 'users'))).then(() => true).catch(() => false));
check('anonymous CANNOT list payments', await assertFails(getDocs(collection(anon, 'payments'))).then(() => true).catch(() => false));
check('anonymous CANNOT list registrations', await assertFails(getDocs(collection(anon, 'registrations'))).then(() => true).catch(() => false));
check('anonymous CANNOT list the audit log', await assertFails(getDocs(collection(anon, 'audit'))).then(() => true).catch(() => false));
check('anonymous CANNOT overwrite the public settings', await assertFails(setDoc(doc(anon, 'settings/public'), { fundName: 'hacked' })).then(() => true).catch(() => false));
check('anonymous CAN read the public settings (by design, for the public dashboard)', await assertSucceeds(getDoc(doc(anon, 'settings/public'))).then(() => true).catch(() => false));

say('');
say('--- signed-in member (the curious-member case) ---');
check('member CAN read their own profile', await assertSucceeds(getDoc(doc(member1, 'users/member1'))).then(() => true).catch(() => false));
check('member CANNOT read another member\'s profile', await assertFails(getDoc(doc(member1, 'users/member2'))).then(() => true).catch(() => false));
check('member CANNOT list all users', await assertFails(getDocs(collection(member1, 'users'))).then(() => true).catch(() => false));
check('member CANNOT list all payments', await assertFails(getDocs(collection(member1, 'payments'))).then(() => true).catch(() => false));
check('member CAN read their own payment row', await assertSucceeds(getDoc(doc(member1, 'payments/pay1'))).then(() => true).catch(() => false));
check('member CANNOT read someone else\'s payment row', await assertFails(getDoc(doc(member2, 'payments/pay1'))).then(() => true).catch(() => false));
check('member CANNOT self-approve a payment (write status=verified)', await assertFails(setDoc(doc(member1, 'payments/newpay'), { memberId: 'member1', amount: 5000, status: 'verified' })).then(() => true).catch(() => false));
check('member CAN submit a pending payment of their own', await assertSucceeds(setDoc(doc(member1, 'payments/newpay2'), { memberId: 'member1', memberName: 'Member One', amount: 1000, type: 'advance', status: 'pending', method: 'bkash', ref: 'TRX123456', date: '2026-09-01', senderNumber: '01700000000', note: '', submittedAt: new Date().toISOString(), verifiedAt: null, verifiedBy: null, rejectReason: '' })).then(() => true).catch(() => false));
check('member CANNOT submit a payment without the explicit verifiedAt/verifiedBy nulls (rules validate shape)', await assertFails(setDoc(doc(member1, 'payments/newpay3'), { memberId: 'member1', amount: 1000, type: 'advance', status: 'pending', method: 'bkash', ref: 'TRX999999', date: '2026-09-01', submittedAt: new Date().toISOString() })).then(() => true).catch(() => false));
check('member CANNOT promote themselves to admin', await assertFails(updateDoc(doc(member1, 'users/member1'), { role: 'admin' })).then(() => true).catch(() => false));
check('member CANNOT change their own shares (money field frozen)', await assertFails(updateDoc(doc(member1, 'users/member1'), { shares: 999 })).then(() => true).catch(() => false));
check('member CANNOT delete the audit log', await assertFails(deleteDoc(doc(member1, 'audit/a1'))).then(() => true).catch(() => false));
check('member CANNOT write the public settings', await assertFails(setDoc(doc(member1, 'settings/public'), { fundName: 'no' })).then(() => true).catch(() => false));
check('member CAN read the public settings', await assertSucceeds(getDoc(doc(member1, 'settings/public'))).then(() => true).catch(() => false));
check('member CAN read a username row (needed to sign in)', await assertSucceeds(getDoc(doc(member1, 'usernames/kazi.ibrahim'))).then(() => true).catch(() => false));

say('');
say('--- the admin account (what the owner has) ---');
check('admin CAN list all users', await assertSucceeds(getDocs(collection(admin, 'users'))).then(() => true).catch(() => false));
check('admin CAN list all payments', await assertSucceeds(getDocs(collection(admin, 'payments'))).then(() => true).catch(() => false));
check('admin CAN list registrations', await assertSucceeds(getDocs(collection(admin, 'registrations'))).then(() => true).catch(() => false));
check('admin CAN read the audit log', await assertSucceeds(getDocs(collection(admin, 'audit'))).then(() => true).catch(() => false));
check('admin CAN update the public settings', await assertSucceeds(setDoc(doc(admin, 'settings/public'), { fundName: 'NextGen Fund', memberCount: 2 })).then(() => true).catch(() => false));
check('admin CAN filter payments by member (the admin console query)', await assertSucceeds(getDocs(query(collection(admin, 'payments'), where('memberId', '==', 'member1')))).then(() => true).catch(() => false));
check('admin CAN delete an audit row (added in the reset revision; NOT deployed live)', await assertSucceeds(deleteDoc(doc(admin, 'audit/a1'))).then(() => true).catch(() => false));

say('');
say('--- what is deliberately public (documented, not a leak) ---');
check('usernames/{name} is readable so the login form can map a username to an email', await assertSucceeds(getDoc(doc(anon, 'usernames/kazi.ibrahim'))).then(() => true).catch(() => false));
check('settings/public is readable so the public dashboard can render', await assertSucceeds(getDoc(doc(anon, 'settings/public'))).then(() => true).catch(() => false));

say('');
say(`checks: ${pass + fail}   pass: ${pass}   fail: ${fail}`);
say(`RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT'}`);

await testEnv.cleanup();
fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + OUT);
process.exitCode = fail === 0 ? 0 : 2;
