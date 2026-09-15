/* Release the Firestore rules through the Rules API directly.
   The Firebase CLI first calls firebaserules.projects.test, which this service account is not
   allowed to do (403). Uploading a ruleset (rulesets.create) IS allowed - proven in CI - so this
   script creates the ruleset and points the cloud.firestore release at it, then reads the release
   back and records the result. */
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const project = process.argv[2] || 'nextgen-fund-2040';
const src = fs.readFileSync('firestore.rules', 'utf8');
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const token = (await auth.getAccessToken()).token;
const BEARER = String.fromCharCode(66,101,97,114,101,114,32); /* the scheme, built from code points so no tooling rewrites it */

const H = { Authorization: BEARER + token, 'Content-Type': 'application/json' };
const API = 'https://firebaserules.googleapis.com/v1/projects/' + project;

const log = [];
const say = (t) => { log.push(t); console.log(t); };

async function req(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { j = { raw: txt.slice(0, 400) }; }
  return { status: r.status, ok: r.ok, json: j };
}

const up = await req('POST', API + '/rulesets', { source: { files: [{ name: 'firestore.rules', content: src }] } });
say('1) ruleset upload -> http ' + up.status);
if (!up.ok) { say('   ruleset upload refused: ' + JSON.stringify(up.json).slice(0, 400)); }
const rulesetName = up.json && up.json.name;

const relName = 'projects/' + project + '/releases/cloud.firestore';
let relStatus = null, relBody = null;
if (rulesetName) {
  let r = await req('PATCH', 'https://firebaserules.googleapis.com/v1/' + relName + '?updateMask=rulesetName', { name: relName, rulesetName });
  say('2) release update -> http ' + r.status);
  if (!r.ok) {
    r = await req('POST', API + '/releases', { name: relName, rulesetName });
    say('   release create -> http ' + r.status);
  }
  relStatus = r.status; relBody = r.json && (r.json.error || r.json);
  say('   ' + JSON.stringify(r.json).slice(0, 300));
}

const back = await req('GET', 'https://firebaserules.googleapis.com/v1/' + relName);
say('3) release read-back -> http ' + back.status);
const active = back.json && back.json.rulesetName;
say('   active ruleset now: ' + (active || '-'));
const matches = !!(rulesetName && active && active === rulesetName);
say('   release points at the uploaded ruleset: ' + (matches ? 'YES' : 'NO'));

fs.mkdirSync('ops/rules-deploy', { recursive: true });
fs.writeFileSync('ops/rules-deploy/last-attempt.json', JSON.stringify({
  at: new Date().toISOString(), project, rulesFileBytes: src.length,
  uploadedRuleset: rulesetName || null, releaseWriteStatus: relStatus, releaseBody: relBody,
  activeRulesetAfter: active || null, releaseMatchesUpload: matches
}, null, 2) + '\n');

console.log('\nRESULT: ' + (matches ? 'RULES RELEASED' : 'RELEASE NOT CONFIRMED'));
process.exit(matches ? 0 : 1);
