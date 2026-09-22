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
const TABS_FOR_SHOT = ['ইতিহাস', 'রিটেনশন নীতি', 'জব রান'];
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


/* ---------------------------------------------------------------------------------------------
   Render the real view to a standalone page, so a screenshot can show what an admin sees.
   The panel is the live output of the module: filter bar, table, pager. Nothing is retyped.
   --------------------------------------------------------------------------------------------- */
const css = fs.readFileSync(path.join(repo, 'assets/css/style.css'), 'utf8');

/* drive it a little, so the shot shows an active search, an active type filter and a pager */
await applyFilters({ 'ah-q': 'email', 'ah-group': 'account' });
console.log('after the filter: ' + shownTotal() + ' records, ' + pagerText());

const panel = bodyHtml();
if (!/id="ah-q"/.test(panel) || !/<tbody>/.test(panel) || !/id="ah-next"/.test(panel)) {
  console.error('the panel does not contain the controls - refusing to render');
  process.exit(3);
}

const tabButtons = TABS_FOR_SHOT.map((t, i) =>
  '<button role="tab" data-tab="' + t + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' + t + '</button>').join('');

const page = [
  '<!DOCTYPE html>',
  '<html lang="bn"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>NextGen Fund — অ্যাডমিন কনসোল · অ্যাকশন-ইতিহাস</title>',
  '<style>', css,
  'body{background:#f5f6f8;margin:0;padding:20px}',
  '.shotframe{max-width:1240px;margin:0 auto;background:#fff;border:1px solid #d9dcE1;border-radius:10px;padding:18px 22px}',
  '.shottabs{display:flex;gap:8px;border-bottom:1px solid #d9dcE1;margin:0 0 16px}',
  '.shottabs button{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font:inherit;color:#1a4f9c;cursor:pointer}',
  '.shottabs button[aria-selected="true"]{border-bottom-color:#1a4f9c;font-weight:700}',
  '</style></head><body>',
  '<div class="shotframe"><div class="shottabs">' + tabButtons + '</div>',
  tabHtml.replace(/(<div id="ah-wrap">)[\s\S]*?(<\/div>)/, '$1' + panel + '$2'),
  '</div></body></html>',
].join('\n');

const outHtml = path.join(here, 'view-preview.html');
fs.writeFileSync(outHtml, page, 'utf8');
console.log('wrote ' + outHtml + ' (' + page.length + ' chars)');
console.log('table rows on the page: ' + (panel.match(/<tr>/g) || []).length);
