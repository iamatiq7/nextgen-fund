/* NextGen Fund — shared utilities (browser + Node) */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.NGFUtil = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var U = {};

  /* ---------- pure-JS SHA-256 (works on file:// and in Node) ---------- */
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  U.sha256 = function (msg) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l = msg.length;
    var words = [];
    for (var i = 0; i < l; i++) words[i >> 2] = (words[i >> 2] || 0) | (msg.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    words[l >> 2] = (words[l >> 2] || 0) | 0x80 << (24 - (l % 4) * 8);
    var nBlocks = Math.ceil((l + 9) / 64);
    words[nBlocks * 16 - 1] = l * 8;
    for (var w = 0; w < words.length; w++) if (words[w] === undefined) words[w] = 0;
    for (var b = 0; b < nBlocks; b++) {
      var W = new Array(64);
      for (var t = 0; t < 16; t++) W[t] = words[b * 16 + t];
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t-15],7) ^ rotr(W[t-15],18) ^ (W[t-15] >>> 3);
        var s1 = rotr(W[t-2],17) ^ rotr(W[t-2],19) ^ (W[t-2] >>> 10);
        W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
      }
      var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var temp2 = (S0 + maj) | 0;
        h=g; g=f; f=e; e=(d+temp1)|0; d=c; c=bb; bb=a; a=(temp1+temp2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + ((H[i] >>> 0).toString(16))).slice(-8);
    return out;
  };

  /* ---------- money & dates ---------- */
  U.fmtBDT = function (n, opts) {
    n = Number(n) || 0;
    var s = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    var sign = n < 0 ? '\u2212' : (opts && opts.plus ? '+' : '');
    return '\u09F3' + sign + s;
  };
  var LOCALE = function () {
    try { if (typeof root.NGFLANG !== 'undefined' && root.NGFLANG && root.NGFLANG.lang === 'bn') return 'bn-BD'; } catch (e) {}
    return 'en-GB';
  };
  U.fmtDate = function (iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(LOCALE(), { day: '2-digit', month: 'short', year: 'numeric' });
  };
  U.fmtMonth = function (ym) {
    if (!ym) return '\u2014';
    var d = new Date(ym + '-01T00:00:00');
    return d.toLocaleDateString(LOCALE(), { month: 'short', year: 'numeric' });
  };
  U.todayISO = function () {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  U.currentMonth = function () { return U.todayISO().slice(0, 7); };
  U.monthsInclusive = function (fromYm, toYm) {
    if (!fromYm) return 1;
    var a = fromYm.split('-'), b = (toYm || U.currentMonth()).split('-');
    var m = (parseInt(b[0], 10) - parseInt(a[0], 10)) * 12 + (parseInt(b[1], 10) - parseInt(a[1], 10));
    return Math.max(1, m + 1);
  };
  U.daysUntil = function (iso) {
    if (!iso) return null;
    var t = new Date(iso + 'T00:00:00') - new Date(U.todayISO() + 'T00:00:00');
    return Math.round(t / 86400000);
  };

  /* ---------- misc ---------- */
  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  U.uid = function (p) {
    return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  U.validUsername = function (u) { return /^[a-z0-9]([a-z0-9._-]{2,30})[a-z0-9]$/.test(u); };
  U.validEmail = function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); };

  /* ============================================================
     Payment state — ONE implementation shared by the demo store and
     the Firebase adapter, so both backends can never disagree and a
     mistyped filter can never silently return every record.
     ============================================================ */
  U.PAY_STATUSES = ['pending', 'verified', 'rejected'];

  /* Accepts 'pending' | {status:'pending'} | null/undefined.
     Anything else is a programming error, so it fails loudly:
     the old code ignored the whole filter when handed a plain string,
     which is what made the admin dashboard count ALL payments as
     pending ("Verify 6 submitted payment(s)" forever). */
  U.normPayFilter = function (filter) {
    var st = (filter && typeof filter === 'object') ? filter.status : filter;
    if (st === undefined || st === null || st === '') return null;
    if (U.PAY_STATUSES.indexOf(st) === -1) {
      throw new Error('Unknown payment status filter: ' + st);
    }
    return st;
  };

  /* Single source of truth for every payment count / amount shown anywhere.
     Accepts the raw payment records and returns bucketed counts + money. */
  U.summarisePayments = function (list) {
    var stats = {
      counts: { pending: 0, verified: 0, rejected: 0, other: 0, all: 0 },
      amounts: { pending: 0, verified: 0, rejected: 0, other: 0, all: 0 },
      pendingOldest: null,
      pendingMembers: 0,
      duplicates: []
    };
    var seen = {}, pendMembers = {};
    (list || []).forEach(function (p) {
      var amt = Number(p.amount) || 0;
      var st = U.PAY_STATUSES.indexOf(p && p.status) === -1 ? 'other' : p.status;
      stats.counts[st] += 1; stats.amounts[st] += amt;
      stats.counts.all += 1; stats.amounts.all += amt;
      if (st === 'pending') {
        var at = p.submittedAt || '';
        if (at && (!stats.pendingOldest || at < stats.pendingOldest)) stats.pendingOldest = at;
        pendMembers[p.memberId || p.memberName || '?'] = 1;
      }
      var ref = String((p && p.ref) || '').trim().toLowerCase();
      if (ref) {
        var key = (p.memberId || p.memberName || '?') + '|' + ref;
        var g = seen[key] || (seen[key] = {
          memberId: p.memberId, memberName: p.memberName, ref: p.ref,
          count: 0, amount: 0, statuses: [], ids: []
        });
        g.count += 1; g.amount += amt; g.statuses.push(p.status); g.ids.push(p.id);
      }
    });
    stats.pendingMembers = Object.keys(pendMembers).length;
    Object.keys(seen).forEach(function (k) { if (seen[k].count > 1) stats.duplicates.push(seen[k]); });
    stats.duplicates.sort(function (a, b) { return b.count - a.count; });
    return stats;
  };

  U.csv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
  };
  U.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  };

  /* built-in self test (used by tests/pending.test.mjs) */
  U.summarisePayments.selfCheck = function () {
    var s = U.summarisePayments([
      { id: 'a', status: 'pending', amount: 1000, memberId: 'm1', ref: 'X1', submittedAt: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'pending', amount: 2000, memberId: 'm2', ref: 'X2', submittedAt: '2026-09-02T00:00:00Z' },
      { id: 'c', status: 'verified', amount: 1000, memberId: 'm1', ref: 'X1' },
      { id: 'd', status: 'rejected', amount: 3000, memberId: 'm3', ref: 'X3' },
      { id: 'e', status: 'garbage', amount: 500, memberId: 'm4', ref: '' }
    ]);
    return s.counts.pending === 2 && s.amounts.pending === 3000 &&
      s.counts.verified === 1 && s.counts.rejected === 1 && s.counts.other === 1 &&
      s.counts.all === 5 && s.amounts.all === 7500 &&
      s.duplicates.length === 1 && s.duplicates[0].ref === 'X1' &&
      s.pendingOldest === '2026-09-01T00:00:00Z' && s.pendingMembers === 2 &&
      U.normPayFilter('pending') === 'pending' &&
      U.normPayFilter({ status: 'verified' }) === 'verified' &&
      U.normPayFilter(null) === null &&
      (function () { try { U.normPayFilter('nope'); return false; } catch (e) { return true; } })();
  };

  U.photoSrc = function (ref) {
    var v = String(ref || '').trim();
    if (!v) return '';
    if (/^data:image\//i.test(v)) return v;
    if (/^https?:\/\//i.test(v)) {
      var m = v.match(/[-\w]{25,}/);
      if (m && /drive\.google\.com|googleusercontent|docs\.google\.com/.test(v)) {
        return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w400';
      }
      return v;
    }
    if (/^[-\w]{25,}$/.test(v)) return 'https://drive.google.com/thumbnail?id=' + v + '&sz=w400';
    return '';
  };

  U.initials = function (name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return U;
});
