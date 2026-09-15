#!/usr/bin/env node
/**
 * http-detail.mjs - request/redirect chain, curated headers, ALPN protocol and soft-404 behaviour.
 * usage: node http-detail.mjs <label>
 * env: EVIDENCE_DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';

const EVIDENCE = process.env.EVIDENCE_DIR;
const label = process.argv[2] || 'a';
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

const TARGETS = [
  ['setup.html (Firebase Hosting)', 'https://nextgen-fund-2040.web.app/setup.html'],
  ['root / (Firebase Hosting)', 'https://nextgen-fund-2040.web.app/'],
  ['nonexistent path (rewrite test)', 'https://nextgen-fund-2040.web.app/definitely-not-here-9f3a.html'],
  ['setup.html (GitHub Pages)', 'https://iamatiq7.github.io/nextgen-fund/setup.html'],
  ['setup.html (firebaseapp.com alias)', 'https://nextgen-fund-2040.firebaseapp.com/setup.html'],
  ['http:// (plaintext upgrade test)', 'http://nextgen-fund-2040.web.app/setup.html'],
];

const KEEP = [
  'server', 'content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'age', 'expires',
  'strict-transport-security', 'alt-svc', 'vary', 'x-cache', 'x-cache-hits', 'x-served-by', 'x-timer',
  'via', 'x-fh-requested-host', 'access-control-allow-origin', 'content-encoding', 'location',
];

async function followChain(url) {
  const hops = [];
  let current = url;
  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(current, { redirect: 'manual' });
    const hop = { url: current, status: res.status, location: res.headers.get('location') };
    hops.push(hop);
    if (res.status >= 300 && res.status < 400 && hop.location) {
      current = new URL(hop.location, current).toString();
      continue;
    }
    const hdrs = {};
    for (const k of KEEP) { const v = res.headers.get(k); if (v) hdrs[k] = v; }
    hop.headers = hdrs;
    hop.finalBodyBytes = null;
    try { hop.finalBodyBytes = (await res.arrayBuffer()).byteLength; } catch {}
    return { hops, res, hdrs };
  }
  return { hops, res: null, hdrs: null };
}

say(`=== HTTP request / redirect / header evidence - ${label} ===`);
say(`timestamp: ${new Date().toISOString()}`);
say('');

for (const [name, url] of TARGETS) {
  say(`--- ${name}`);
  say(`    ${url}`);
  try {
    const { hops, hdrs, res } = await followChain(url);
    say(`    hops: ${hops.length}`);
    for (const h of hops) say(`      -> ${h.status} ${h.url}${h.location ? '  location: ' + h.location : ''}`);
    if (hdrs) {
      say(`    final status: ${res.status} | body bytes: ${hops[hops.length - 1].finalBodyBytes}`);
      say('    headers: ' + JSON.stringify(hdrs, null, 2).split('\n').join('\n    '));
      const body = hops[hops.length - 1];
      if (res.status === 200 && /not-here/.test(url)) {
        say('    NOTE: a nonexistent path answered 200 - the SPA rewrite (firebase.json rewrites ** -> /index.html) is active, so there is no real 404 page.');
      }
    }
  } catch (e) {
    say('    ERROR: ' + e.message);
  }
  say('');
}

say('=== negotiated application protocol (ALPN) ===');
for (const [name, host] of [['Firebase Hosting', 'nextgen-fund-2040.web.app'], ['GitHub Pages', 'iamatiq7.github.io']]) {
  await new Promise((resolve) => {
    const client = http2.connect('https://' + host);
    client.on('connect', (s, socket) => {
      say(`${name.padEnd(18)} ${host}  alpn=${socket.alpnProtocol}  remote=${socket.remoteAddress}`);
      client.close();
      resolve();
    });
    client.on('error', (e) => { say(`${name} ${host} ERROR ${e.message}`); resolve(); });
  });
}
say('');

if (EVIDENCE) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const f = path.join(EVIDENCE, `04-http-detail-${label}.txt`);
  fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
  console.log('saved: ' + f);
}
