/* Firestore rules verification against the local emulator (rules v2).
   Proves: public read scope, admin-only writes, pending-only member payments,
   1,000tk multiples, locked money/identity fields, bootstrap claim flow. */
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, collection, addDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-nextgen-fund',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080
  }
});

await testEnv.clearFirestore();  // idempotent runs

let pass = 0, fail = 0;
const failures = [];
async function allow(name, pr) {
  try { await assertSucceeds(pr); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; failures.push(name); console.log('FAIL ' + name + ' :: ' + String(e && e.message || e).slice(0, 110)); }
}
async function deny(name, pr) {
  try { await assertFails(pr); pass++; console.log('PASS ' + name + ' (denied)'); }
  catch (e) { fail++; failures.push(name); console.log('FAIL ' + name + ' :: ' + String(e && e.message || e).slice(0, 110)); }
}

const anon = testEnv.unauthenticatedContext();
const alice = testEnv.authenticatedContext('alice');   // will claim bootstrap -> admin
const bob = testEnv.authenticatedContext('bob');       // member
const carol = testEnv.authenticatedContext('carol');   // member

const F = (ctx) => ctx.firestore();

/* ---------- 1. public read scope ---------- */
await allow('anon reads settings/public', getDoc(doc(F(anon), 'settings/public')));
await deny('anon writes settings/public', setDoc(doc(F(anon), 'settings/public'), { fundName: 'HACK' }));
await deny('anon reads users/bob', getDoc(doc(F(anon), 'users/bob')));
await deny('anon lists users', getDocs(query(collection(F(anon), 'users'), where('role', '==', 'member'))));
await deny('anon writes finance', addDoc(collection(F(anon), 'finance'), { kind: 'funding', month: '2026-01', amount: 1000 }));
await allow('anon reads usernames map (login)', getDoc(doc(F(anon), 'usernames/bob')));

/* ---------- 2. bootstrap + admin claim ---------- */
await allow('alice claims bootstrap', setDoc(doc(F(alice), 'settings/bootstrap'), { adminUid: 'alice', claimedAt: 'x' }));
await deny('second bootstrap claim blocked', setDoc(doc(F(bob), 'settings/bootstrap'), { adminUid: 'bob', claimedAt: 'y' }));
await allow('alice creates own admin doc (bootstrap uid)', setDoc(doc(F(alice), 'users/alice'), { role: 'admin', status: 'active', username: 'admin', email: 'a@x.com', fullName: 'Admin', phone: '', address: '', shares: 0, monthlyDue: 0, joinMonth: '', createdAt: 'x' }));
await deny('bob cannot create role=admin doc', setDoc(doc(F(bob), 'users/bob'), { role: 'admin', status: 'active', username: 'bob', email: 'b@x.com' }));

/* ---------- 3. member self-registration (pending only) ---------- */
await allow('bob self-creates pending member doc', setDoc(doc(F(bob), 'users/bob'), { role: 'member', status: 'pending', username: 'bob', email: 'b@x.com', fullName: 'Bob', phone: '', address: '', shares: 2, monthlyDue: 2000, joinMonth: '', createdAt: 'x' }));
await deny('bob cannot self-create as active', setDoc(doc(F(carol), 'users/carol'), { role: 'member', status: 'active', username: 'carol', email: 'c@x.com' }));
await deny('bob cannot create carol doc (impersonation)', setDoc(doc(F(bob), 'users/carol'), { role: 'member', status: 'pending', username: 'carol' }));

/* ---------- 4. member updates: locked identity/money fields ---------- */
await allow('bob updates own phone', updateDoc(doc(F(bob), 'users/bob'), { phone: '01711111111' }));
await deny('bob cannot change own shares', updateDoc(doc(F(bob), 'users/bob'), { shares: 99 }));
await deny('bob cannot change own monthlyDue', updateDoc(doc(F(bob), 'users/bob'), { monthlyDue: 0 }));
await deny('bob cannot change own status', updateDoc(doc(F(bob), 'users/bob'), { status: 'active' }));
await deny('bob cannot edit alice (admin) doc', updateDoc(doc(F(bob), 'users/alice'), { fullName: 'PWNED' }));
await deny('bob cannot write settings/public', setDoc(doc(F(bob), 'settings/public2'), { fundName: 'HACK2' }));
await deny('bob cannot read alice doc', getDoc(doc(F(bob), 'users/alice')));

