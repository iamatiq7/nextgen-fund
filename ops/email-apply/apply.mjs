/* Apply approved e-mail changes.
 *
 * Why: an admin cannot change another member's login address from the browser (Firebase
 * Authentication only lets the signed-in user do it), so an approved e-mail change used to sit
 * until the member pressed "Apply the new e-mail". This job closes that gap: run with the
 * service account it applies every approved change properly -
 *   Authentication e-mail + users/{uid}.email + the public usernames/{name} map + an audit entry.
 *
 * Safety
 *   - DRY_RUN by default: prints what it would do
 *   - only touches records that carry emailChangePending (i.e. an approved change)
 *   - refuses an address that another account already uses
 *   - never deletes anything, never writes a password, masks every address in the output
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

const keyPath = process.env.SA_KEY || './sa.json';
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();
const auth = getAuth();

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '(empty)';
  const [a, b] = s.split('@');
  if (!b) return s.slice(0, 3) + '***';
  return a.slice(0, 2) + '***@' + b.slice(0, 1) + '***';
};

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

const users = await db.collection('users').get();
say('member records: ' + users.size);
let pending = 0, applied = 0, skipped = 0;

for (const doc of users.docs) {
  const u = doc.data() || {};
  const target = String(u.emailChangePending || '').trim();
  if (!target) continue;
  pending++;
  const current = String(u.email || '');
  if (dryRun) { say('DRY  ' + (u.username || doc.id) + ' | ' + mask(current) + ' -> ' + mask(target)); continue; }

  /* refuse an address that belongs to somebody else */
  try {
    await auth.getUserByEmail(target);
    say('SKIP ' + (u.username || doc.id) + ' | ' + mask(target) + ' is already used by another account');
    skipped++;
    continue;
  } catch (eNotFound) { /* good: the address is free */ }

  try {
    await auth.updateUser(doc.id, { email: target, emailVerified: true });
  } catch (eAuth) {
    say('FAIL ' + (u.username || doc.id) + ' | auth update refused: ' + (eAuth && eAuth.code));
    skipped++;
    continue;
  }
  await doc.ref.set({ email: target, emailChangePending: null, emailChangedAt: new Date().toISOString() }, { merge: true });
  const uname = String(u.username || '').toLowerCase();
  if (uname) {
    try { await db.collection('usernames').doc(uname).set({ uid: doc.id, email: target }, { merge: true }); } catch (eMap) { }
  }
  await db.collection('audit').add({
    at: new Date().toISOString(), actor: 'system (email-apply)', action: 'email.changed',
    detail: mask(current) + ' -> ' + mask(target) + ' | approved request applied by the service account'
  });
  applied++;
  say('APPLIED ' + (u.username || doc.id) + ' | ' + mask(current) + ' -> ' + mask(target));
}

say('');
say('result: ' + applied + ' applied, ' + skipped + ' skipped, ' + pending + ' approved changes found');
say('mode: ' + (dryRun ? 'DRY RUN (nothing written)' : 'WRITE'));
fs.mkdirSync('ops/email-apply', { recursive: true });
fs.writeFileSync('ops/email-apply/REPORT.txt', lines.join('\n') + '\n');
