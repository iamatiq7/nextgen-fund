/* NextGen Fund - proof that the action-history view really filters, searches and paginates.
 *
 * Loads the REAL assets/js/admin-history.js together with the REAL assets/js/ngf-audit.js (the
 * same module the console and the adapter use) into a small stand-in DOM, then drives the
 * rendered controls the way a person would: type in the search box and submit, pick an admin,
 * pick a type, set a date range, press next / previous, change the page size, press reset.
 *
 * The store stub is faithful to the adapter: listAuditPage = normalizeAll -> filter -> paginate
 * + facets. So the view is checked against production behaviour, not against a mock that could
 * simply agree with a broken view.
 *
 * Run: node ops/admin-ops-e2e/ui-check.mjs      (exit 0 = every check passed)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const LIVE = process.env.UI_LIVE ? (process.env.UI_LIVE === '1' ? 'https://nextgenfund.web.app' : process.env.UI_LIVE) : '';
const memo = new Map();
async function getFile(p) {
  if (memo.has(p)) return memo.get(p);
  let src;
  if (LIVE) {
    const res = await fetch(LIVE.replace(/\/+$/, '') + '/' + p);
    if (!res.ok) throw new Error('could not fetch ' + p + ' from ' + LIVE + ' (' + res.status + ')');
    src = await res.text();
  } else {
    src = fs.readFileSync(path.join(repo, p), 'utf8');
  }
  memo.set(p, src);
  return src;
}
const AUDIT_JS = 'assets/js/ngf-audit.js';
const RETENTION_JS = 'assets/js/ngf-retention.js';
const VIEW_JS = 'assets/js/admin-history.js';

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail === undefined ? '' : '   [' + detail + ']')); }
  else { failures.push(name + (detail === undefined ? '' : '  [' + detail + ']')); console.log('  FAIL  ' + name + (detail === undefined ? '' : '   [' + detail + ']')); }
}
function phase(t) { console.log('\n== ' + t + ' =='); }

/* --------------------------------------------------------------- a very small stand-in DOM */
function attr(attrs, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
  return m ? m[1] : null;
}
function tagFor(html, id) {
  const m = new RegExp('<([a-zA-Z]+)([^>]*\\bid\\s*=\\s*"' + id + '"[^>]*)>').exec(html || '');
  return m ? { tag: m[1].toLowerCase(), attrs: m[2] } : null;
}
function valueFor(html, id) {
  const t = tagFor(html, id);
  if (!t) return '';
  if (t.tag === 'select') {
    const start = new RegExp('<select[^>]*\\bid\\s*=\\s*"' + id + '"[^>]*>').exec(html);
    if (!start) return '';
    const rest = html.slice(start.index + start[0].length);
    const end = rest.search(/<\/select>/i);
    const inner = end === -1 ? rest : rest.slice(0, end);
    const sel = /<option([^>]*\bselected[^>]*)>/.exec(inner);
    if (sel) return attr(sel[1], 'value') || '';
    const first = /<option([^>]*)>/.exec(inner);
    return first ? (attr(first[1], 'value') || '') : '';
  }
  if (t.tag === 'textarea') {
    const start = new RegExp('<textarea[^>]*\\bid\\s*=\\s*"' + id + '"[^>]*>').exec(html);
    if (!start) return '';
    const rest = html.slice(start.index + start[0].length);
    const end = rest.search(/<\/textarea>/i);
    return end === -1 ? '' : rest.slice(0, end);
  }
  return attr(t.attrs, 'value') || '';
}

let lastHtml = '';        /* whatever the detail container rendered last */
let tabHtml = '';         /* whatever the tab body was set to last */
let wrapHtml = '';        /* whatever the detail container itself was set to last */
let cache = {};
const invalidate = () => { cache = {}; };
/* controls live inside the detail container, the container itself inside the tab body */
const focusHtml = () => wrapHtml || tabHtml;
const findTag = (id) => tagFor(wrapHtml, id) || tagFor(tabHtml, id);

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    __attrs: {}, __handlers: {}, __kids: [], textContent: '', value: '', html: '',
    setAttribute(k, v) { this.__attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.__attrs, k) ? this.__attrs[k] : null; },
    hasAttribute(k) { return this.getAttribute(k) !== null; },
    appendChild(c) { this.__kids.push(c); return c; },
    addEventListener(t, fn) { (this.__handlers[t] = this.__handlers[t] || []).push(fn); },
    removeEventListener() { },
    click() { this.fire('click'); },
    closest() { return this; },
    querySelector(sel) {
      const m = /^\[data-tab="([^"]+)"\]$/.exec(sel);
      if (m) return this.__kids.find((k) => k.getAttribute('data-tab') === m[1]) || null;
      return null;
    },
    fire(type, ev) {
      const e = ev || { preventDefault() { }, stopPropagation() { }, target: el };
      (this.__handlers[type] || []).forEach((fn) => fn.call(el, e));
      return e;
    },
    set innerHTML(v) { this.html = String(v); lastHtml = this.html; wrapHtml = this.html; invalidate(); },
    get innerHTML() { return this.html; },
  };
  return el;
}

