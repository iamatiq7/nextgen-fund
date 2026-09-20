/* NextGen Fund — audit-history helpers.
   Pure functions only (no DOM, no network): the admin history view renders with them and the
   automated checks exercise the very same code in Node.

   Design note (preset 03 · Information Architects): the view is built around typographic
   hierarchy and dense, scannable tables — the helpers return compact, structured rows so the
   renderer can stay purely presentational. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.NGFAudit = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ---------- small helpers ---------- */
  function ts(v) { var t = Date.parse(String(v || '')); return isNaN(t) ? 0 : t; }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function maskEmail(v) {
    var s = String(v || '').trim();
    var at = s.indexOf('@');
    if (at < 1) { return s ? s.slice(0, 3) + '***' : ''; }
    return s.slice(0, Math.min(2, at)) + '***@' + s.slice(at + 1, at + 2) + '***';
  }
  function isEmailLike(v) { return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v || '').trim()); }

  /* action classification: drives the filters and the row labels */
  var GROUPS = [
    { id: 'account', label: 'অ্যাকাউন্ট / ইমেইল', re: /email|account|username|reconcile/i },
    { id: 'member', label: 'সদস্য', re: /member|user|registration|profile|share|nominee/i },
    { id: 'payment', label: 'পেমেন্ট', re: /payment|finance|due|deposit/i },
    { id: 'settings', label: 'সেটিংস', re: /settings|retention|policy|config/i },
    { id: 'auth', label: 'লগইন / নিরাপত্তা', re: /login|auth|password|session|denied|forbidden/i },
    { id: 'job', label: 'সময়ভিত্তিক জব', re: /job|schedule|cron|batch|dead-?letter/i },
    { id: 'db', label: 'ডেটাবেজ', re: /db|reset|wipe|backup|migration/i }
  ];
  function groupOf(action) {
    var a = String(action || '');
    for (var i = 0; i < GROUPS.length; i++) { if (GROUPS[i].re.test(a)) return GROUPS[i].id; }
    return 'other';
  }
  function groupLabel(id) {
    for (var i = 0; i < GROUPS.length; i++) { if (GROUPS[i].id === id) return GROUPS[i].label; }
    return 'অন্যান্য';
  }
  function groups() { return GROUPS.map(function (g) { return { id: g.id, label: g.label }; }); }

  /* legacy rows keep "a -> b" or JSON inside detail: pull a before/after pair out of it */
  function parseDetail(detail) {
    var d = String(detail || '').trim(), before = '', after = '';
    if (!d) { return { before: before, after: after }; }
    var m = d.match(/^(.+?)\s*(?:->|→|=>)\s*(.+?)(?:\s*\|.*)?$/);
    if (m) { before = m[1].trim(); after = m[2].trim(); }
    try {
      var o = JSON.parse(d);
      if (o && typeof o === 'object') {
        if (o.before !== undefined || o.after !== undefined) {
          before = o.before === undefined ? before : String(o.before);
          after = o.after === undefined ? after : String(o.after);
        } else if (Array.isArray(o.changes) && o.changes.length) {
          before = o.changes.map(function (c) { return c.field + ': ' + c.from; }).join(' · ');
          after = o.changes.map(function (c) { return c.field + ': ' + c.to; }).join(' · ');
        }
      }
    } catch (e) { /* detail is free text: the arrow form above is all we can use */ }
    return { before: before, after: after };
  }

  /* every audit row becomes one comparable shape, whatever its vintage */
  function normalize(row) {
    row = row && typeof row === 'object' ? row : {};
    var action = String(row.action || '').trim();
    var detail = String(row.detail || '');
    var pair = parseDetail(detail);
    var changes = Array.isArray(row.changes) ? row.changes.filter(Boolean).map(function (c) {
      return { field: String(c.field || ''), from: String(c.from == null ? '' : c.from), to: String(c.to == null ? '' : c.to) };
    }) : [];
    var at = String(row.at || row.createdAt || row.decidedAt || '');
    var out = {
      id: String(row.id || ''),
      at: at,
      time: ts(at),
      actor: String(row.actor || row.decidedBy || row.by || '').trim() || '(সিস্টেম)',
      action: action,
      group: groupOf(action),
      groupLabel: groupLabel(groupOf(action)),
      objectType: String(row.objectType || ''),
      object: String(row.objectId || row.memberId || row.uid || ''),
      changes: changes,
      before: row.before !== undefined ? String(row.before) : pair.before,
      after: row.after !== undefined ? String(row.after) : pair.after,
      text: detail,
      emailLike: isEmailLike(pair.to) || isEmailLike(pair.from)
    };
    if (!out.objectType) {
      if (/email/.test(action)) { out.objectType = 'email'; } else if (/status|approve|reject|registration/.test(action)) { out.objectType = 'status'; }
      else if (/payment/.test(action)) { out.objectType = 'payment'; } else if (/settings|policy/.test(action)) { out.objectType = 'settings'; }
      else { out.objectType = 'record'; }
    }
    return out;
  }

  function normalizeAll(rows) {
    return (rows || []).map(normalize).sort(function (a, b) { return b.time - a.time; });
  }

  /* ---------- search + filters + pagination ---------- */
  function haystack(e) {
    return [e.actor, e.action, e.groupLabel, e.object, e.before, e.after, e.text,
      e.changes.map(function (c) { return c.field + ' ' + c.from + ' ' + c.to; }).join(' ')].join(' ').toLowerCase();
  }

  function filter(rows, q) {
    q = q || {};
    var from = q.from ? Date.parse(q.from) : null;
    var to = q.to ? Date.parse(q.to) : null;
    if (to !== null && String(q.to).length <= 10) { to += 24 * 3600 * 1000 - 1; }   /* a plain date means the whole day */
    var actor = lc(q.actor), group = lc(q.group), otype = lc(q.objectType), needle = lc(q.q), object = lc(q.object);
    return (rows || []).filter(function (e) {
      if (from !== null && e.time < from) { return false; }
      if (to !== null && e.time > to) { return false; }
      if (actor && lc(e.actor) !== actor) { return false; }
      if (group && e.group !== group) { return false; }
      if (otype && lc(e.objectType) !== otype) { return false; }
      if (object && lc(e.object).indexOf(object) < 0) { return false; }
      if (needle && haystack(e).indexOf(needle) < 0) { return false; }
      return true;
    });
  }

  function facets(rows) {
    var actors = {}, actions = {}, types = {};
    (rows || []).forEach(function (e) {
      actors[e.actor] = (actors[e.actor] || 0) + 1;
      actions[e.group] = (actions[e.group] || 0) + 1;
      types[e.objectType] = (types[e.objectType] || 0) + 1;
    });
    var asList = function (o) { return Object.keys(o).sort().map(function (k) { return { value: k, count: o[k] }; }); };
    return {
      actors: asList(actors), actions: asList(actions), objectTypes: asList(types),
      groups: groups().map(function (g) { return { id: g.id, label: g.label, count: actions[g.id] || 0 }; })
    };
  }

  function paginate(rows, page, size) {
    rows = rows || [];
    size = Math.max(1, parseInt(size, 10) || 25);
    var pages = Math.max(1, Math.ceil(rows.length / size));
    var p = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
    var start = (p - 1) * size;
    return {
      rows: rows.slice(start, start + size), page: p, size: size, pages: pages, total: rows.length,
      fromIndex: rows.length ? start + 1 : 0, toIndex: Math.min(start + size, rows.length),
      hasPrev: p > 1, hasNext: p < pages
    };
  }

  /* ---------- presentation helpers ---------- */
  function formatWhen(iso, tz) {
    var t = ts(iso);
    if (!t) { return String(iso || ''); }
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Dhaka', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
    } catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }
  }

  function beforeAfter(e) {
    e = e && e.changes && e.changes.length ? e : normalize(e || {});
    if (e.changes.length) {
      return e.changes.map(function (c) { return { field: c.field, from: maskEmail(c.from), to: maskEmail(c.to) }; });
    }
    return [{ field: e.objectType || 'value', from: maskEmail(e.before), to: maskEmail(e.after) }];
  }

  function summaryLine(e) {
    var parts = beforeAfter(e).filter(function (c) { return c.from || c.to; });
    if (!parts.length) { return e.text || '—'; }
    return parts.map(function (c) { return c.field + ': ' + (c.from || '—') + ' → ' + (c.to || '—'); }).join(' · ');
  }

  function csv(rows, tz) {
    var head = ['when', 'actor', 'action', 'group', 'object', 'objectType', 'before', 'after', 'detail'];
    var lines = [head.join(',')];
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    (rows || []).forEach(function (r) {
      var e = normalize(r);
      var pair = beforeAfter(e)[0] || { from: '', to: '' };
      lines.push([formatWhen(e.at, tz), e.actor, e.action, e.groupLabel, e.object, e.objectType, pair.from, pair.to, e.text].map(esc).join(','));
    });
    return lines.join('\n') + '\n';
  }

  return {
    maskEmail: maskEmail, parseDetail: parseDetail, normalize: normalize, normalizeAll: normalizeAll,
    filter: filter, facets: facets, paginate: paginate, formatWhen: formatWhen,
    beforeAfter: beforeAfter, summaryLine: summaryLine, csv: csv,
    groupOf: groupOf, groupLabel: groupLabel, groups: groups, ts: ts
  };
});
