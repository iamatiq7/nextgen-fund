#!/usr/bin/env node
/**
 * cdp-eval.mjs - load the page in headless Chrome and evaluate the app's own functions
 * inside the page, then print the results. Read-only: nothing is submitted or written.
 * usage: node cdp-eval.mjs <label>   env: EVIDENCE_DIR, CHROME, URL
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EVIDENCE = process.env.EVIDENCE_DIR || '.';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.env.URL || 'https://nextgen-fund-2040.web.app/setup.html';
const label = process.argv[2] || 'a';
const PORT = 9334;

const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = path.join(os.tmpdir(), 'ngf-cdp-eval');
const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(500); }
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId; nextId += 1; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await sleep(8000);

const EXPRS = [
  ['which storage mode is the page using', 'window.NGFStore ? window.NGFStore.mode : "no store"'],
  ['the app\'s own adminExists()', '(async()=>String(await window.NGFStore.adminExists()))()'],
  ['the app\'s read-only inventory (counts + adminExists)', '(async()=>JSON.stringify(await window.NGFStore.resetInventory()))()'],
  ['adapter-level adminExists via the store', '(async()=>String(await window.NGFStore._fb.adminExists()))()'],
  ['does the page believe it is in demo mode', '(async()=>String(window.NGFCOMMON && window.NGFCOMMON.isDemo ? window.NGFCOMMON.isDemo() : "n/a"))()'],
  ['localStorage keys', 'JSON.stringify(Object.keys(window.localStorage))'],
  ['localStorage contents (truncated)', 'JSON.stringify(Object.fromEntries(Object.entries(window.localStorage).map(([k,v])=>[k,String(v).slice(0,120)])))'],
  ['indexedDB databases', '(async()=>JSON.stringify((await window.indexedDB.databases()).map(d=>d.name)))()'],
  ['service workers registered', '(async()=>JSON.stringify((await navigator.serviceWorker.getRegistrations()).map(r=>r.active&&r.active.scriptURL)))()'],
  ['visible heading text', 'document.querySelector("h1") ? document.querySelector("h1").innerText : "-"'],
  ['what the body says about setup', 'document.getElementById("setup-body") ? document.getElementById("setup-body").innerText.replace(/\\n+/g," | ").slice(0,300) : "-"'],
  ['is there a form on the page', 'document.querySelectorAll("form").length + " form(s); inputs: " + document.querySelectorAll("input").length'],
];

say('=== evaluating the app\'s own functions inside the page ===');
say(`timestamp: ${new Date().toISOString()}`);
say(`url: ${URL_}`);
say('');
for (const [name, expr] of EXPRS) {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const val = res && res.result ? res.result.value : JSON.stringify(res);
  say(`--- ${name}`);
  say(`    ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  if (res && res.exceptionDetails) say('    EXCEPTION: ' + JSON.stringify(res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
  say('');
}

fs.mkdirSync(EVIDENCE, { recursive: true });
const f = path.join(EVIDENCE, `08-page-state-${label}.txt`);
fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + f);
try { ws.close(); } catch {}
child.kill();
process.exit(0);