const staticEls = { 'admin-tabs': makeEl('div'), 'tab-body': makeEl('div') };
Object.defineProperty(staticEls['tab-body'], 'innerHTML', {
  set(v) { this.html = String(v); tabHtml = this.html; lastHtml = this.html; wrapHtml = ''; cache = {}; },
  get() { return this.html; },
});

const document = {
  readyState: 'complete',
  __render: '',
  getElementById(id) {
    if (staticEls[id]) return staticEls[id];
    if (cache[id]) return cache[id];
    const t = findTag(id);
    if (!t) return null;
    const el = makeEl(t.tag);
    const attrs = t.attrs.match(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g) || [];
    attrs.forEach((s) => { const i = s.indexOf('='); el.__attrs[s.slice(0, i)] = s.slice(i + 1).replace(/^"|"$/g, ''); });
    el.value = valueFor(wrapHtml || tabHtml, id);
    cache[id] = el;
    return el;
  },
  querySelectorAll(sel) {
    return /^#admin-tabs \[data-tab\]$/.test(sel) ? staticEls['admin-tabs'].__kids : [];
  },
  createElement(tag) { return makeEl(tag); },
  addEventListener() { },
  body: staticEls['tab-body'],
};

const location = { hash: '#history' };
const history = { replaceState() { } };
const win = { document, location, history, setTimeout, clearTimeout, console, Date, JSON, Math, Object, Array, String, Number, RegExp, isNaN, parseInt, parseFloat };
win.window = win;
const ctx = vm.createContext(win);
ctx.globalThis = win;

/* --------------------------------------------------------------- the real modules */
const [auditSrc, retentionSrc, viewSrc] = [await getFile(AUDIT_JS), await getFile(RETENTION_JS), await getFile(VIEW_JS)];
console.log('source: ' + (LIVE ? 'the live deployment ' + LIVE : 'the checkout at ' + repo));
vm.runInContext(auditSrc, ctx, { filename: 'ngf-audit.js' });
vm.runInContext(retentionSrc, ctx, { filename: 'ngf-retention.js' });
const A = win.NGFAudit;
const R = win.NGFRetention;
check('the real audit module loaded in the page context', !!A && typeof A.filter === 'function' && typeof A.paginate === 'function');
check('the real retention module loaded in the page context', !!R && typeof R.normalizePolicy === 'function');

/* --------------------------------------------------------------- deterministic audit rows */
const DAY = 86400000;
const base = Date.parse('2026-09-21T00:00:00.000Z') - 90 * DAY;
const actions = ['member.create', 'member.update', 'member.delete', 'account.approve', 'account.reject', 'email.change', 'auth.login', 'ui.denied'];
const actors = ['atiq', 'rafi', 'nusrat'];
const ROWS = [];
for (let i = 0; i < 60; i++) {
  const changes = i % 2 === 0
    ? [{ field: 'status', from: 'pending', to: 'active' }, { field: 'email', from: 'old' + i + '@x.com', to: 'new' + i + '@x.com' }]
    : [{ field: 'status', from: 'pending', to: 'active' }, { field: 'plan', from: 'basic', to: 'vip' }];
  ROWS.push({
    id: 'a' + String(i).padStart(3, '0'),
    actor: actors[i % 3],
    action: actions[i % 8],
    objectType: i % 2 ? 'user' : 'accountRequest',
    objectId: 'rec-' + i,
    at: new Date(base + i * DAY).toISOString(),
    changes,
    detail: JSON.stringify({ changes }),
  });
}
ROWS.push({
  id: 'a900', actor: 'atiq', action: 'email.change', objectType: 'user', objectId: 'rec-900',
  at: '2026-09-20T10:00:00.000Z', changes: [{ field: 'plan', from: 'basic', to: 'vip' }],
  detail: JSON.stringify({ changes: [{ field: 'plan', from: 'basic', to: 'vip' }] }),
});

const calls = [];
win.NGFStore = {
  getSession: async () => ({ role: 'admin', username: 'atiq' }),
  logDeniedView: async () => ({ ok: false, denied: true }),
  async listAuditPage(opts) {
    calls.push(JSON.parse(JSON.stringify(opts)));
    const all = A.normalizeAll(ROWS);
    const filtered = A.filter(all, opts);
    const page = A.paginate(filtered, opts.page || 1, opts.size || 25);
    return Object.assign({}, page, { facets: A.facets(all) });
  },
  loadJobRuns: async () => ({ runs: [], control: {} }),
  loadRetentionPolicy: async () => ({}),
  retainedAddressLedger: async () => [],
};
win.NGFUtil = { esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) };
win.NGFLANG = { t: (s) => s };

