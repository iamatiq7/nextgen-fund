#!/usr/bin/env node
/**
 * analyze-code.mjs - what the served page actually does: external endpoints, Firebase services,
 * Firestore collection names, the admin-creation call chain, and the form fields it renders.
 * Read-only static analysis of the files the live host serves.
 * usage: node analyze-code.mjs   (env: REPO_DIR, EVIDENCE_DIR)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.REPO_DIR || '.';
const EVIDENCE = process.env.EVIDENCE_DIR;
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

const files = [
  'setup.html', 'assets/js/setup.js', 'assets/js/firebase-config.js',
  'assets/js/store.js', 'assets/js/firebase-adapter.js', 'assets/js/common.js',
  'firebase.json', '.firebaserc', '.github/workflows/firebase-hosting.yml',
];

say('=== static analysis of the served files ===');
say(`timestamp: ${new Date().toISOString()}`);
say(`repo: ${REPO}`);
say('');

const HOSTS = new Set();
const APIS = new Set();
const COLLECTIONS = new Set();

for (const f of files) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) { say(`(missing: ${f})`); continue; }
  const text = fs.readFileSync(p, 'utf8');
  say(`--- ${f}  (${text.length} chars, sha256 ${(await import('node:crypto')).createHash('sha256').update(text).digest('hex').slice(0, 16)}...)`);
  for (const m of text.matchAll(/(?:https?:\/\/)([a-z0-9.-]+\.[a-z]{2,})/gi)) HOSTS.add(m[1]);
  for (const m of text.matchAll(/(?:identitytoolkit|securetoken|firestore|storage|cloudfunctions)\.googleapis\.com|www\.googleapis\.com[^\s"']*/g)) APIS.add(m[0]);
  for (const m of text.matchAll(/collection\(\s*['"]([a-z_]+)['"]/gi)) COLLECTIONS.add(m[1]);
  for (const m of text.matchAll(/doc\(\s*['"]([a-z_\/{}]+)['"]/gi)) COLLECTIONS.add('doc:' + m[1]);
  say('');
}

say('=== hosts referenced in the served files ===');
[...HOSTS].sort().forEach((h) => say('  ' + h));
say('');
say('=== google API endpoints referenced ===');
[...APIS].sort().forEach((a) => say('  ' + a));
say('');
say('=== firestore collection / document names referenced ===');
[...COLLECTIONS].sort().forEach((c) => say('  ' + c));
say('');

// the admin creation call chain, quoted from the source
const store = fs.readFileSync(path.join(REPO, 'assets/js/store.js'), 'utf8');
const adapter = fs.readFileSync(path.join(REPO, 'assets/js/firebase-adapter.js'), 'utf8');
const setupJs = fs.readFileSync(path.join(REPO, 'assets/js/setup.js'), 'utf8');

say('=== the page\'s own description of itself (meta) ===');
const html = fs.readFileSync(path.join(REPO, 'setup.html'), 'utf8');
for (const m of html.matchAll(/<meta[^>]+(?:name|property)="([^"]+)"[^>]+content="([^"]*)"/g)) say(`  ${m[1]} = ${m[2]}`);
say('');

say('=== form fields rendered by setup.js ===');
for (const m of setupJs.matchAll(/<input type="([^"]+)" id="([^"]+)"[^>]*>/g)) {
  const ph = (m[0].match(/placeholder="[^"]*"/) || [''])[0];
  say(`  #${m[2].padEnd(10)} type=${m[1].padEnd(9)} ${ph}`);
}
say('');

function extract(text, needle, len = 900) {
  const i = text.indexOf(needle);
  if (i < 0) return `(not found: ${needle})`;
  return text.slice(i, i + len).split('\n').slice(0, 26).join('\n');
}

say('=== setupAdmin implementation (store.js) ===');
say(extract(store, 'setupAdmin'));
say('');
say('=== the adapter call it delegates to (firebase-adapter.js) ===');
say(extract(adapter, 'setupAdmin', 1400));
say('');
say('=== adminExists check (what makes the page show a form or a refusal) ===');
say(extract(store, 'adminExists', 500));
say('');
say('=== deployment config (firebase.json / .firebaserc / CI workflow) ===');
say('firebase.json:');
say(fs.readFileSync(path.join(REPO, 'firebase.json'), 'utf8'));
say('.firebaserc:');
say(fs.readFileSync(path.join(REPO, '.firebaserc'), 'utf8'));
say('workflow:');
say(fs.readFileSync(path.join(REPO, '.github/workflows/firebase-hosting.yml'), 'utf8'));

if (EVIDENCE) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const f = path.join(EVIDENCE, '05-code-analysis.txt');
  fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
  console.log('saved: ' + f);
}
