/* Compile-check the Firestore rules with the Firebase Rules API (no Java, no emulator needed).
   Writes the full server answer to ops/rules-deploy/last-attempt.json so a failed release is
   recorded in the repository instead of only inside a CI log. */
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const project = process.argv[2] || 'nextgen-fund-2040';
const src = fs.readFileSync('firestore.rules', 'utf8');
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await auth.getClient();
const token = (await client.getAccessToken()).token;

const url = 'https://firebaserules.googleapis.com/v1/projects/' + project + '/rulesets';
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] } })
});
const txt = await res.text();
let body = null;
try { body = JSON.parse(txt); } catch (e) { body = { raw: txt.slice(0, 2000) }; }

fs.mkdirSync('ops/rules-deploy', { recursive: true });
fs.writeFileSync('ops/rules-deploy/last-attempt.json', JSON.stringify({
  at: new Date().toISOString(), project, status: res.status,
  rulesFileBytes: src.length, answer: body
}, null, 2) + '\n');

console.log('ruleset compile check -> http ' + res.status);
console.log(txt.slice(0, 1500));
process.exit(res.ok ? 0 : 1);