/* keep the submit handler the view attaches to its own form, so the test can press "Filter" */
let capturedHandler = null;
const baseGet = document.getElementById.bind(document);
document.getElementById = (id) => {
  if (id !== 'ah-filters') return baseGet(id);
  const el = makeEl('form');
  el.addEventListener = function (t, fn) {
    if (t === 'submit') capturedHandler = fn;
    (this.__handlers[t] = this.__handlers[t] || []).push(fn);
  };
  return el;
};

vm.runInContext(viewSrc, ctx, { filename: 'admin-history.js' });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

const rowsOf = () => { const t = /<tbody>([\s\S]*?)<\/tbody>/.exec(focusHtml()); return t ? (t[1].match(/<tr>/g) || []).length : 0; };
const shownTotal = () => { const m = /মোট (\d+) রেকর্ড/.exec(focusHtml()); return m ? Number(m[1]) : -1; };
const pagerText = () => (/মোট [\d,]+ রেকর্ড[^<]*/.exec(focusHtml()) || [''])[0];
const bodyHtml = () => focusHtml();
const control = (id) => document.getElementById(id);

/* fill the five controls, press "Filter", and settle like a person would */
async function applyFilters(over) {
  const vals = { 'ah-q': '', 'ah-actor': '', 'ah-group': '', 'ah-from': '', 'ah-to': '', ...(over || {}) };
  const realGet = document.getElementById;
  document.getElementById = (id) => {
    if (id in vals) { const el = makeEl('input'); el.value = vals[id]; return el; }
    return realGet(id);
  };
  capturedHandler.call(makeEl('form'), { preventDefault() { }, stopPropagation() { }, target: makeEl('form') });
  document.getElementById = realGet;
  await flush();
  if (process.env.UI_DEBUG) console.log('   debug: handler=' + !!capturedHandler + ' ids=' + seen.join(',') + ' last=' + JSON.stringify(calls[calls.length - 1]));
  return calls[calls.length - 1];
}
async function press(id) { const el = control(id); if (process.env.UI_DEBUG) console.log('   debug press ' + id + ': el=' + !!el + ' handlers=' + (el ? (el.__handlers.click || []).length : -1)); el.fire('click'); await flush(); }
async function chooseSize(n) { const el = control('ah-size'); el.value = String(n); el.fire('change'); await flush(); }

await flush();

