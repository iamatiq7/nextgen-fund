/* Repair the admin profile document (additive only - nothing is deleted).

   Why: a partial reset deleted users/{uid} while settings/bootstrap and the Firebase Auth account
   survived. The app reads users/{uid} after sign-in to learn the role, so the admin could not get
   in even with the right password. This job recreates that missing document for the uid recorded
   in settings/bootstrap, using the username/e-mail that usernames/* already maps to it.

   Everything printed to the report is masked, because the report is committed to a public repo. */
import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.PROJECT_ID || 'nextgen-fund-2040';
const OUT_DIR = 'ops/admin-repair';
const lines = [];
const log = (s = '') => { lines.push(String(s)); console.log(String(s)); };
const mask = (v) => {
  const s = String(v == null ? '' : v);
  if (!s) return '-';
  if (s.includes('@')) { const [a, b] = s.split('@'); return a.slice(0, 2) + '***@' + String(b).slice(0, 1) + '***'; }
  return s.slice(0, 4) + '***';
};
const month = new Date().toISOString().slice(0, 7);

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  log('=== admin profile repair (additive) ===');
  log('project : ' + PROJECT);
  log('mode    : repair the missing users/{uid} document only - no deletions');
  log('started : ' + new Date().toISOString());
  log('');

  const boot = await db.doc('settings/bootstrap').get();
  if (!boot.exists) {
    log('settings/bootstrap is absent -> the app is already in first-run state.');
    log('Open setup.html and claim a new admin; no repair is needed.');
    log('result  : NOTHING TO DO');
    return 'nothing';
  }
  const adminUid = String((boot.data() || {}).adminUid || '');
  log('settings/bootstrap.adminUid : ' + mask(adminUid));

  const authUsers = await auth.listUsers(1000);
  const acc = authUsers.users.filter((u) => u.uid === adminUid)[0] || null;
  log('auth account for that uid    : ' + (acc ? 'EXISTS (' + mask(acc.email) + ', created ' + (acc.metadata && acc.metadata.creationTime) + ')' : 'MISSING'));

  const unames = await db.collection('usernames').get();
  let uname = '', emailFromMap = '';
  unames.docs.forEach((d) => {
    const data = d.data() || {};
    if (String(data.uid || '') === adminUid) { uname = d.id; emailFromMap = String(data.email || ''); }
  });
  log('username mapped to the admin  : ' + (uname ? mask(uname) : '(none)'));
  log('usernames documents total     : ' + unames.size);

  const prof = await db.doc('users/' + adminUid).get();
  log('users/{adminUid} document     : ' + (prof.exists ? 'ALREADY PRESENT' : 'MISSING  <-- this is why the login fails'));
  log('');

  if (prof.exists) {
    const d = prof.data() || {};
    log('existing profile: role=' + (d.role || '-') + ' status=' + (d.status || '-') + ' username=' + mask(d.username));
    log('result  : NOTHING TO REPAIR');
    return 'present';
  }

  const write = {
    role: 'admin',
    status: 'active',
    username: uname || (acc && acc.email ? String(acc.email).split('@')[0] : 'admin'),
    email: emailFromMap || (acc && acc.email) || '',
    fullName: 'Fund Admin',
    joinMonth: month,
    shares: 0,
    monthlyDue: 0,
    createdAt: new Date().toISOString(),
    repairedAt: new Date().toISOString(),
    repairedBy: 'ci-admin-repair'
  };
  await db.doc('users/' + adminUid).set(write, { merge: true });
  log('created users/{adminUid} with: role=admin status=active username=' + mask(write.username) + ' email=' + mask(write.email) + ' joinMonth=' + write.joinMonth);

  const check = await db.doc('users/' + adminUid).get();
  log('read-back                    : ' + (check.exists ? 'OK (role=' + (check.data().role) + ', status=' + (check.data().status) + ')' : 'FAILED'));
  log('');
  log('result  : REPAIRED - sign in with the existing e-mail and password; the app can now build the admin session.');
  return 'repaired';
}

try {
  const r = await main();
  log('');
  log('finished: ' + new Date().toISOString());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.txt'), lines.join('\n') + '\n', 'utf8');
  process.exit(0);
} catch (e) {
  log('');
  log('ERROR: ' + String((e && e.message) || e));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.txt'), lines.join('\n') + '\n', 'utf8');
  process.exit(1);
}
