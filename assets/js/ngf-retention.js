/* NextGen Fund — retention policy for replaced (old) login addresses.
   Pure functions only: the admin policy screen, the scheduled retention job and the automated
   checks all use this single source of truth, so a rule can never drift between them.

   Policy shape (stored at settings/public.retention):
     { defaultDays: 365, warnDaysBefore: 30, behavior: 'anonymize' | 'disable' | 'delete',
       paused: false, exceptions: [ { address, days } ] }
   Ledger entry shape (derived from usernames/{address} + users/{uid}):
     { address, uid, retired: true, retiredAt, hits, lastHitAt } */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.NGFRetention = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DAY = 86400000;
  var BEHAVIORS = [
    { id: 'anonymize', label: 'বেনামী করা (ঠিকানা মুছে শুধু রেকর্ড রাখা)', hint: 'সবচেয়ে নিরাপদ — অডিট থাকে, ঠিকানা আর পড়া যায় না' },
    { id: 'disable', label: 'নিষ্ক্রিয় রাখা (লগইনে আর ব্যবহার হবে না)', hint: 'কিছুই মুছবে না; শুধু লগইন-পথ বন্ধ থাকবে' },
    { id: 'delete', label: 'মুছে ফেলা', hint: 'ঠিকানার alias ডকুমেন্ট মুছে যাবে (অডিট অপরিবর্তিত থাকবে)' }
  ];
  var DEFAULT_POLICY = { defaultDays: 365, warnDaysBefore: 30, behavior: 'anonymize', paused: false, exceptions: [] };

  function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function ts(v) { var t = Date.parse(String(v || '')); return isNaN(t) ? 0 : t; }
  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }

  function normalizePolicy(p) {
    p = p && typeof p === 'object' ? p : {};
    var behavior = BEHAVIORS.some(function (b) { return b.id === p.behavior; }) ? p.behavior : DEFAULT_POLICY.behavior;
    var exceptions = Array.isArray(p.exceptions) ? p.exceptions.filter(function (e) { return e && e.address; }).map(function (e) {
      return { address: lc(e.address), days: Math.max(0, num(e.days, DEFAULT_POLICY.defaultDays)), note: String(e.note || '') };
    }) : [];
    return {
      defaultDays: Math.max(0, num(p.defaultDays, DEFAULT_POLICY.defaultDays)),
      warnDaysBefore: Math.max(0, num(p.warnDaysBefore, DEFAULT_POLICY.warnDaysBefore)),
      behavior: behavior,
      paused: !!p.paused,
      exceptions: exceptions,
      updatedAt: String(p.updatedAt || ''),
      updatedBy: String(p.updatedBy || '')
    };
  }

  function behaviors() { return BEHAVIORS.slice(); }
  function defaults() { return JSON.parse(JSON.stringify(DEFAULT_POLICY)); }

  /* the window that applies to one address: an exception wins over the default */
  function effectiveDays(address, policy) {
    var p = normalizePolicy(policy), key = lc(address);
    for (var i = 0; i < p.exceptions.length; i++) { if (p.exceptions[i].address === key) { return p.exceptions[i].days; } }
    return p.defaultDays;
  }

  function addDays(iso, days) { var t = ts(iso); if (!t) { return ''; } return new Date(t + num(days, 0) * DAY).toISOString(); }
  function daysBetween(aIso, bIso) { var a = ts(aIso), b = ts(bIso); if (!a || !b) { return null; } return Math.round((b - a) / DAY); }

  function retainUntil(entry, policy) {
    var e = entry || {};
    var base = e.retiredAt || e.at || '';
    if (!base) { return ''; }
    return addDays(base, effectiveDays(e.address, policy));
  }

  function daysLeft(entry, policy, nowIso) {
    var until = retainUntil(entry, policy);
    if (!until) { return null; }
    var now = ts(nowIso || new Date().toISOString());
    return Math.round((ts(until) - now) / DAY);
  }

  function statusOf(entry, policy, nowIso) {
    var p = normalizePolicy(policy);
    var left = daysLeft(entry, p, nowIso);
    if (left === null) { return 'unknown'; }
    if (left < 0) { return 'expired'; }
    if (left <= p.warnDaysBefore) { return 'expiring-soon'; }
    return 'active';
  }

  /* what the job will do right now, and what the admin must be warned about */
  function plan(entries, policy, nowIso) {
    var p = normalizePolicy(policy);
    var warn = [], apply = [], untouched = [];
    (entries || []).forEach(function (raw) {
      var e = Object.assign({}, raw, { address: lc(raw && raw.address) });
      if (!e.address) { return; }
      var st = statusOf(e, p, nowIso);
      var item = { address: e.address, uid: String(e.uid || ''), retiredAt: e.retiredAt || e.at || '', retainUntil: retainUntil(e, p), daysLeft: daysLeft(e, p, nowIso), hits: num(e.hits, 0), lastHitAt: e.lastHitAt || '', status: st, behavior: p.behavior };
      if (st === 'expired') { apply.push(Object.assign({ action: p.behavior }, item)); }
      else if (st === 'expiring-soon') { warn.push(item); }
      else { untouched.push(item); }
    });
    return { warn: warn, apply: apply, untouched: untouched, paused: p.paused, behavior: p.behavior };
  }

  function summarize(entries, policy, nowIso) {
    var pl = plan(entries, policy, nowIso);
    return { total: (entries || []).length, active: pl.untouched.length, expiring: pl.warn.length, expired: pl.apply.length, paused: pl.paused, behavior: pl.behavior };
  }

  /* ---------- anonymising ---------- */
  function maskAddress(v) {
    var s = String(v || '').trim();
    var at = s.indexOf('@');
    if (at < 1) { return s ? s.slice(0, 2) + '***' : ''; }
    return s.slice(0, 2) + '***@' + s.slice(at + 1, at + 2) + '***';
  }
  /* the replacement document for an expired address: still retired, but the address is gone */
  function anonymizedDoc(entry, policy, nowIso) {
    var e = entry || {};
    return {
      uid: String(e.uid || ''),
      type: 'email',
      retired: true,
      anonymized: true,
      anonymizedAt: String(nowIso || new Date().toISOString()),
      retainedFrom: String(e.retiredAt || e.at || ''),
      retainUntil: retainUntil(e, policy),
      hits: num(e.hits, 0),
      movedTo: 'anonymised'
    };
  }

  /* the per-address document id used in the usernames collection */
  function docId(address) { return lc(address); }

  /* audit text for the job, so the history view can render before -> after */
  function jobAuditDetail(entry, policy, nowIso) {
    var e = entry || {};
    return {
      action: 'retention.applied',
      objectType: 'email',
      objectId: String(e.uid || ''),
      changes: [{ field: 'retired-address', from: String(e.address || ''), to: maskAddress(e.address) }],
      before: String(e.address || ''),
      after: maskAddress(e.address || ''),
      detail: 'retention window over: ' + maskAddress(e.address || '') + ' (' + normalizePolicy(policy).behavior + ')'
    };
  }

  return {
    DAY: DAY, defaults: defaults, behaviors: behaviors, normalizePolicy: normalizePolicy,
    effectiveDays: effectiveDays, addDays: addDays, daysBetween: daysBetween,
    retainUntil: retainUntil, daysLeft: daysLeft, statusOf: statusOf, plan: plan, summarize: summarize,
    maskAddress: maskAddress, anonymizedDoc: anonymizedDoc, docId: docId, jobAuditDetail: jobAuditDetail,
    ts: ts, lc: lc
  };
});
