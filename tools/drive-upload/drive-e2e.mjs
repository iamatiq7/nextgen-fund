#!/usr/bin/env node
/**
 * drive-e2e.mjs — proves the Google Drive half of the registration with a local mock endpoint
 * (no Google account needed on our side). Checks:
 *   1. the form asks for the four named documents
 *   2. the app posts them to the Drive endpoint, folder named after the username
 *   3. the four files arrive under their fixed names, valid base64, right mime type
 *   4. the folder/file links the endpoint returns are kept by the app
 *   5. no console error throughout
 * usage: node drive-e2e.mjs <repoDir> <out.txt>
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = process.argv[2];
const OUT = process.argv[3] || 'drive-e2e.txt';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_PORT = 8112, DRIVE_PORT = 8113, CDP = 9346;

const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };
let pass = 0, fail = 0;
const check = (l, ok, d = '') => { if (ok) pass++; else fail++; say(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  [' + d + ']' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let received = null;
const drive = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      const files = (p.files || []).map((f) => ({
        name: f.name, mime: f.mime, bytes: f.bytes,
        base64Valid: /^[A-Za-z0-9+/=]+$/.test(f.base64 || '') && (f.base64 || '').length > 20
      }));
      received = { username: p.username, folder: p.folder, files };
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify({
        ok: true, folderId: 'mock-folder-1', folderUrl: 'https://drive.google.com/drive/folders/mock-folder-1',
        username: p.username,
        files: files.map((f, i) => ({ name: f.name, id: 'mock-file-' + (i + 1), url: 'https://drive.google.com/file/d/mock-file-' + (i + 1) }))
      }));
    } catch (e) {
      res.writeHead(500, Object.assign({ 'Content-Type': 'application/json' }, cors));
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  });
});
await new Promise((r) => drive.listen(DRIVE_PORT, '127.0.0.1', r));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const site = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(REPO, p === '/' ? 'index.html' : p);
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404).end('nope'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
await new Promise((r) => site.listen(APP_PORT, '127.0.0.1', r));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(os.tmpdir(), 'ngf-drive2-' + Date.now())}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok) break; } catch {} await sleep(400); }
const t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 1; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((r) => { const n = id++; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 120));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 120));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable'); await send('Runtime.enable');

const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r && r.exceptionDetails) return { error: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  return { value: r && r.result ? r.result.value : undefined };
};

say('=== Google Drive upload path — end-to-end against a mock Apps Script ===');
say(`timestamp : ${new Date().toISOString()}`);
say(`app       : http://127.0.0.1:${APP_PORT}/register.html`);
say(`mock drive: http://127.0.0.1:${DRIVE_PORT}/exec`);
say('');

await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/register.html` });
await sleep(2500);

/* point the app at the mock endpoint the same way the admin settings field does */
const setEp = await ev(`(()=>{try{var k='ngf_db';var db=JSON.parse(localStorage.getItem(k)||'{}');db.driveEndpoint='http://127.0.0.1:${DRIVE_PORT}/exec';localStorage.setItem(k,JSON.stringify(db));window.NGF_DRIVE_ENDPOINT='http://127.0.0.1:${DRIVE_PORT}/exec';return 'set';}catch(e){return 'err:'+e.message;}})()`);
say(`endpoint set in the browser: ${setEp.value}`);

const kinds = JSON.parse((await ev(`JSON.stringify(Array.from(document.querySelectorAll('#doc-fields input[type=file]')).map(function(i){return i.getAttribute('data-kind');}))`)).value || '[]');
check('the form asks for the four named documents', kinds.length === 4 && ['nid-front', 'nid-back', 'profile-picture', 'nominee-passport-photo'].every((k) => kinds.indexOf(k) !== -1), kinds.join(', '));

const ep = (await ev(`(async()=>String(await window.NGFStore.getDriveEndpoint()))()`)).value;
check('the store resolves the configured Drive endpoint', /8113/.test(String(ep)), String(ep));

const made = await ev(`(()=>{function mk(n,m){var b=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0]);return new File([b],n,{type:m||'image/jpeg'});}window.__docs=[['nid-front',mk('my-nid-front.jpg')],['nid-back',mk('my-nid-back.jpg')],['profile-picture',mk('me.png','image/png')],['nominee-passport-photo',mk('nominee.jpg')]].map(function(p){return {key:p[0],file:p[1]};});return 'ready:'+window.__docs.length;})()`);
check('four documents prepared in the page', String(made.value) === 'ready:4', String(made.value));

const upload = await ev(`(async()=>{try{var r=await window.NGFStore.uploadToDrive('drive.test', window.__docs);return JSON.stringify(r);}catch(e){return JSON.stringify({ok:false,reason:'threw:'+e.message});}})()`);
const up = JSON.parse(upload.value || '{}');
check('the app posts the documents and gets a folder back', up.ok === true && !!up.folderId, 'folderId=' + (up.folderId || '-') + ' reason=' + (up.reason || '-'));

say('');
say('--- what the Drive endpoint received ---');
say(`folder name : ${received ? received.username : '(nothing)'}`);
(received ? received.files : []).forEach((f) => say(`  ${f.name.padEnd(30)} mime=${String(f.mime).padEnd(11)} bytes=${f.bytes} base64ok=${f.base64Valid}`));
const names = received ? received.files.map((f) => f.name) : [];
check('the folder is named after the username', !!received && received.username === 'drive.test', received ? received.username : 'none');
check('the four files arrive with their fixed names', ['nid-front.jpg', 'nid-back.jpg', 'profile-picture.png', 'nominee-passport-photo.jpg'].every((n) => names.indexOf(n) !== -1), names.join(', '));
check('every file arrived as valid base64 with an image mime type', !!received && received.files.length === 4 && received.files.every((f) => f.base64Valid && /^image\//.test(f.mime)), '');
check('the app keeps the Drive links the endpoint returned', up.ok === true && (up.files || []).length === 4 && /drive\.google\.com/.test(String(up.files[0].url)), (up.files && up.files[0] && up.files[0].url) || '-');
check('no console error during the flow', errors.length === 0, errors[0] || 'clean');

say('');
say(`checks: ${pass + fail}   pass: ${pass}   fail: ${fail}`);
say(`RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT'}`);
fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
try { ws.close(); } catch {}
chrome.kill(); site.close(); drive.close();
console.log('saved: ' + OUT);
process.exit(fail === 0 ? 0 : 2);
