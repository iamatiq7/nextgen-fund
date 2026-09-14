#!/usr/bin/env node
/**
 * cdp-trace.mjs - drive headless Chrome over the DevTools Protocol and record the real
 * network activity of https://nextgen-fund-2040.web.app/setup.html:
 *   every request (url, method, type), every response (status, mimeType, remote IP, cache),
 *   the final rendered text of the page, and the document title.
 *
 * Read-only: the page is only loaded, never submitted. Nothing is typed into it.
 * usage: node cdp-trace.mjs <label>    env: EVIDENCE_DIR, CHROME, URL
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EVIDENCE = process.env.EVIDENCE_DIR || '.';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.env.URL || 'https://nextgen-fund-2040.web.app/setup.html';
const label = process.argv[2] || 'a';
const PORT = 9333;

const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// label parameter is unused
void label;

const profile = path.join(os.tmpdir(), 'ngf-cdp-profile');
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

async function waitForDevtools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error('devtools endpoint never became ready');
}

const version = await waitForDevtools();
say('=== real browser network trace (Chrome DevTools Protocol) ===');
say(`timestamp  : ${new Date().toISOString()}`);
say(`browser    : ${version.Browser}`);
say(`user agent : ${version['User-Agent']}`);
say(`url loaded : ${URL_}`);
say('');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const requests = new Map();
const responses = [];
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId;
  nextId += 1;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); return; }
  const { method, params } = msg;
  if (method === 'Network.requestWillBeSent') {
    requests.set(params.requestId, { url: params.request.url, method: params.request.method, type: params.type, at: params.timestamp });
  } else if (method === 'Network.responseReceived') {
    responses.push({
      url: params.response.url,
      status: params.response.status,
      mimeType: params.response.mimeType,
      remoteIP: params.response.remoteIPAddress,
      remotePort: params.response.remotePort,
      fromCache: params.response.fromDiskCache || params.response.fromServiceWorker,
      protocol: params.response.protocol,
      type: params.type,
    });
  }
});

await new Promise((resolve) => ws.addEventListener('open', resolve));
await send('Network.enable', { maxTotalBufferSize: 10000000 });
await send('Page.enable');
const navStart = Date.now();
await send('Page.navigate', { url: URL_ });
await sleep(9000); // let the app boot, load the SDK and make its data calls

// final rendered state
const titleRes = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
const textRes = await send('Runtime.evaluate', { expression: 'document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 1200)', returnByValue: true });
const perfRes = await send('Runtime.evaluate', {
  expression: 'JSON.stringify(performance.getEntriesByType("resource").map(e => ({n: e.name, t: e.initiatorType, d: Math.round(e.duration)})))',
  returnByValue: true,
});

say(`navigation started, waited ${((Date.now() - navStart) / 1000).toFixed(1)}s for the app to boot`);
say('');
say('--- requests, in order, with status / remote IP (where the bytes actually came from) ---');
const seen = new Set();
let n = 0;
for (const r of responses) {
  n += 1;
  const key = r.url + r.status;
  const ip = r.remoteIP ? `${r.remoteIP}:${r.remotePort}` : '-';
  const line = `${String(n).padStart(2)}. ${String(r.status).padEnd(4)} ${(r.mimeType || '-').split(';')[0].padEnd(24)} ${(r.protocol || '-').padEnd(6)} ip=${ip.padEnd(24)} ${r.url.length > 130 ? r.url.slice(0, 130) + '…' : r.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  say(line);
}
say('');
say(`total distinct responses recorded: ${seen.size}`);
say('');

const hosts = new Map();
for (const r of responses) {
  let h = '?';
  try { h = new URL(r.url).host; } catch {}
  hosts.set(h, (hosts.get(h) || 0) + 1);
}
say('--- hosts contacted, with the IP each resolved to ---');
for (const [h, c] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) {
  const ips = [...new Set(responses.filter((r) => { try { return new URL(r.url).host === h; } catch { return false; } }).map((r) => r.remoteIP).filter(Boolean))];
  say(`  ${String(c).padStart(3)}x  ${h.padEnd(38)} ${ips.join(', ')}`);
}
say('');

say('--- the page as the browser actually rendered it ---');
say(`document.title : ${JSON.stringify(titleRes && titleRes.result ? titleRes.result.value : '')}`);
say('visible text   :');
say((textRes && textRes.result ? String(textRes.result.value) : '').split('\n').map((l) => '    ' + l).join('\n'));
say('');

try {
  const perf = JSON.parse(perfRes.result.value || '[]');
  say('--- resource timing (what the page loaded) ---');
  for (const p of perf) say(`  ${String(p.d).padStart(5)}ms  ${p.t.padEnd(14)} ${p.n.length > 120 ? p.n.slice(0, 120) + '…' : p.n}`);
} catch (e) { say('resource timing unavailable: ' + e.message); }

fs.mkdirSync(EVIDENCE, { recursive: true });
const f = path.join(EVIDENCE, `06-browser-network-trace-${label}.txt`);
fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + f);

try { ws.close(); } catch {}
child.kill();
process.exit(0);
