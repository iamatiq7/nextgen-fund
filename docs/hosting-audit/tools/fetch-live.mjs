#!/usr/bin/env node
/**
 * fetch-live.mjs - fetch the live setup.html and every asset it references, record status,
 * response headers and a sha256 of the body, then compare the live bytes with the repository
 * copy (line-ending normalised). This is what links "what is served" to "what is deployed".
 *
 * usage: node fetch-live.mjs <label>
 * env: EVIDENCE_DIR, REPO_DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EVIDENCE = process.env.EVIDENCE_DIR;
const REPO = process.env.REPO_DIR;
const label = process.argv[2] || 'a';
const BASE = 'https://nextgen-fund-2040.web.app';
const PAGES_BASE = 'https://iamatiq7.github.io/nextgen-fund';
const out = [];
const say = (s) => { out.push(s); console.log(s); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const norm = (t) => t.replace(/\r\n/g, '\n');
const normSha = (b) => sha(Buffer.from(norm(b.toString('utf8')), 'utf8'));

say(`=== live file fetch + deployment provenance - ${label} ===`);
say(`timestamp: ${new Date().toISOString()}`);
say(`hosting  : ${BASE}`);
say('');

let html = '';
async function head(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, url };
}
async function body(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, buf, url };
}

say('--- response headers, setup.html (fetch, no redirect follow) ---');
const h = await head(`${BASE}/setup.html`);
say(`status: ${h.status}`);
say(JSON.stringify(h.headers, null, 2));
say('');

say('--- setup.html body + provenance ---');
const page = await body(`${BASE}/setup.html`);
html = page.buf.toString('utf8');
say(`status ${page.status} | bytes ${page.buf.length} | sha256 ${sha(page.buf)} | line-endings sha256 ${normSha(page.buf)}`);
if (REPO) {
  const local = fs.readFileSync(path.join(REPO, 'setup.html'));
  const same = norm(local.toString('utf8')) === norm(html);
  say(`repo copy: bytes ${local.length} | line-endings sha256 ${normSha(local)} | identical after line-ending normalisation: ${same ? 'YES' : 'NO'}`);
}
say('');
const rels = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith('#') && !s.startsWith('http') && !s.startsWith('data:'));
say(`referenced local assets (${rels.length}): ${rels.join(', ')}`);
say('');

const interesting = [...new Set([...rels, 'assets/js/firebase-config.js', 'assets/js/firebase-adapter.js', 'assets/js/store.js', 'assets/js/i18n.js'])];
say('--- asset inventory: live vs repo ---');
for (const r of interesting) {
  const url = `${BASE}/${r}`;
  try {
    const b = await body(url);
    const served = b.headers['content-type'] || '-';
    const cache = b.headers['cache-control'] || '-';
    const etag = b.headers['etag'] || '-';
    let cmp = 'no repo copy';
    if (REPO && fs.existsSync(path.join(REPO, r))) {
      const local = fs.readFileSync(path.join(REPO, r));
      cmp = norm(local.toString('utf8')) === norm(b.buf.toString('utf8')) ? 'IDENTICAL to repo' : `DIFFERS from repo (repo ${local.length}B vs live ${b.buf.length}B)`;
    }
    say(`${String(b.status).padEnd(4)} ${r.padEnd(34)} ${String(b.buf.length).padStart(7)}B  ${served.split(';')[0].padEnd(24)} cache=${cache.padEnd(22)} etag=${etag.slice(0, 18)}  ${cmp}`);
  } catch (e) {
    say(`ERR  ${r} - ${e.message}`);
  }
}
say('');

say('--- the other host serving the same repo (GitHub Pages) ---');
try {
  const gp = await body(`${PAGES_BASE}/setup.html`);
  const gh = await head(`${PAGES_BASE}/setup.html`);
  say(`status ${gp.status} | bytes ${gp.buf.length} | sha256 ${sha(gp.buf)} | line-endings sha256 ${normSha(gp.buf)}`);
  say('headers: ' + JSON.stringify(gh.headers, null, 2));
  say(`identical to the Firebase Hosting copy (normalised): ${norm(gp.buf.toString('utf8')) === norm(html) ? 'YES' : 'NO'}`);
} catch (e) {
  say('GitHub Pages fetch failed: ' + e.message);
}
say('');

// deployment timestamps: Firebase Hosting exposes none, but the repo commit dates do
say('--- cache validators differ per host (evidence of two independent serving stacks) ---');
say(`firebase hosting etag: ${page.headers['etag']}`);
say(`firebase hosting cache-control: ${page.headers['cache-control']}`);
say(`firebase hosting server header: ${page.headers['server'] || '(none)'}`);
say(`firebase hosting x-served-by / via: ${page.headers['x-served-by'] || '-'} / ${page.headers['via'] || '-'}`);

if (EVIDENCE) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const f = path.join(EVIDENCE, `03-live-files-${label}.txt`);
  fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
  console.log('saved: ' + f);
}