phase('the history tab renders through the real module');
check('the three console tabs were appended (history, retention, jobs)', staticEls['admin-tabs'].__kids.length === 3, staticEls['admin-tabs'].__kids.map((k) => k.getAttribute('data-tab')).join(','));
check('page one was requested at the default size', calls.length > 0 && calls[0].page === 1 && calls[0].size === 25, JSON.stringify(calls[0]));
check('the table drew a full first page of 25 rows', rowsOf() === 25, rowsOf() + ' rows');
check('the pager reports the real total, range and page count', shownTotal() === 61 && /দেখানো হচ্ছে 1–25/.test(pagerText()) && /পৃষ্ঠা 1\/3/.test(pagerText()), pagerText());
check('the search box, admin filter, type filter and both date boxes are present', ['ah-q', 'ah-actor', 'ah-group', 'ah-from', 'ah-to'].every((id) => !!tagFor(bodyHtml(), id)));
check('the page-size selector offers 10 / 25 / 50 / 100', [10, 25, 50, 100].every((n) => new RegExp('<option value="' + n + '"').test(bodyHtml())));
check('previous is disabled on the first page', /id="ah-prev"[^>]*aria-disabled="true"/.test(bodyHtml()));
const facetOpts = (bodyHtml().match(/<option value="[^"]+"/g) || []).length;
check('the admin and type filters are populated from the real facets', /<option value="rafi"/.test(bodyHtml()) && /<option value="member"/.test(bodyHtml()) && facetOpts >= 5, facetOpts + ' options');

phase('search');
const s1 = await applyFilters({ 'ah-q': 'email' });
const byEmail = A.filter(A.normalizeAll(ROWS), { q: 'email' }).length;
check('typing "email" queries the store with that term and returns to page one', s1.q === 'email' && s1.page === 1, JSON.stringify(s1));
check('the rows shown after the search are the ones the module matches', shownTotal() === byEmail && rowsOf() === Math.min(25, byEmail) && byEmail < 61, 'matched ' + byEmail + ', drew ' + rowsOf() + ', pager ' + shownTotal());
const s2 = await applyFilters({ 'ah-q': '  EMAIL  ' });
check('search is case-insensitive and trims stray spaces', s2.q === 'EMAIL' && shownTotal() === byEmail, pagerText());
const s3 = await applyFilters({ 'ah-q': 'নেই-এমন-কিছু' });
check('a search with no matches shows the empty state and draws no rows', rowsOf() === 0 && /কোনো রেকর্ড নেই/.test(bodyHtml()), rowsOf() + ' rows');
const s4 = await applyFilters({ 'ah-q': 'rec-7' });
check('search reaches the record id too', /rec-7/.test(bodyHtml()) && shownTotal() === 1, shownTotal() + ' record');

phase('filters');
const f1 = await applyFilters({ 'ah-actor': 'rafi' });
const byActor = A.filter(A.normalizeAll(ROWS), { actor: 'rafi' }).length;
check('the admin filter narrows to that admin only', f1.actor === 'rafi' && shownTotal() === byActor && byActor < 61, byActor + ' records, ' + pagerText());
const f2 = await applyFilters({ 'ah-group': 'account' });
const byGroup = A.filter(A.normalizeAll(ROWS), { group: 'account' }).length;
check('the type filter narrows to that group only', f2.group === 'account' && shownTotal() === byGroup && byGroup < 61, byGroup + ' records, ' + pagerText());
const f3 = await applyFilters({ 'ah-from': '2026-08-01', 'ah-to': '2026-08-31' });
const byRange = A.filter(A.normalizeAll(ROWS), { from: '2026-08-01', to: '2026-08-31' }).length;
check('the date range keeps only records inside it', f3.from === '2026-08-01' && f3.to === '2026-08-31' && shownTotal() === byRange && byRange > 0, byRange + ' records, ' + pagerText());
const f4 = await applyFilters({ 'ah-actor': 'nusrat', 'ah-group': 'member', 'ah-from': '2026-08-01', 'ah-to': '2026-09-30' });
const byAll = A.filter(A.normalizeAll(ROWS), { actor: 'nusrat', group: 'member', from: '2026-08-01', to: '2026-09-30' }).length;
check('admin + type + range combine as an intersection', shownTotal() === byAll && byAll > 0 && byAll < byActor, byAll + ' records, ' + pagerText());

phase('pagination');
await applyFilters({});
check('clearing the filters brings the full set back', shownTotal() === 61 && /পৃষ্ঠা 1\/3/.test(pagerText()), pagerText());
await press('ah-next');
check('"next" moves to page two and the range line follows', /পৃষ্ঠা 2\/3/.test(pagerText()) && /26–50/.test(pagerText()) && rowsOf() === 25, pagerText());
check('"previous" is usable on page two', !/id="ah-prev"[^>]*aria-disabled/.test(bodyHtml()));
await press('ah-next');
check('page three holds the last partial page (11 rows)', /পৃষ্ঠা 3\/3/.test(pagerText()) && rowsOf() === 11, rowsOf() + ' rows, ' + pagerText());
check('"next" is disabled on the last page', /id="ah-next"[^>]*aria-disabled="true"/.test(bodyHtml()));
await press('ah-prev');
check('"previous" walks back to page two', /পৃষ্ঠা 2\/3/.test(pagerText()), pagerText());
await chooseSize(10);
check('changing the page size returns to page one and redraws 10 rows', calls[calls.length - 1].size === 10 && calls[calls.length - 1].page === 1 && rowsOf() === 10, JSON.stringify(calls[calls.length - 1]));
check('the page count grows with the smaller page size', /পৃষ্ঠা 1\/7/.test(pagerText()), pagerText());
await press('ah-prev');
check('"previous" on page one does nothing (stays on page one)', /পৃষ্ঠা 1\/7/.test(pagerText()), pagerText());
await press('ah-next');
check('paging still works at the new page size', /পৃষ্ঠা 2\/7/.test(pagerText()) && rowsOf() === 10, pagerText());

phase('reset, privacy and the record itself');
await applyFilters({ 'ah-q': 'email', 'ah-actor': 'atiq' });
await press('ah-reset');
const lastCall = calls[calls.length - 1];
check('reset clears every filter and returns to the full first page', lastCall.q === '' && lastCall.actor === '' && lastCall.group === '' && lastCall.from === '' && lastCall.to === '' && lastCall.page === 1 && shownTotal() === 61, JSON.stringify(lastCall));
check('the old and new values are shown as a masked pair', /→/.test(bodyHtml()) && /\*\*\*/.test(bodyHtml()));
check('the raw address never reaches the page', !/old\d+@x\.com/.test(bodyHtml()) && !/new\d+@x\.com/.test(bodyHtml()));
check('who / when / what / which record are all column headers', ['কে', 'কী', 'কখন', 'রেকর্ড'].every((h) => bodyHtml().includes(h)));
check('the header states the audit trail cannot be edited from the app', /বদলানো সম্ভব নয়/.test(tabHtml));

console.log('\n===============================');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('  the action-history view filters, searches and paginates as specified');
console.log('===============================');
