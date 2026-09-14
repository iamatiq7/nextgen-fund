#!/usr/bin/env node
/* ============================================================
   NextGen Fund - database reset toolbox (no dependencies)
   ------------------------------------------------------------
   backup      dump every collection to JSON + sha256
   wipe        delete every application document (idempotent)
   seed-admin  create exactly one admin from a first-run state
   restore     write a backup back (idempotent, exact replace)
   verify      print per-collection counts and first-run assertions
   list        read-only inventory of every collection

   Safety, by design:
   - refuses to run against any project other than the one pinned here
     (--project must equal the pinned id, or --allow-project explicitly)
   - every destructive mode requires --yes; --dry-run prints the plan
     without touching anything
   - prints the exact host it will talk to before doing anything

   Auth (live):  --email you@example.com --password '...'
                 or --id-token <token>  or env NGF_ID_TOKEN
   Auth (local): --emulator   (Firestore :8080 / Auth :9099)
   ============================================================ */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TARGET_PROJECT = 'nextgen-fund-2040';

/* Application state, in wipe order: children before parents, settings last so a
   half-finished run never leaves the app looking "configured". */
const COLLECTIONS = ['payments', 'registrations', 'audit', 'usernames', 'users', 'finance', 'settings'];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, dflt) => {
  const hit = args.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return dflt;
  if (hit === '--' + name) {
    const i = args.indexOf(hit);
    return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
  }
  return hit.slice(name.length + 3);
};

const MODE = ['backup', 'wipe', 'restore', 'verify', 'seed-admin', 'list'].find((m) => has('--' + m));
const EMULATOR = has('--emulator');
const DRY = has('--dry-run');
const YES = has('--yes');
const PROJECT = opt('project', EMULATOR ? 'demo-nextgen-fund' : TARGET_PROJECT);
const OUT_DIR = opt('out', resolve(process.cwd(), '.reset-backups'));
const FROM = opt('from', null);

const FS_HOST = EMULATOR ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
const AUTH_HOST = EMULATOR ? 'http://127.0.0.1:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
const DOCS = FS_HOST + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const AUTH = AUTH_HOST + '/v1/accounts';

const log = (...a) => console.log(...a);
const die = (msg, code = 1) => { console.error('ERROR: ' + msg); process.exit(code); };

if (!MODE) die('pick a mode: --backup | --wipe | --restore --from <file> | --verify | --seed-admin | --list');
if (!EMULATOR && PROJECT !== TARGET_PROJECT && !has('--allow-project')) {
  die('refusing to touch project "' + PROJECT + '": this toolbox is pinned to ' + TARGET_PROJECT
    + '. Pass --allow-project if that is really intended.');
}

let API_KEY = null;
let ID_TOKEN = EMULATOR ? 'owner' : (opt('id-token', process.env.NGF_ID_TOKEN || null));

function apiKey() {
  if (API_KEY) return API_KEY;
  const p = opt('config', process.env.NGF_CONFIG || 'assets/js/firebase-config.js');
  const m = readFileSync(p, 'utf8').match(/apiKey:\s*"([^"]+)"/);
  if (!m) die('could not read the app api key (pass --config <path>)');
  API_KEY = m[1];
  return API_KEY;
}

async function http(method, url, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
  if (ID_TOKEN && !h.Authorization) h.Authorization = 'Bearer ' + ID_TOKEN;
  const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

/* Auth calls go out with the API key only: the Auth emulator omits idToken when
   a request already carries an Authorization header, which would silently turn
   every following write into an unauthenticated one. */
async function authPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json: json, text: text };
}

async function signIn() {
  const email = opt('email', null);
  const password = opt('password', process.env.NGF_PASSWORD || null);
  if (EMULATOR) {
    /* with credentials the emulator issues a real client token, so the security
       rules are enforced; without them we use the owner bypass (admin SDK). */
    if (email && password) {
      const r = await authPost(AUTH + ':signInWithPassword?key=' + apiKey(), { email: email, password: password, returnSecureToken: true });
      if (r.status !== 200) die('emulator sign-in failed (' + r.status + ')');
      ID_TOKEN = r.json.idToken;
      return 'emulator client ' + r.json.email + ' (rules ENFORCED)';
    }
    ID_TOKEN = 'owner';
    return 'emulator owner bypass (rules NOT enforced)';
  }
  if (ID_TOKEN) return 'pre-supplied token';
  if (!email || !password) die('live runs need --email and --password (or --id-token / NGF_ID_TOKEN)');
  const r = await authPost(AUTH + ':signInWithPassword?key=' + apiKey(), { email, password, returnSecureToken: true });
  if (r.status !== 200) die('sign-in failed (' + r.status + ') - wrong email or password');
  ID_TOKEN = r.json.idToken;
  return 'signed in as ' + r.json.email;
}

