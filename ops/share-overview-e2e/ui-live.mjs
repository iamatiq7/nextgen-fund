/* NextGen Fund - the same proof as run.mjs, but driven through a real browser on the live site.
 *
 * A disposable probe member is created, a headless Chrome signs in on https://nextgenfund.web.app
 * and sits on "My Fund", the approval-shaped write lands on users/{uid} through the service
 * account, and the page is then watched WITHOUT any reload until the share count on screen
 * changes. A marker is planted on window before the write: if the page had reloaded, the marker
 * would be gone - that is how "no reload" is proven rather than claimed.
 *
 * Exit 0 = the screen changed by itself. Exit 1 = it did not (or another check failed).
 * Screenshots (before/after) are kept for the CI artifact.
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
const timeline = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  | ' + detail : ''));
}
const stamp = (what, extra) => { timeline.push({ what, at: new Date().toISOString(), ...(extra || {}) }); console.log('  timeline: ' + what); };
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

function writeReport(extra) {
  fs.mkdirSync(OPS, { recursive: true });
  const payload = Object.assign({ at: new Date().toISOString(), site: SITE, head: process.env.GITHUB_SHA || 'local', passed: results.filter((r) => r.ok).length, failed: failures, checks: results, timeline }, extra || {});
  fs.writeFileSync(path.join(OPS, 'UI-REPORT.json'), JSON.stringify(payload, null, 2), 'utf8');
  const md = ['# Share approval -> My Fund, in a real browser on the live site', '',
    '- site: ' + SITE, '- at: ' + payload.at, '- head: ' + payload.head,
    '- result: **' + payload.passed + ' passed / ' + failures + ' failed**', '',
    '- timeline: ' + timeline.map((t) => t.what + '@' + t.at.slice(11, 23)).join(' -> '), '',
    '| check | result | detail |', '|---|---|---|',
    ...results.map((r) => '| ' + String(r.name).replace(/\|/g, '/') + ' | ' + (r.ok ? 'PASS' : 'FAIL') + ' | ' + String(r.detail || '').replace(/\|/g, '/').replace(/\n/g, ' ') + ' |')].join('\n');
  fs.writeFileSync(path.join(OPS, 'UI-REPORT.md'), md, 'utf8');
}
async function publish(extra) {
  try {
    await db.doc('settings/public').set({
      e2eShareReportUi: Object.assign({
        at: new Date().toISOString(), site: SITE, head: process.env.GITHUB_SHA || 'local',
        passed: results.filter((r) => r.ok).length, failed: failures,
        timeline: timeline.map((t) => ({ what: String(t.what).slice(0, 90), at: t.at })),
        checks: results.map((r) => ({ n: String(r.name).slice(0, 130), ok: !!r.ok, d: String(r.detail || '').slice(0, 220) }))
      }, extra || {})
    }, { merge: true });
    console.log('evidence published to settings/public.e2eShareReportUi');
  } catch (e) { console.log('could not publish the evidence key: ' + (e && e.message)); }
}
const bail = (e) => { try { check('the browser run stopped early: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n')[1] : ''); } catch (x) { } try { writeReport(); } catch (x) { } process.exit(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

let puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch (e) { check('the browser automation module is installed', false, String(e && e.message).slice(0, 120)); writeReport(); process.exit(1); }

const tag = 'ngf-ui-' + Date.now().toString(36);
const pw = 'Ui!' + Math.random().toString(36).slice(2, 10) + 'Aa9';
const mail = tag + '@mailinator.com';
const username = 'ui_' + tag;
let uid = '', browser = null;

try {
  /* ---- 1. a disposable member ---- */
  const rec = await authAdmin.createUser({ email: mail, password: pw, emailVerified: true });
  uid = rec.uid;
  await db.doc('users/' + uid).set({
    uid, username, fullName: 'UI Probe', email: mail, phone: '01000000077', role: 'member',
    status: 'active', shares: 2, monthlyDue: 2000, joinMonth: '2026-09', createdAt: new Date().toISOString()
  });
  await db.doc('usernames/' + username).set({ uid, email: mail });
  check('a disposable member was created for the browser test', !!uid, 'uid ' + uid.slice(0, 8) + '…');

  /* ---- 2. a real browser signs in on the live site ---- */
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message).slice(0, 140)));
  await page.goto(SITE + '/login.html?next=portal.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  stamp('the live login page opened');
  await page.type('#li-user', mail, { delay: 8 });
  await page.type('#li-pass', pw, { delay: 8 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
    page.click('#login-btn')
  ]);
  await page.waitForFunction(() => {
    const el = document.getElementById('bal-shares');
    return el && el.textContent && el.textContent.trim().length > 0;
  }, { timeout: 45000 }).catch(() => null);
  stamp('the member signed in and the My Fund overview rendered');
  const before = await page.evaluate(() => ({
    shares: (document.getElementById('bal-shares') || {}).textContent || '',
    monthly: (document.getElementById('bal-monthly') || {}).textContent || '',
    url: location.href,
    ready: document.readyState
  }));
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'myfund-before.png') });
  const clipOf = async () => {
    const box = await page.evaluate(() => {
      const el = document.querySelector('section.grid.stats') || document.querySelector('#portal-content') || document.body;
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(1200, r.width + 16), height: Math.min(700, r.height + 16) };
    }).catch(() => null);
    return box && box.width > 40 && box.height > 30 ? box : null;
  };
  const shotBefore = async () => {
    const clip = await clipOf();
    return await page.screenshot(Object.assign({ type: 'jpeg', quality: 72 }, clip ? { clip } : {}));
  };
  const beforeShot = await shotBefore();
  check('the live My Fund page shows the old share count', /(^|\D)2(\D|$)/.test(before.shares), JSON.stringify(before).slice(0, 160));
  const marker = await page.evaluate(() => { window.__ngfMarker = 'kept-' + Date.now(); return window.__ngfMarker; });
  stamp('a page marker was planted (proves the page is never reloaded)');

  /* ---- 3. the approval-shaped write, exactly like the admin approval ---- */
  const hist = ((await db.doc('users/' + uid).get()).data().accountRequests || []).slice(0, 19);
  hist.unshift({ id: 'ui-e2e', fields: ['shares'], status: 'approved', decidedBy: 'e2e-admin', decidedAt: new Date().toISOString(), changes: [{ field: 'shares', from: '2', to: '9' }] });
  const writeAt = Date.now();
  await db.doc('users/' + uid).update({ shares: 9, accountRequests: hist, accountNotice: { kind: 'approved', at: new Date(writeAt).toISOString(), read: false, by: 'e2e-admin', text: 'Share increase approved.' } });
  stamp('the admin approval landed on users/{uid} (shares 2 -> 9)', { writeAt: new Date(writeAt).toISOString() });

  /* ---- 4. watch the SAME page, no reload, until the number changes ---- */
  let seen = null, after = null;
  for (let i = 0; i < 40 && !seen; i++) {
    await sleep(500);
    after = await page.evaluate(() => ({
      shares: (document.getElementById('bal-shares') || {}).textContent || '',
      monthly: (document.getElementById('bal-monthly') || {}).textContent || '',
      marker: window.__ngfMarker || '', url: location.href
    }));
    if (/(^|\D)9(\D|$)/.test(after.shares)) seen = { at: Date.now(), state: after };
  }
  await page.screenshot({ path: path.join(SHOTS, 'myfund-after.png') });
  let afterShot = null;
  try { afterShot = await shotBefore(); } catch (e) { }
  check('THE SCREEN CHANGED BY ITSELF: the open page now shows the new share count', !!seen,
    seen ? 'after ' + (seen.at - writeAt) + ' ms -> "' + seen.state.shares.trim().replace(/\s+/g, ' ') + '"' : 'still "' + String((after || {}).shares || '').trim().replace(/\s+/g, ' ') + '"');
  check('the page was never reloaded (the marker survived)', !!seen && seen.state.marker === marker,
    seen ? 'marker ' + seen.state.marker + ' == ' + marker : 'no change seen');
  const recNow = (await db.doc('users/' + uid).get()).data();
  check('the number on screen equals the stored value', !!seen && /(^|\D)9(\D|$)/.test(String(recNow.shares)), 'record shares ' + recNow.shares);
  check('the browser reported no page errors while updating', errors.length === 0, errors.slice(0, 2).join(' | '));
  /* hand the two pictures back through the project so they can be read without the CI artifact */
  let shotsStored = 'skipped';
  try {
    if (beforeShot && afterShot && beforeShot.length < 900000 && afterShot.length < 900000) {
      await db.doc('settings/public').set({
        e2eShareShots: {
          at: new Date().toISOString(), site: SITE, kind: 'jpeg',
          before: Buffer.from(beforeShot).toString('base64'),
          after: Buffer.from(afterShot).toString('base64'),
          beforeText: before.shares.trim().replace(/\s+/g, ' '),
          afterText: seen ? seen.state.shares.trim().replace(/\s+/g, ' ') : ''
        }
      }, { merge: true });
      shotsStored = beforeShot.length + '+' + afterShot.length + ' bytes';
      console.log('the two screenshots were published for reading: ' + shotsStored);
    } else { shotsStored = 'too large or missing'; }
  } catch (e) { shotsStored = 'failed: ' + (e && e.message); }
  check('the before/after screenshots were captured for the record', !!(beforeShot && afterShot), shotsStored);
  await publish({ ui: true, shots: shotsStored, before: before.shares.trim().replace(/\s+/g, ' '), afterSeen: seen ? seen.state.shares.trim().replace(/\s+/g, ' ') : '', eventAfterMs: seen ? seen.at - writeAt : null, markerKept: !!(seen && seen.state.marker === marker) });
  writeReport();
} catch (e) {
  check('the browser scenario ran to the end: ' + (e && e.message ? e.message : String(e)), false, e && e.stack ? String(e.stack).split('\n')[1] : '');
  try { writeReport(); } catch (x) { }
} finally {
  try { if (browser) await browser.close(); } catch (e) { }
  try { if (uid) { await db.doc('users/' + uid).delete(); await authAdmin.deleteUser(uid); } } catch (e) { }
  try { await db.doc('usernames/' + username).delete(); } catch (e) { }
  console.log('probe data removed');
}

console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all ' + results.length + ' checks passed'));
process.exit(failures ? 1 : 0);
