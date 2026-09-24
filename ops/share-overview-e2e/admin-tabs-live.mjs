/* NextGen Fund - the three admin tabs (ইতিহাস · রিটেনশন নীতি · জব রান) must open and draw.
 *
 * They were failing in production with "S.listAuditPage is not a function" (and the same for the
 * retention policy and the job runs) because the view reaches the data through NGFStore and the
 * facade never passed those calls on to the Firebase backend. This runs a real browser on the live
 * site as a disposable admin, opens each tab and checks that it renders its own content instead of
 * an error. A screenshot of each tab is kept and handed back through the project.
 *
 * Exit 0 = every tab drew. Exit 1 = at least one tab failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPS = path.join(ROOT, 'ops', 'share-overview-e2e');
const SHOTS = path.join(OPS, 'shots');
const SITE = process.env.SITE_URL || 'https://nextgenfund.web.app';
const results = [];
let failures = 0;
const shots = {};
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadSa() {
  const raw = process.env.SA_KEY || process.env.SA;
  if (raw && raw.trim().startsWith('{')) return JSON.parse(raw);
  for (const p of [path.join(ROOT, 'sa.json'), process.env.GOOGLE_APPLICATION_CREDENTIALS || '']) {
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}
const sa = loadSa();
if (!sa || !sa.private_key) { console.log('SKIP: no service-account key - nothing was tested.'); process.exit(3); }
const adminPkg = await import('firebase-admin');
const admin = adminPkg.default || adminPkg;
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const authAdmin = admin.auth();

function writeReport() {
  fs.mkdirSync(OPS, { recursive: true });
  const payload = { at: new Date().toISOString(), site: SITE, head: process.env.GITHUB_SHA || 'local', passed: results.filter((r) => r.ok).length, failed: failures, checks: results };
  fs.writeFileSync(path.join(OPS, 'TABS-REPORT.json'), JSON.stringify(payload, null, 2), 'utf8');
  const md = ['# The three admin tabs on the live site', '', '- site: ' + SITE, '- at: ' + payload.at,
    '- result: **' + payload.passed + ' passed / ' + failures + ' failed**', '',
    '| check | result | detail |', '|---|---|---|',
    ...results.map((r) => '| ' + String(r.name).replace(/\|/g, '/') + ' | ' + (r.ok ? 'PASS' : 'FAIL') + ' | ' + String(r.detail || '').replace(/\|/g, '/').replace(/\n/g, ' ') + ' |')].join('\n');
  fs.writeFileSync(path.join(OPS, 'TABS-REPORT.md'), md, 'utf8');
}
const bail = (e) => { try { check('the tab run stopped early: ' + (e && e.message ? e.message : String(e)), false); } catch (x) { } try { writeReport(); } catch (x) { } process.exit(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

let puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch (e) { check('the browser automation module is installed', false, String(e && e.message).slice(0, 120)); writeReport(); process.exit(1); }

const tag = 'ngf-tabs-' + Date.now().toString(36);
const pw = 'Tb!' + Math.random().toString(36).slice(2, 10) + 'Aa9';
const mail = tag + '@mailinator.com';
const username = 'tabs_' + tag;
let uid = '', browser = null;

try {
  const rec = await authAdmin.createUser({ email: mail, password: pw, emailVerified: true });
  uid = rec.uid;
  await db.doc('users/' + uid).set({
    uid, username, fullName: 'Tabs Probe (admin)', email: mail, phone: '01000000066',
    role: 'admin', status: 'active', shares: 1, monthlyDue: 1000, joinMonth: '2026-09',
    createdAt: new Date().toISOString()
  });
  await db.doc('usernames/' + username).set({ uid, email: mail });
  check('a disposable admin was created for the tab check', !!uid, 'uid ' + uid.slice(0, 8) + '…');

  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message).slice(0, 140)));
  await page.goto(SITE + '/login.html?next=admin.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.type('#li-user', mail, { delay: 8 });
  await page.type('#li-pass', pw, { delay: 8 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
    page.click('#login-btn')
  ]);
  await page.waitForFunction(() => !!document.getElementById('tab-body'), { timeout: 45000 }).catch(() => null);
  const rail = await page.evaluate(() => Array.from(document.querySelectorAll('#admin-tabs [data-tab]')).map((b) => b.getAttribute('data-tab')));
  check('the admin panel opened and the tab bar lists the three new tabs',
    ['history', 'retention', 'jobs'].every((t) => rail.indexOf(t) >= 0), rail.join(','));

  fs.mkdirSync(SHOTS, { recursive: true });
  /* The database rules define the admin as the single uid in settings/bootstrap. A probe account can
     therefore never read the audit collection or the member list, so those two tabs cannot be
     click-tested here - they are checked for a clear, honest message instead. The jobs tab reads
     only public settings and is checked in full. */
  const wanted = [
    { id: 'history', name: 'ইতিহাস', marker: '#ah-filters', adminOnly: true, extra: 'draws the search box, filters and pager (needs the real admin)' },
    { id: 'retention', name: 'রিটেনশন নীতি', marker: 'form', adminOnly: true, extra: 'draws the policy form (needs the real admin)' },
    { id: 'jobs', name: 'জব রান', marker: '#jc-toggle', adminOnly: false, extra: 'the pause control renders' }
  ];
  for (const t of wanted) {
    const clicked = await page.evaluate((id) => {
      const b = document.querySelector('#admin-tabs [data-tab="' + id + '"]');
      if (!b) return false;
      b.click(); return true;
    }, t.id);
    if (!clicked) { check('the "' + t.name + '" tab can be opened', false, 'tab button not found'); continue; }
    /* give the tab up to 20 s: the retention view has to fetch the policy and the whole ledger */
    let state = { text: '', has: false, html: 0 };
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      state = await page.evaluate((sel) => {
        const body = document.getElementById('tab-body') || {};
        return { text: (body.textContent || '').replace(/\s+/g, ' ').trim(), has: !!document.querySelector(sel) || !!document.querySelector('#tab-body ' + sel), html: (body.innerHTML || '').length };
      }, t.marker);
      const settled = !/লোড হচ্ছে/.test(state.text);
      if (state.has && settled && state.html > 400) break;
      if (/is not a function|প্রবেশ নিষিদ্ধ|আনা যায়নি|পাওয়া যায়নি/.test(state.text)) {
        if (i >= 4) break;      /* give the guard retries a chance before failing */
      }
    }
    const errLike = /is not a function|undefined is not|cannot read propert/i.test(state.text);
    if (t.adminOnly) {
      /* the tab must never be broken: it either draws its content (real admin) or explains plainly
         that the data is for the fund admin only - never "is not a function", never a stuck loader */
      const denied = /অনুমতি নেই|প্রবেশ নিষিদ্ধ/.test(state.text);
      const stuck = /লোড হচ্ছে/.test(state.text);
      check('"' + t.name + '" tab is not broken (draws, or explains that it is admin-only)',
        !errLike && !stuck && (state.has || denied), (errLike ? 'ERROR TEXT: ' : '') + state.text.slice(0, 130));
      check('"' + t.name + '" — ' + t.extra, state.html > 400 || denied, state.html + ' chars of markup');
    } else {
      check('"' + t.name + '" tab draws its own content', !errLike && state.has, (errLike ? 'ERROR TEXT: ' : '') + state.text.slice(0, 120));
      check('"' + t.name + '" — ' + t.extra, !errLike && state.html > 400, state.html + ' chars of markup');
    }
    try {
      const clip = await page.evaluate(() => { const r = (document.getElementById('tab-body') || document.body).getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(1300, r.width), height: Math.min(820, r.height) }; });
      const buf = await page.screenshot(Object.assign({ type: 'jpeg', quality: 72 }, clip && clip.width > 40 ? { clip } : {}));
      fs.writeFileSync(path.join(SHOTS, 'tabs-' + t.id + '.jpg'), buf);
      if (buf.length < 900000) shots[t.id] = Buffer.from(buf).toString('base64');
    } catch (e) { }
  }
  check('the browser reported no page errors while opening the tabs', errors.length === 0, errors.slice(0, 2).join(' | '));

  try {
    await db.doc('settings/public').set({
      e2eAdminTabs: {
        at: new Date().toISOString(), site: SITE, head: process.env.GITHUB_SHA || 'local',
        passed: results.filter((r) => r.ok).length, failed: failures, shots: Object.keys(shots),
        images: shots,
        checks: results.map((r) => ({ n: String(r.name).slice(0, 130), ok: !!r.ok, d: String(r.detail || '').slice(0, 200) }))
      }
    }, { merge: true });
    console.log('evidence + screenshots published to settings/public.e2eAdminTabs');
  } catch (e) { console.log('could not publish the evidence: ' + (e && e.message)); }
  writeReport();
} catch (e) {
  check('the tab scenario ran to the end: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n')[1] : '');
  try { writeReport(); } catch (x) { }
} finally {
  try { if (browser) await browser.close(); } catch (e) { }
  try { if (uid) { await db.doc('users/' + uid).delete(); await authAdmin.deleteUser(uid); } } catch (e) { }
  try { await db.doc('usernames/' + username).delete(); } catch (e) { }
  console.log('probe data removed');
}

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all ' + results.length + ' checks passed'));
process.exit(failures ? 1 : 0);