/* ---------- 5. payments: pending-only, 1000tk multiples, no self-verify ---------- */
const pay = (extra) => Object.assign({
  memberId: 'bob', memberName: 'Bob', type: 'due', method: 'bkash', amount: 1000,
  date: '2026-09-13', ref: 'TX1', senderNumber: '', note: '', status: 'pending',
  submittedAt: 'x', verifiedAt: null, verifiedBy: null, rejectReason: ''
}, extra);
await allow('bob submits 1000tk pending payment', setDoc(doc(F(bob), 'payments/p1'), pay({})));
await deny('bob submits 500tk', setDoc(doc(F(bob), 'payments/p2'), pay({ amount: 500 })));
await deny('bob submits 1500tk', setDoc(doc(F(bob), 'payments/p3'), pay({ amount: 1500 })));
await deny('bob submits pre-verified payment', setDoc(doc(F(bob), 'payments/p4'), pay({ status: 'verified', verifiedBy: 'bob' })));
await deny('bob submits payment for carol', setDoc(doc(F(bob), 'payments/p5'), pay({ memberId: 'carol' })));
await allow('admin records manual payment for carol', setDoc(doc(F(alice), 'payments/c1'), { memberId: 'carol', memberName: 'Carol', type: 'due', method: 'cash', amount: 1000, date: '2026-09-13', ref: '', senderNumber: '', note: '', status: 'verified', submittedAt: 'x', verifiedAt: 'x', verifiedBy: 'admin', rejectReason: '' }));
await allow('bob reads own payments', getDocs(query(collection(F(bob), 'payments'), where('memberId', '==', 'bob'))));
await deny('bob reads all payments', getDocs(collection(F(bob), 'payments')));
await deny('bob cannot verify own payment', updateDoc(doc(F(bob), 'payments/p1'), { status: 'verified' }));
await allow('admin verifies payment', updateDoc(doc(F(alice), 'payments/p1'), { status: 'verified', verifiedAt: 'y', verifiedBy: 'admin' }));
await deny('member cannot delete payment', deleteDoc(doc(F(bob), 'payments/p1')));

/* ---------- 6. usernames map ---------- */
await allow('bob creates own usernames doc with email', setDoc(doc(F(bob), 'usernames/bob'), { uid: 'bob', email: 'b@x.com' }));
await deny('bob creates usernames doc for carol', setDoc(doc(F(bob), 'usernames/carol'), { uid: 'carol', email: 'c@x.com' }));
await deny('usernames doc not updatable', updateDoc(doc(F(bob), 'usernames/bob'), { email: 'evil@x.com' }));

/* ---------- 7. admin powers + finance ---------- */
await allow('admin adds finance entry', addDoc(collection(F(alice), 'finance'), { kind: 'funding', month: '2026-09', amount: 7000, note: '' }));
await deny('member cannot add finance entry', addDoc(collection(F(bob), 'finance'), { kind: 'funding', month: '2026-09', amount: 1 }));
await allow('admin reads users list', getDocs(query(collection(F(alice), 'users'), where('role', '==', 'member'))));
await allow('admin updates member record', updateDoc(doc(F(alice), 'users/bob'), { shares: 3, monthlyDue: 3000 }));
await allow('admin writes settings/public', setDoc(doc(F(alice), 'settings/public'), { fundName: 'NextGen Fund', memberCount: 1 }));

/* ---------- 8. audit ---------- */
await allow('member appends audit entry', addDoc(collection(F(bob), 'audit'), { at: 'x', actor: 'bob', action: 'test', detail: '' }));
await deny('member reads audit log', getDocs(collection(F(bob), 'audit')));
await allow('admin reads audit log', getDocs(collection(F(alice), 'audit')));
await allow('audit create then immutable', setDoc(doc(F(alice), 'audit/a1'), { at: 'x', actor: 'admin', action: 'test', detail: '' }));
await deny('audit not updatable', updateDoc(doc(F(alice), 'audit/a1'), { action: 'x' }));

await testEnv.cleanup();
console.log('\nRULES TEST RESULT: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) console.log('failures: ' + failures.join(' | '));
process.exit(fail === 0 ? 0 : 1);