async function listAll(coll) {
  const out = [];
  let token = null;
  do {
    const url = DOCS + '/' + coll + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const r = await http('GET', url);
    if (r.status !== 200) return { error: r.status };
    out.push.apply(out, r.json.documents || []);
    token = r.json.nextPageToken || null;
  } while (token);
  return { documents: out };
}

async function deleteDoc(name) {
  const r = await http('DELETE', FS_HOST + '/v1/' + name);
  if (r.status === 200 || r.status === 404) return true;
  throw new Error('delete ' + name + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
}

async function createDoc(coll, id, fields) {
  const url = DOCS + '/' + coll + '?documentId=' + encodeURIComponent(id);
  const r = await http('POST', url, { fields: fields });
  if (r.status === 200) return 'created';
  if (r.status === 409) {
    await http('DELETE', DOCS + '/' + coll + '/' + id);
    const r2 = await http('POST', url, { fields: fields });
    if (r2.status !== 200) throw new Error('replace ' + coll + '/' + id + ' -> ' + r2.status + ' ' + r2.text.slice(0, 160));
    return 'replaced';
  }
  throw new Error('create ' + coll + '/' + id + ' -> ' + r.status + ' ' + r.text.slice(0, 200));
}

const shortId = (name) => name.split('/documents/')[1];

async function countsOf() {
  const c = {};
  for (const coll of COLLECTIONS) {
    const res = await listAll(coll);
    c[coll] = res.error
      ? (coll === 'settings' && res.error === 403 ? 'by-id(403)' : 'unreadable(' + res.error + ')')
      : res.documents.length;
  }
  return c;
}

async function cmdList() {
  log('target   : ' + PROJECT);
  log('host     : ' + DOCS);
  log('auth     : ' + await signIn());
  const c = await countsOf();
  for (const k of Object.keys(c)) log('  ' + k.padEnd(14) + ' -> ' + c[k]);
}

async function cmdBackup() {
  log('target   : ' + PROJECT);
  log('auth     : ' + await signIn());
  const dump = { project: PROJECT, takenAt: new Date().toISOString(), collections: {} };
  const counts = {};
  for (const coll of COLLECTIONS) {
    const res = await listAll(coll);
    if (res.error) {
      counts[coll] = 'skipped(' + res.error + ')';
      dump.collections[coll] = { skipped: res.error };
      continue;
    }
    counts[coll] = res.documents.length;
    dump.collections[coll] = res.documents;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = resolve(OUT_DIR, 'backup-' + PROJECT + '-' + stamp + '.json');
  mkdirSync(dirname(file), { recursive: true });
  const blob = Buffer.from(JSON.stringify(dump, null, 2), 'utf8');
  writeFileSync(file, blob);
  const sha = createHash('sha256').update(blob).digest('hex');
  writeFileSync(file + '.sha256', sha + '  ' + file.split(/[\\/]/).pop() + '\n');
  log('counts   : ' + JSON.stringify(counts));
  log('file     : ' + file);
  log('bytes    : ' + blob.length);
  log('sha256   : ' + sha);
}

async function cmdWipe() {
  log('target   : ' + PROJECT);
  log('host     : ' + DOCS);
  log('auth     : ' + await signIn());
  log('plan     : ' + JSON.stringify(await countsOf()));
  if (DRY) { log('dry-run  : nothing was deleted'); return; }
  if (!YES) die('refusing to delete without --yes (use --dry-run to preview)');

  const SINGLETONS = ['settings/public', 'settings/bootstrap'];
  let deleted = 0;
  const failed = [];

  /* Order matters twice over:
     1. every listable collection first, the two settings documents by id last;
     2. emptiness is checked BEFORE the bootstrap is released, because deleting
        the bootstrap removes the admin's own rights - anything read afterwards
        would come back as PERMISSION_DENIED instead of a real count. */
  for (const coll of COLLECTIONS) {
    if (coll === 'settings') continue;
    const res = await listAll(coll);
    if (res.error) { failed.push(coll + '=unreadable(' + res.error + ')'); continue; }
    for (const d of res.documents) {
      try { await deleteDoc(d.name); deleted++; } catch (e) { failed.push(String(e.message)); }
    }
  }
  const after = await countsOf();
  log('deleted  : ' + deleted + ' document(s)');
  log('after    : ' + JSON.stringify(after));
  const left = Object.entries(after).filter((e) => e[0] !== 'settings' && e[1] !== 0);
  if (left.length || failed.length) {
    if (left.length) log('problems : ' + JSON.stringify(Object.fromEntries(left)));
    if (failed.length) log('problems : ' + JSON.stringify(failed));
    die('wipe finished with problems', 2);
  }

  /* DELETE on an absent document answers 200, so these are logged but never
     counted; the public probe below is what proves they are really gone. */
  for (const rel of SINGLETONS) {
    const r = await http('DELETE', DOCS + '/' + rel);
    log('by id    : ' + rel + ' -> http ' + r.status);
    if (r.status !== 200 && r.status !== 404) failed.push(rel + ' -> ' + r.status);
  }
  const probes = {};
  for (const rel of SINGLETONS) {
    const g = await http('GET', DOCS + '/' + rel);
    probes[rel] = g.status === 404 ? 'absent' : 'present(' + g.status + ')';
  }
  log('probe    : ' + JSON.stringify(probes));
  if (failed.length) { log('problems : ' + JSON.stringify(failed)); die('wipe finished with problems', 2); }
  if (probes['settings/public'] !== 'absent' || probes['settings/bootstrap'] !== 'absent') {
    die('configuration documents survived the wipe: ' + JSON.stringify(probes), 2);
  }
  log('RESULT   : database is empty - the app is back to first-run (setup.html)');
}

async function cmdSeedAdmin() {
  const username = String(opt('username', 'admin')).trim().toLowerCase();
  const email = opt('email', null);
  const password = opt('password', process.env.NGF_PASSWORD || null);
  const fullName = opt('full-name', 'Fund Administrator');
  if (!email || !password) die('--seed-admin needs --email and --password');
  if (String(password).length < 8) die('password must be at least 8 characters');
  log('target   : ' + PROJECT);
  log('host     : ' + DOCS);
  if (DRY) { log('dry-run  : would create admin "' + username + '" and claim settings/bootstrap'); return; }
  if (!YES) die('refusing to write without --yes');
  const boot = await http('GET', DOCS + '/settings/bootstrap');
  if (boot.status === 200) die('settings/bootstrap already exists - not in first-run state (wipe first)');

  const up = await authPost(AUTH + ':signUp?key=' + apiKey(), { email: email, password: password, returnSecureToken: true });
  let uid = up.json && up.json.localId;
  if (up.status !== 200) {
    const si = await authPost(AUTH + ':signInWithPassword?key=' + apiKey(), { email: email, password: password, returnSecureToken: true });
    if (si.status !== 200) die('could not create or sign in the admin account (' + up.status + '): ' + up.text.slice(0, 200));
    uid = si.json.localId;
    ID_TOKEN = si.json.idToken;
  } else {
    ID_TOKEN = up.json.idToken;
  }
  if (!ID_TOKEN) die('no id token returned - refusing to write unauthenticated');

  const must = (r, what) => {
    if (r.status !== 200) die(what + ' -> http ' + r.status + ': ' + r.text.slice(0, 160));
    return r;
  };
  must(await http('POST', DOCS + '/settings?documentId=bootstrap',
    { fields: { adminUid: { stringValue: uid }, claimedAt: { timestampValue: new Date().toISOString() } } }),
    'claim settings/bootstrap');
  log('bootstrap: claimed');
  must(await http('POST', DOCS + '/users?documentId=' + uid, {
    fields: {
      role: { stringValue: 'admin' }, status: { stringValue: 'active' },
      username: { stringValue: username }, email: { stringValue: email },
      fullName: { stringValue: fullName }, phone: { stringValue: '' }, address: { stringValue: '' },
      shares: { integerValue: '0' }, monthlyDue: { integerValue: '0' }, joinMonth: { stringValue: '' },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  }), 'create users/' + uid);
  log('admin doc: created');
  must(await http('POST', DOCS + '/usernames?documentId=' + encodeURIComponent(username),
    { fields: { uid: { stringValue: uid }, email: { stringValue: email } } }), 'create usernames/' + username);
  log('username map: created');
  const st = await http('GET', DOCS + '/settings/public');
  if (st.status === 404) {
    must(await http('POST', DOCS + '/settings?documentId=public', {
      fields: {
        fundName: { stringValue: 'NextGen Fund' }, currency: { stringValue: 'BDT' },
        monthlyPerShare: { integerValue: '1000' }, updatedAt: { timestampValue: new Date().toISOString() },
      },
    }), 'create settings/public');
    log('settings/public: created');
  } else {
    log('settings/public: kept (already present)');
  }
  log('admin    : username "' + username + '" uid ' + uid);
  log('RESULT   : first-run admin created - log in with that username and password');
}

async function cmdRestore() {
  if (!FROM) die('--restore needs --from <backup.json>');
  const dump = JSON.parse(readFileSync(FROM, 'utf8'));
  log('target   : ' + PROJECT);
  log('auth     : ' + await signIn());
  log('from     : ' + FROM + ' (taken ' + dump.takenAt + ')');
  const plan = {};
  for (const coll of Object.keys(dump.collections)) {
    const d = dump.collections[coll];
    plan[coll] = Array.isArray(d) ? d.length : 'skipped(' + d.skipped + ')';
  }
  log('plan     : ' + JSON.stringify(plan));
  if (DRY) { log('dry-run  : nothing was written'); return; }
  if (!YES) die('refusing to write without --yes (use --dry-run to preview)');
  let written = 0;
  const failed = [];
  for (const coll of Object.keys(dump.collections)) {
    const docs = dump.collections[coll];
    if (!Array.isArray(docs)) continue;
    for (const d of docs) {
      const id = shortId(d.name).split('/').slice(1).join('/');
      try { await createDoc(coll, id, d.fields || {}); written++; } catch (e) { failed.push(e.message); }
    }
  }
  log('written  : ' + written + ' document(s)');
  if (failed.length) { log('problems : ' + JSON.stringify(failed.slice(0, 10))); die('restore finished with problems', 2); }
  log('RESULT   : restore complete');
}

async function cmdVerify() {
  log('target   : ' + PROJECT);
  log('host     : ' + DOCS);
  log('auth     : ' + await signIn());
  const counts = await countsOf();
  log('counts   : ' + JSON.stringify(counts));
  const users = (await listAll('users')).documents || [];
  const roles = users.reduce((a, d) => {
    const r = (d.fields && d.fields.role && d.fields.role.stringValue) || '?';
    a[r] = (a[r] || 0) + 1;
    return a;
  }, {});
  const boot = await http('GET', DOCS + '/settings/bootstrap');
  const pub = await http('GET', DOCS + '/settings/public');
  log('singletons: settings/public=' + (pub.status === 404 ? 'absent' : 'present')
    + ' settings/bootstrap=' + (boot.status === 404 ? 'absent' : 'present'));
  log('roles    : ' + JSON.stringify(roles));
  log('bootstrap: ' + (boot.status === 200 ? 'CLAIMED (admin setup is done)' : 'absent (first-run state)'));
  if (FROM) {
    const dump = JSON.parse(readFileSync(FROM, 'utf8'));
    const cmp = {};
    for (const coll of Object.keys(dump.collections)) {
      const want = Array.isArray(dump.collections[coll]) ? dump.collections[coll].length : 'skipped';
      cmp[coll] = { backup: want, now: counts[coll], match: want === counts[coll] };
    }
    log('compare  : ' + JSON.stringify(cmp));
  }
}

const RUN = {
  list: cmdList, backup: cmdBackup, wipe: cmdWipe, restore: cmdRestore,
  verify: cmdVerify, 'seed-admin': cmdSeedAdmin,
};
try {
  await RUN[MODE]();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
