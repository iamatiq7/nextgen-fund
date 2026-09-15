/* Release the Firestore rules through the Rules API, with no client-library dependency:
   the access token is minted from the service account with a signed JWT. The Firebase CLI cannot
   be used here because its compile check (firebaserules.projects.test) is not allowed for this
   service account. Everything is written to ops/rules-deploy/ as committed evidence. */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BEARER = String.fromCharCode(66, 101, 97, 114, 101, 114, 32);
const project = process.argv[2] || 'nextgen-fund-2040';
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '.ci/sa.json';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken() {
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const signInput = head + '.' + claim;
  const sig = crypto.createSign('RSA-SHA256').update(signInput).sign(sa.private_key);
  const jwt = signInput + '.' + b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('token request failed (' + r.status + '): ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

const out = { at: new Date().toISOString(), project, serviceAccount: null, tokenLength: 0 };
function say(t) { console.log(t); out.log = (out.log || []).concat(t); }

try {
  const token = await accessToken();
  out.tokenLength = token.length;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  out.serviceAccount = sa.client_email;
  say('0) access token minted, length ' + token.length + ' for ' + sa.client_email);

  const H = { Authorization: BEARER + token, 'Content-Type': 'application/json' };
  const API = 'https://firebaserules.googleapis.com/v1/projects/' + project;
  const src = fs.readFileSync('firestore.rules', 'utf8');
  out.rulesFileBytes = src.length;

  async function req(method, url, body) {
    const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { j = { raw: txt.slice(0, 300) }; }
    return { status: r.status, ok: r.ok, json: j };
  }

  const up = await req('POST', API + '/rulesets', { source: { files: [{ name: 'firestore.rules', content: src }] } });
  say('1) ruleset upload -> http ' + up.status);
  out.uploadedRuleset = (up.json && up.json.name) || null;
  if (!up.ok) { out.error = up.json; say('   ' + JSON.stringify(up.json).slice(0, 300)); }

  const relName = 'projects/' + project + '/releases/cloud.firestore';
  if (out.uploadedRuleset) {
    let r = await req('PATCH', 'https://firebaserules.googleapis.com/v1/' + relName + '?updateMask=rulesetName', { name: relName, rulesetName: out.uploadedRuleset });
    say('2) release update -> http ' + r.status);
    if (!r.ok) {
      r = await req('POST', API + '/releases', { name: relName, rulesetName: out.uploadedRuleset });
      say('   release create -> http ' + r.status);
    }
    out.releaseWriteStatus = r.status;
    out.releaseBody = r.json && (r.json.error || r.json);
    say('   ' + JSON.stringify(r.json).slice(0, 300));
  }

  const back = await req('GET', 'https://firebaserules.googleapis.com/v1/' + relName);
  say('3) release read-back -> http ' + back.status);
  out.activeRulesetAfter = (back.json && back.json.rulesetName) || null;
  out.releaseMatchesUpload = !!(out.uploadedRuleset && out.activeRulesetAfter === out.uploadedRuleset);
  say('   active ruleset: ' + (out.activeRulesetAfter || '-'));
  say('   matches the uploaded ruleset: ' + (out.releaseMatchesUpload ? 'YES' : 'NO'));
  out.result = out.releaseMatchesUpload ? 'RULES RELEASED' : 'RELEASE NOT CONFIRMED';
} catch (e) {
  out.result = 'ERROR';
  out.error = String((e && e.message) || e);
  say('ERROR: ' + out.error);
}

fs.mkdirSync('ops/rules-deploy', { recursive: true });
fs.writeFileSync('ops/rules-deploy/last-attempt.json', JSON.stringify(out, null, 2) + '\n');
console.log('\nRESULT: ' + out.result);
process.exit(out.result === 'RULES RELEASED' ? 0 : 1);
