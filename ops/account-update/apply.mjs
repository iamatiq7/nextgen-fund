/* Apply one field-by-field update to a member account, live, with before/after evidence.
 *
 * Why this exists: the published Firestore rules let a member READ their own record but not
 * UPDATE it, so an update from the account screen is refused (403). This job performs the same
 * changes with the service account and records every field: old value -> new value.
 *
 * Stage is taken from ops/account-update/TRIGGER (second word): rocky | ronin
 * Every address is masked in the report (this repository is public). DRY_RUN is honoured.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

const keyPath = process.env.SA_KEY || './sa.json';
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const stage = String(process.env.STAGE || '').trim().toLowerCase();
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();
const auth = getAuth();

const TARGETS = {
  rocky: { fullName: 'Rocky', username: 'rocky', email: 'nrbatiq@gmail.com', phone: '01329693997', shares: 3, password: 'nextgen12345', uid: '8R755jav5bSO2XrzfrSY28awGLI2' },
  ronin: { fullName: 'Ronin', username: 'ronin', email: 'rabbironin270@gmail.com', phone: '01329693996', shares: 4, password: 'nextgen12', uid: '8R755jav5bSO2XrzfrSY28awGLI2' }
};

const mask = (v) => { const s = String(v || ''); const [a, b] = s.split('@'); if (!b) return s ? s.slice(0, 3) + '***' : '(empty)'; return a.slice(0, 2) + '***@' + b.slice(0, 1) + '***'; };
const show = (k, v) => (k === 'email' ? mask(v) : String(v === undefined || v === '' ? '(empty)' : v));
const PASSWORD_FIELDS = ['password'];

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const t = TARGETS[stage];
if (!t) { say('unknown stage: ' + JSON.stringify(stage)); process.exit(1); }

const ref = db.collection('users').doc(t.uid);
const snap = await ref.get();
if (!snap.exists) { say('the member record does not exist'); process.exit(1); }
const before = snap.data() || {};
const authBefore = await auth.getUser(t.uid).catch(() => null);

say('stage: ' + stage + ' | member: ' + before.username + ' (' + mask(before.email) + ')');
say('');
say('field            | before                -> after');
say('-----------------|-----------------------------------------------');
const rows = [];
for (const f of ['fullName', 'username', 'email', 'phone', 'shares']) {
  const b = show(f, before[f]);
  const a = show(f, t[f]);
  rows.push({ field: f, before: b, after: a, changed: String(before[f] ?? '') !== String(t[f]) });
  say(f.padEnd(16) + ' | ' + b.padEnd(21) + '-> ' + a);
}
say('password         | (unchanged here)      -> ' + (t.password ? '(set)' : '(empty)'));
say('auth login email | ' + show('email', authBefore && authBefore.email) + ' -> ' + show('email', t.email));
say('');

if (dryRun) { say('DRY RUN: nothing written'); }
else {
  /* 1) the profile fields */
  await ref.set({ fullName: t.fullName, username: t.username, phone: t.phone, shares: t.shares }, { merge: true });
  say('profile fields written: fullName, username, phone, shares');

  /* 2) the login address (Authentication + the record + the public registry) */
  try {
    await auth.updateUser(t.uid, { email: t.email, emailVerified: true });
    say('auth e-mail updated');
  } catch (e) {
    say('auth e-mail FAILED: ' + (e && e.code) + ' ' + (e && e.message));
  }
  await ref.set({ email: t.email, emailChangePending: null }, { merge: true });
  const oldName = String(before.username || '').toLowerCase();
  if (oldName && oldName !== t.username.toLowerCase()) {
    try { await db.collection('usernames').doc(oldName).delete(); say('old registry entry removed: ' + oldName); } catch (e) { }
  }
  await db.collection('usernames').doc(t.username.toLowerCase()).set({ uid: t.uid, email: t.email }, { merge: true });
  say('registry now maps ' + t.username + ' -> ' + mask(t.email));

  /* 3) the password */
  try {
    await auth.updateUser(t.uid, { password: t.password });
    say('password updated');
  } catch (e) {
    say('password FAILED: ' + (e && e.code) + ' ' + (e && e.message));
  }

  await db.collection('audit').add({
    at: new Date().toISOString(), actor: 'system (account-update)', action: 'account.updated',
    detail: stage + ': ' + rows.map(r => r.field + '=' + r.after).join(', ') + ' | password ' + (t.password ? 'set' : 'unchanged')
  });
  say('');
  say('audit entry written');
}

/* read back */
const after = (await ref.get()).data() || {};
const authAfter = await auth.getUser(t.uid).catch(() => null);
say('');
say('read-back (what the app will show)');
for (const f of ['fullName', 'username', 'phone', 'shares']) {
  say('  ' + f.padEnd(10) + ': ' + show(f, after[f]) + (String(after[f] ?? '') === String(t[f]) ? '  OK' : '  MISMATCH (expected ' + show(f, t[f]) + ')'));
}
say('  email     : ' + show('email', after.email) + (String(after.email || '') === t.email ? '  OK' : '  MISMATCH'));
say('  auth email: ' + show('email', authAfter && authAfter.email) + (authAfter && authAfter.email === t.email ? '  OK' : '  MISMATCH'));
const nm = await db.collection('usernames').doc(t.username.toLowerCase()).get();
say('  registry  : ' + (nm.exists ? JSON.stringify({ uid: (nm.data() || {}).uid === t.uid, email: mask((nm.data() || {}).email) }) : 'missing'));

fs.writeFileSync('ops/account-update/REPORT-' + stage + '.txt', lines.join('\n') + '\n');
