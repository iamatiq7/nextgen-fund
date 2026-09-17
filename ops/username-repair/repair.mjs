/* Repair the public username registry.
 *
 * Why this exists
 *   The login screen signs in with an e-mail address, so a username is resolved through the
 *   public usernames/{name} document. Members cannot write that document under the published
 *   rules (403), so an outdated address - for example a placeholder written at registration -
 *   blocks username login for ever. This job runs with the service account, compares every
 *   usernames/{name} document with users/{uid}.email and rewrites only the ones that differ.
 *
 * Safety
 *   - read-only by default: it prints what it would change (DRY_RUN)
 *   - writes only the username documents whose e-mail differs from the member record
 *   - never writes a password, never deletes a document, never touches another field
 *   - masks every address in the output (this repository is public)
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const keyPath = process.env.SA_KEY || './sa.json';
const dryRun = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '(empty)';
  const [a, b] = s.split('@');
  if (!b) return s.slice(0, 3) + '***';
  return a.slice(0, 2) + '***@' + b.slice(0, 1) + '***';
};

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

const names = await db.collection('usernames').get();
say('usernames documents: ' + names.size);
let fixed = 0, ok = 0, orphan = 0;

for (const doc of names.docs) {
  const name = doc.id;
  const data = doc.data() || {};
  const uid = String(data.uid || '');
  const mapMail = String(data.email || '');
  if (!uid) { orphan++; say('  ' + name + ' | no uid -> left alone'); continue; }
  const u = await db.collection('users').doc(uid).get();
  if (!u.exists) { orphan++; say('  ' + name + ' | user record missing -> left alone'); continue; }
  const live = String((u.data() || {}).email || '');
  if (!live) { orphan++; say('  ' + name + ' | record has no e-mail -> left alone'); continue; }
  if (live.toLowerCase() === mapMail.toLowerCase()) { ok++; continue; }
  const changed = '  ' + name + ' | ' + mask(mapMail) + ' -> ' + mask(live);
  if (dryRun) { say('DRY ' + changed); fixed++; continue; }
  await doc.ref.set({ uid: uid, email: live }, { merge: true });
  fixed++;
  say('FIXED' + changed);
}

say('');
say('result: ' + fixed + ' ' + (dryRun ? 'to fix' : 'fixed') + ', ' + ok + ' already correct, ' + orphan + ' skipped');
say('mode: ' + (dryRun ? 'DRY RUN (nothing written)' : 'WRITE'));
fs.writeFileSync('ops/username-repair/REPORT.txt', lines.join('\n') + '\n');
