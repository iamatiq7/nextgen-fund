#!/usr/bin/env node
/**
 * parse-netlog.mjs - turn a Chromium --log-net-log capture into a readable trace:
 * every URL the browser requested, grouped by host, with status codes and timing.
 * usage: node parse-netlog.mjs <netlog.json> <out.txt>
 */
import fs from 'node:fs';

const [, , netlogPath, outPath] = process.argv;
const raw = fs.readFileSync(netlogPath, 'utf8');
const log = JSON.parse(raw);
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

const byId = new Map();
const events = log.events || [];
for (const e of events) if (e.params && e.params.url) byId.set(e.source.id, e.params);

say('=== browser network trace (Chromium netlog) ===');
say(`netlog   : ${netlogPath}`);
say(`captured : ${log.constants ? new Date(log.constants.time).toISOString() : 'n/a'}  (netlog capture mode: ${(log.constants && log.constants.capture_mode) || '?'})`);
say(`events   : ${events.length}`);
say('');

const urlEvents = events.filter((e) => e.params && e.params.url && (e.type === 1 || e.type === 2 || e.type >= 100));
const urls = new Map();
for (const e of events) {
  const p = e.params;
  if (!p || !p.url) continue;
  if (!urls.has(p.url)) urls.set(p.url, { url: p.url, phases: [] });
  urls.get(p.url).phases.push(e.type);
}

const hosts = new Map();
for (const u of urls.keys()) {
  let h = '(unknown)';
  try { h = new URL(u).host; } catch {}
  hosts.set(h, (hosts.get(h) || 0) + 1);
}

say('--- hosts requested by the real browser (' + hosts.size + ' distinct) ---');
[...hosts.entries()].sort((a, b) => b[1] - a[1]).forEach(([h, n]) => say(`  ${String(n).padStart(3)}x  ${h}`));
say('');

say('--- every distinct URL requested (' + urls.size + ') ---');
const sorted = [...urls.keys()].sort();
for (const u of sorted) {
  const short = u.length > 160 ? u.slice(0, 160) + '…' : u;
  say('  ' + short);
}
say('');

say('--- requests to Google API infrastructure (where data goes) ---');
const apiHosts = ['identitytoolkit.googleapis.com', 'firestore.googleapis.com', 'securetoken.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com', 'content-firebaseappcheck.googleapis.com'];
for (const h of apiHosts) {
  const hits = sorted.filter((u) => u.includes(h));
  say(`  ${h.padEnd(46)} ${hits.length} request(s)`);
  hits.slice(0, 4).forEach((u) => say('      ' + u.slice(0, 150)));
}
say('');

say('--- the Firebase JS SDK bundle source ---');
const sdk = sorted.filter((u) => /gstatic|firebase/i.test(u));
say(`  ${sdk.length} matching request(s)`);
sdk.slice(0, 6).forEach((u) => say('      ' + u.slice(0, 150)));

fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + outPath);
