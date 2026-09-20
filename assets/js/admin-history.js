/* NextGen Fund — admin console extras: action history, retention policy, scheduled jobs.
   Additive module, loaded after admin.js: it appends three tabs and renders them itself, so the
   existing console code stays untouched.

   Design: preset 03 "Information Architects" — content-first hierarchy, system fonts only,
   classic blue links for navigation, dense but scannable tables, nothing decorative. */
(function () {
  'use strict';
  var U = window.NGFUtil, L = window.NGFLANG, S = window.NGFStore, A = window.NGFAudit, R = window.NGFRetention;
  if (!S || !A) { return; }

  var TABS = [
    { id: 'history', label: 'ইতিহাস' },
    { id: 'retention', label: 'রিটেনশন নীতি' },
    { id: 'jobs', label: 'জব রান' }
  ];
  var TZ = 'Asia/Dhaka';
  var st = { page: 1, size: 25, q: '', actor: '', group: '', from: '', to: '', rows: [], pageInfo: null, facets: null, busy: false };
  var ledger = [], policy = null, jobs = null, warn = null;

  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? '' : s); }
  function when(iso) { return A.formatWhen(iso, TZ); }
  function body() { return document.getElementById('tab-body'); }

  /* ---------- tabs ---------- */
  function injectTabs() {
    var bar = document.getElementById('admin-tabs');
    if (!bar) { return false; }
    TABS.forEach(function (t) {
      if (bar.querySelector('[data-tab="' + t.id + '"]')) { return; }
      var b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', t.id);
      b.setAttribute('aria-selected', 'false');
      b.textContent = t.label;
      bar.appendChild(b);
    });
    /* capture phase: the console's own tab handler must never see these clicks */
    bar.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-tab]') : null;
      if (!btn) { return; }
      var id = btn.getAttribute('data-tab');
      if (!TABS.some(function (t) { return t.id === id; })) { return; }
      ev.preventDefault();
      ev.stopPropagation();
      open(id);
    }, true);
    return true;
  }

  function markActive(id) {
    Array.prototype.forEach.call(document.querySelectorAll('#admin-tabs [data-tab]'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === id));
    });
  }

  function open(id) {
    markActive(id);
    if (location.hash.slice(1) !== id) { try { history.replaceState(null, '', '#' + id); } catch (e) { } }
    if (id === 'history') { renderHistory(); }
    else if (id === 'retention') { renderRetention(); }
    else if (id === 'jobs') { renderJobs(); }
  }

  /* A non-admin who deep-links here is refused and the attempt is written to the audit trail. */
  async function guard() {
    var s = null;
    try { s = await S.getSession(); } catch (e) { s = null; }
    if (s && s.role === 'admin') { return true; }
    try { await S.logDeniedView('admin console · ' + (location.hash || '').replace('#', '')); } catch (e) { }
    var b = body();
    if (b) {
      b.innerHTML = '<div class="card" style="max-width:660px"><h2>প্রবেশ নিষিদ্ধ</h2>' +
        '<p>এই অংশটি শুধু অ্যাডমিনের জন্য। আপনার চেষ্টাটি অডিট লগে লেখা হয়েছে।</p>' +
        '<p><a href="portal.html">← সদস্য পোর্টালে ফিরে যান</a></p></div>';
    }
    return false;
  }

  /* ---------- 1. action history ---------- */
  function historyToolbar() {
    var f = st.facets || { actors: [], groups: [] };
    var actorOpts = ['<option value="">সব অ্যাডমিন</option>'].concat(f.actors.map(function (a) {
      return '<option value="' + esc(a.value) + '"' + (st.actor === a.value ? ' selected' : '') + '>' + esc(a.value) + ' (' + a.count + ')</option>';
    })).join('');
    var groupOpts = ['<option value="">সব ধরন</option>'].concat((f.groups || []).map(function (g) {
      return '<option value="' + esc(g.id) + '"' + (st.group === g.id ? ' selected' : '') + '>' + esc(g.label) + ' (' + g.count + ')</option>';
    })).join('');
    return '<form id="ah-filters" class="row-flex" style="flex-wrap:wrap;gap:10px;align-items:flex-end;margin:0 0 14px">' +
      '<label class="f" style="min-width:200px"><span>অনুসন্ধান</span><input type="search" id="ah-q" value="' + esc(st.q) + '" placeholder="নাম, ইমেইল, অ্যাকশন, রেকর্ড…"></label>' +
      '<label class="f" style="min-width:150px"><span>অ্যাডমিন</span><select id="ah-actor">' + actorOpts + '</select></label>' +
      '<label class="f" style="min-width:150px"><span>ধরন</span><select id="ah-group">' + groupOpts + '</select></label>' +
      '<label class="f"><span>শুরু (তারিখ)</span><input type="date" id="ah-from" value="' + esc(st.from) + '"></label>' +
      '<label class="f"><span>শেষ (তারিখ)</span><input type="date" id="ah-to" value="' + esc(st.to) + '"></label>' +
      '<button class="btn" type="submit" id="ah-apply">ফিল্টার</button>' +
      '<a href="#" id="ah-reset">রিসেট</a>' +
      '<a href="#" id="ah-csv">CSV ডাউনলোড</a>' +
      '</form>';
  }

  function historyTable(p) {
    var rows = p.rows || [];
    if (!rows.length) { return '<p class="footnote">এই ফিল্টারে কোনো রেকর্ড নেই।</p>'; }
    var head = '<tr><th style="width:132px">কখন (' + TZ + ')</th><th style="width:120px">কে</th><th style="width:180px">কী</th><th style="width:110px">ধরন</th><th>আগের মান → পরের মান</th><th style="width:120px">রেকর্ড</th></tr>';
    var bodyRows = rows.map(function (e) {
      var pair = A.beforeAfter(e);
      var pa = pair.map(function (c) {
        return '<div><span class="k">' + esc(c.field) + '</span> ' + esc(c.from || '—') + ' → <strong>' + esc(c.to || '—') + '</strong></div>';
      }).join('') || '<span class="footnote">' + esc(e.text || '—') + '</span>';
      return '<tr><td class="n" style="white-space:nowrap">' + esc(when(e.at)) + '</td>' +
        '<td>' + esc(e.actor) + '</td>' +
        '<td>' + esc(e.action) + '</td>' +
        '<td>' + esc(e.groupLabel) + '</td>' +
        '<td>' + pa + '</td>' +
        '<td class="footnote">' + esc(e.object || '—') + '<br>' + esc(e.objectType) + '</td></tr>';
    }).join('');
    return '<table class="data" id="ah-table"><thead>' + head + '</thead><tbody>' + bodyRows + '</tbody></table>';
  }

  function historyPager(p) {
    return '<div class="row-flex" style="justify-content:space-between;align-items:center;margin-top:12px;gap:12px;flex-wrap:wrap">' +
      '<span class="footnote">মোট ' + p.total + ' রেকর্ড · দেখানো হচ্ছে ' + p.fromIndex + '–' + p.toIndex + ' · পৃষ্ঠা ' + p.page + '/' + p.pages + '</span>' +
      '<span class="row-flex" style="gap:8px;align-items:center">' +
      '<a href="#" id="ah-prev"' + (p.hasPrev ? '' : ' aria-disabled="true" style="opacity:.45;pointer-events:none"') + '>← আগের</a>' +
      '<label class="f" style="margin:0"><span>প্রতি পৃষ্ঠা</span><select id="ah-size">' +
      [10, 25, 50, 100].map(function (n) { return '<option value="' + n + '"' + (st.size === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></label>' +
      '<a href="#" id="ah-next"' + (p.hasNext ? '' : ' aria-disabled="true" style="opacity:.45;pointer-events:none"') + '>পরের →</a>' +
      '</span></div>';
  }

  async function renderHistory() {
    if (!(await guard())) { return; }
    var b = body(); if (!b) { return; }
    b.innerHTML = '<div class="card" style="max-width:1180px"><h2>অ্যাকশন-ইতিহাস</h2>' +
      '<p class="footnote">প্রতিটি অ্যাডমিন-কাজ এখানে রেকর্ড হয় — কে, কখন, কোন রেকর্ডে, আগের ও পরের মানসহ। অডিট রেকর্ড অ্যাপ থেকে বদলানো সম্ভব নয় (ডেটাবেজ নিয়মে আপডেট নিষিদ্ধ)।</p>' +
      '<div id="ah-wrap"><p class="footnote">লোড হচ্ছে…</p></div></div>';
    await loadHistory();
  }

  async function loadHistory() {
    var wrap = document.getElementById('ah-wrap');
    if (!wrap || st.busy) { return; }
    st.busy = true;
    try {
      var p = await S.listAuditPage({ page: st.page, size: st.size, q: st.q, actor: st.actor, group: st.group, from: st.from, to: st.to });
      st.pageInfo = p; st.rows = p.rows; st.facets = p.facets;
      wrap.innerHTML = historyToolbar() + historyTable(p) + historyPager(p);
      wireHistory();
    } catch (e) {
      wrap.innerHTML = '<p class="err">ইতিহাস আনা যায়নি: ' + esc((e && e.message) || e) + '</p>';
    } finally { st.busy = false; }
  }

  function wireHistory() {
    var f = document.getElementById('ah-filters');
    if (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        st.q = (document.getElementById('ah-q').value || '').trim();
        st.actor = document.getElementById('ah-actor').value || '';
        st.group = document.getElementById('ah-group').value || '';
        st.from = document.getElementById('ah-from').value || '';
        st.to = document.getElementById('ah-to').value || '';
        st.page = 1; loadHistory();
      });
    }
    var rs = document.getElementById('ah-reset');
    if (rs) { rs.addEventListener('click', function (ev) { ev.preventDefault(); st = Object.assign(st, { q: '', actor: '', group: '', from: '', to: '', page: 1 }); loadHistory(); }); }
    var pv = document.getElementById('ah-prev');
    if (pv) { pv.addEventListener('click', function (ev) { ev.preventDefault(); if (st.pageInfo && st.pageInfo.hasPrev) { st.page--; loadHistory(); } }); }
    var nx = document.getElementById('ah-next');
    if (nx) { nx.addEventListener('click', function (ev) { ev.preventDefault(); if (st.pageInfo && st.pageInfo.hasNext) { st.page++; loadHistory(); } }); }
    var sz = document.getElementById('ah-size');
    if (sz) { sz.addEventListener('change', function () { st.size = parseInt(this.value, 10) || 25; st.page = 1; loadHistory(); }); }
    var cs = document.getElementById('ah-csv');
    if (cs) {
      cs.addEventListener('click', async function (ev) {
        ev.preventDefault();
        var p = await S.listAuditPage({ page: 1, size: 100000, q: st.q, actor: st.actor, group: st.group, from: st.from, to: st.to });
        var blob = new Blob([A.csv(p.rows, TZ)], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ngf-action-history.csv';
        a.click();
      });
    }
  }

  /* ---------- 2. retention policy ---------- */
  function retentionCard() {
    var p = R ? R.normalizePolicy(policy) : policy || {};
    var s = R && ledger ? R.summarize(ledger, p, new Date().toISOString()) : { total: 0, active: 0, expiring: 0, expired: 0 };
    var warnRows = (warn && warn.warn) || [];
    var warnBox = warnRows.length
      ? '<div class="notice" style="border-left:4px solid #b8860b;background:#fff8e6">⚠️ <strong>' + warnRows.length + 'টি ঠিকানা</strong> শীঘ্রই মেয়াদোত্তীর্ণ হবে — ' +
        warnRows.map(function (w) { return esc(R.maskAddress(w.address)) + ' (' + w.daysLeft + ' দিন)'; }).join(', ') + '</div>'
      : '';
    var exc = (p.exceptions || []).map(function (e) {
      return '<tr><td>' + esc(e.address) + '</td><td class="n">' + esc(e.days) + ' দিন</td><td>' + esc(e.note || '') + '</td>' +
        '<td><a href="#" class="rr-del" data-address="' + esc(e.address) + '">সরান</a></td></tr>';
    }).join('');
    return '<div class="card" style="max-width:1080px"><h2>পুরোনো ঠিকানার সংরক্ষণ-নীতি</h2>' +
      '<p class="footnote">প্রতিস্থাপিত লগইন-ঠিকানা কতদিন রাখা হবে, মেয়াদ শেষে কী হবে এবং কখন আগাম সতর্কবার্তা আসবে — সব এখান থেকে নিয়ন্ত্রিত। সময় অঞ্চল: ' + TZ + ' · প্রয়োগ করে সময়ভিত্তিক জব (ops/retention)।</p>' +
      warnBox +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:8px 0 16px">' +
      '<div><span class="k">মোট ঠিকানা</span><div><strong>' + s.total + '</strong></div></div>' +
      '<div><span class="k">সক্রিয়</span><div><strong>' + s.active + '</strong></div></div>' +
      '<div><span class="k">শীঘ্রই মেয়াদোত্তীর্ণ</span><div><strong>' + s.expiring + '</strong></div></div>' +
      '<div><span class="k">মেয়াদ শেষ</span><div><strong>' + s.expired + '</strong></div></div>' +
      '</div>' +
      '<form id="rr-form" novalidate>' +
      '<div class="grid two">' +
      '<label class="f"><span>ডিফল্ট সংরক্ষণকাল (দিন)</span><input type="number" id="rr-days" min="0" step="1" value="' + esc(p.defaultDays) + '"></label>' +
      '<label class="f"><span>আগাম সতর্কবার্তা (দিন আগে)</span><input type="number" id="rr-warn" min="0" step="1" value="' + esc(p.warnDaysBefore) + '"></label>' +
      '<label class="f"><span>মেয়াদ শেষে আচরণ</span><select id="rr-behavior">' +
      (R ? R.behaviors().map(function (b) { return '<option value="' + b.id + '"' + (p.behavior === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>'; }).join('') : '') +
      '</select></label>' +
      '<label class="f"><span>জব বিরত রাখুন</span><select id="rr-paused"><option value="false"' + (p.paused ? '' : ' selected') + '>না — চলবে</option><option value="true"' + (p.paused ? ' selected' : '') + '>হ্যাঁ — থামানো</option></select></label>' +
      '</div>' +
      '<div id="rr-err" class="err" role="alert"></div><div id="rr-done" class="notice ok hide"></div>' +
      '<button class="btn" type="submit">নীতি সংরক্ষণ করুন</button>' +
      '</form>' +
      '<h3>ব্যতিক্রমী ঠিকানা (নির্দিষ্ট দিন)</h3>' +
      '<form id="rr-exc" class="row-flex" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
      '<label class="f" style="min-width:240px"><span>ঠিকানা</span><input type="text" id="rr-addr" placeholder="name@example.com"></label>' +
      '<label class="f"><span>দিন</span><input type="number" id="rr-addr-days" min="0" step="1" value="30"></label>' +
      '<label class="f" style="min-width:200px"><span>নোট</span><input type="text" id="rr-note"></label>' +
      '<button class="btn" type="submit">যোগ করুন</button>' +
      '</form>' +
      '<div id="rr-exc-list">' + (exc ? '<table class="data"><thead><tr><th>ঠিকানা</th><th>দিন</th><th>নোট</th><th></th></tr></thead><tbody>' + exc + '</tbody></table>' : '<p class="footnote">কোনো ব্যতিক্রম নেই — সব ঠিকানায় ডিফল্ট প্রযোজ্য।</p>') + '</div>' +
      '<h3>ঠিকানার খতিয়ান</h3>' +
      ledgerTable() +
      '</div>';
  }

  function ledgerTable() {
    if (!ledger || !ledger.length) { return '<p class="footnote">এখনো কোনো প্রতিস্থাপিত ঠিকানা নেই। (ইমেইল পরিবর্তন Approve হলে এখানে যোগ হয়।)</p>'; }
    var p = R ? R.normalizePolicy(policy) : {};
    var now = new Date().toISOString();
    var rows = ledger.map(function (e) {
      var s = R ? R.statusOf(e, p, now) : '';
      var left = R ? R.daysLeft(e, p, now) : null;
      var chip = s === 'expired' ? '<span style="color:#b3261e">মেয়াদ শেষ</span>'
        : s === 'expiring-soon' ? '<span style="color:#b8860b">শীঘ্রই (' + left + ' দিন)</span>'
          : '<span style="color:#0f7a4d">সক্রিয় (' + left + ' দিন)</span>';
      return '<tr><td>' + esc(R ? R.maskAddress(e.address) : e.address) + '</td><td>' + esc(e.username || '—') + '</td>' +
        '<td>' + esc(when(e.retiredAt)) + '</td><td>' + esc(R ? when(R.retainUntil(e, p)) : '') + '</td>' +
        '<td class="n">' + esc(e.hits || 0) + '</td><td class="n">' + esc(e.lastHitAt ? when(e.lastHitAt) : '—') + '</td>' +
        '<td>' + chip + (e.anonymized ? ' · বেনামী' : '') + '</td></tr>';
    }).join('');
    return '<table class="data"><thead><tr><th>ঠিকানা</th><th>সদস্য</th><th>প্রতিস্থাপিত</th><th>মেয়াদ শেষ</th><th>ব্যবহার</th><th>শেষ ব্যবহার</th><th>অবস্থা</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function renderRetention() {
    if (!(await guard())) { return; }
    var b = body(); if (!b) { return; }
    b.innerHTML = '<div class="card" style="max-width:1080px"><h2>রিটেনশন নীতি</h2><p class="footnote">লোড হচ্ছে…</p></div>';
    try {
      policy = await S.loadRetentionPolicy();
      ledger = await S.retainedAddressLedger();
      warn = R ? R.plan(ledger, policy, new Date().toISOString()) : null;
      b.innerHTML = retentionCard();
      wireRetention();
    } catch (e) {
      b.innerHTML = '<div class="card"><h2>রিটেনশন নীতি</h2><p class="err">' + esc((e && e.message) || e) + '</p></div>';
    }
  }

  function wireRetention() {
    var f = document.getElementById('rr-form');
    if (f) {
      f.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var err = document.getElementById('rr-err'), done = document.getElementById('rr-done');
        err.textContent = ''; done.classList.add('hide');
        var days = parseInt(document.getElementById('rr-days').value, 10);
        var wn = parseInt(document.getElementById('rr-warn').value, 10);
        if (isNaN(days) || days < 0) { err.textContent = 'সংরক্ষণকাল ০ বা তার বেশি হতে হবে।'; return; }
        if (isNaN(wn) || wn < 0) { err.textContent = 'সতর্কবার্তার দিন ০ বা তার বেশি হতে হবে।'; return; }
        if (wn > days) { err.textContent = 'সতর্কবার্তা সংরক্ষণকালের চেয়ে বেশি হতে পারে না।'; return; }
        try {
          policy = await S.saveRetentionPolicy({ defaultDays: days, warnDaysBefore: wn, behavior: document.getElementById('rr-behavior').value, paused: document.getElementById('rr-paused').value === 'true' });
          done.textContent = 'সংরক্ষিত ✓ — অডিট লগে নাম লেখা হয়েছে।';
          done.classList.remove('hide');
          ledger = await S.retainedAddressLedger();
          warn = R ? R.plan(ledger, policy, new Date().toISOString()) : null;
          document.getElementById('tab-body').innerHTML = retentionCard();
          wireRetention();
        } catch (e) { err.textContent = 'সংরক্ষণ ব্যর্থ: ' + esc((e && e.message) || e); }
      });
    }
    var x = document.getElementById('rr-exc');
    if (x) {
      x.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var addr = (document.getElementById('rr-addr').value || '').trim();
        var d = parseInt(document.getElementById('rr-addr-days').value, 10);
        if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(addr)) { alert('ঠিকানার ফরম্যাট ঠিক নয়।'); return; }
        if (isNaN(d) || d < 0) { alert('দিন ০ বা তার বেশি হতে হবে।'); return; }
        var next = (policy.exceptions || []).filter(function (e) { return e.address !== addr.toLowerCase(); });
        next.push({ address: addr, days: d, note: (document.getElementById('rr-note').value || '').trim() });
        policy = await S.saveRetentionPolicy({ exceptions: next });
        ledger = await S.retainedAddressLedger();
        document.getElementById('tab-body').innerHTML = retentionCard();
        wireRetention();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.rr-del'), function (a) {
      a.addEventListener('click', async function (ev) {
        ev.preventDefault();
        var addr = this.getAttribute('data-address');
        var next = (policy.exceptions || []).filter(function (e) { return e.address !== addr; });
        policy = await S.saveRetentionPolicy({ exceptions: next });
        document.getElementById('tab-body').innerHTML = retentionCard();
        wireRetention();
      });
    });
  }

  /* ---------- 3. scheduled jobs ---------- */
  function jobCard() {
    var c = (jobs && jobs.control) || {};
    var runs = (jobs && jobs.runs) || [];
    var req = (jobs && jobs.requests) || {};
    var paused = !!c.paused;
    var runRows = runs.length ? runs.map(function (r) {
      return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(r.job || '') + '</td>' +
        '<td>' + (r.ok ? '<span style="color:#0f7a4d">সফল</span>' : '<span style="color:#b3261e">ব্যর্থ</span>') + '</td>' +
        '<td class="n">' + esc(r.applied == null ? '—' : r.applied) + '</td>' +
        '<td class="n">' + esc(r.failed == null ? '—' : r.failed) + '</td>' +
        '<td class="n">' + esc(r.deadLetter == null ? '—' : r.deadLetter) + '</td>' +
        '<td class="n">' + esc(r.ms == null ? '—' : (r.ms + ' ms')) + '</td>' +
        '<td class="footnote">' + esc(r.by || 'schedule') + (r.note ? ' · ' + esc(r.note) : '') + '</td></tr>';
    }).join('') : '';
    return '<div class="card" style="max-width:1120px"><h2>সময়ভিত্তিক জব</h2>' +
      '<p class="footnote">GitHub Actions-এর সময়সূচিতে চলে (প্রতি রাতে) — সময় অঞ্চল ' + TZ + '। পুনরাবৃত্তি-নিরাপদ: একই আইটেম দুইবার প্রয়োগ হয় না; ব্যর্থ আইটেম dead-letter-এ জমা থাকে ও পরের রানে আবার চেষ্টা হয়।</p>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:8px 0 16px">' +
      '<div><span class="k">অবস্থা</span><div><strong>' + (paused ? 'থামানো' : 'চালু') + '</strong></div></div>' +
      '<div><span class="k">শেষ রান</span><div><strong>' + esc(runs.length ? when(runs[0].at) : '—') + '</strong></div></div>' +
      '<div><span class="k">শেষ রানে প্রয়োগ</span><div><strong>' + esc(runs.length ? (runs[0].applied == null ? '—' : runs[0].applied) : '—') + '</strong></div></div>' +
      '<div><span class="k">dead-letter</span><div><strong>' + esc(runs.length ? (runs[0].deadLetter == null ? 0 : runs[0].deadLetter) : 0) + '</strong></div></div>' +
      '</div>' +
      '<div class="row-flex" style="gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
      '<button class="btn" type="button" id="jc-toggle">' + (paused ? 'জব আবার চালু করুন' : 'জব থামান (pause)') + '</button>' +
      '<a href="#" id="jc-run">এখনই চালানোর অনুরোধ</a>' +
      '<span class="footnote">ম্যানুয়াল অনুরোধ পরের সময়সূচি রানে (বা CI থেকে তাৎক্ষণিকভাবে) কার্যকর হয়।</span>' +
      '</div>' +
      ((req['email-apply'] || req.retention) ? '<div class="notice">অনুরোধ জমা: ' + ['email-apply', 'retention'].filter(function (k) { return req[k]; }).map(function (k) { return esc(k) + ' @ ' + esc(when(req[k].at)) + ' (' + esc(req[k].by || '') + ')'; }).join(' · ') + '</div>' : '') +
      (runRows ? '<table class="data"><thead><tr><th>কখন</th><th>জব</th><th>ফল</th><th>প্রয়োগ</th><th>ব্যর্থ</th><th>dead-letter</th><th>সময়</th><th>কে</th></tr></thead><tbody>' + runRows + '</tbody></table>'
        : '<p class="footnote">এখনো কোনো রান রেকর্ড হয়নি — প্রথম সময়সূচি রানের পর এখানে দেখা যাবে।</p>') +
      (c.reason ? '<p class="footnote">বিরতির কারণ: ' + esc(c.reason) + '</p>' : '') +
      (c.updatedBy ? '<p class="footnote">সর্বশেষ পরিবর্তন: ' + esc(c.updatedBy) + ' · ' + esc(when(c.updatedAt)) + '</p>' : '') +
      '</div>';
  }

  async function renderJobs() {
    if (!(await guard())) { return; }
    var b = body(); if (!b) { return; }
    b.innerHTML = '<div class="card" style="max-width:1120px"><h2>জব রান</h2><p class="footnote">লোড হচ্ছে…</p></div>';
    try {
      jobs = await S.loadJobRuns();
      b.innerHTML = jobCard();
      wireJobs();
    } catch (e) {
      b.innerHTML = '<div class="card"><h2>জব রান</h2><p class="err">' + esc((e && e.message) || e) + '</p></div>';
    }
  }
  function wireJobs() {
    var r = document.getElementById('jc-run');
    if (r) { r.addEventListener('click', async function (ev) { ev.preventDefault(); await S.requestJobRun('email-apply'); jobs = await S.loadJobRuns(); document.getElementById('tab-body').innerHTML = jobCard(); wireJobs(); }); }
    var t = document.getElementById('jc-toggle');
    if (t) { t.addEventListener('click', async function () { var paused = !!((jobs && jobs.control) || {}).paused; jobs.control = await S.saveJobControl({ paused: !paused, reason: paused ? '' : 'admin paused from the console' }); document.getElementById('tab-body').innerHTML = jobCard(); wireJobs(); }); }
  }

  /* ---------- boot ---------- */
  function boot() {
    if (!injectTabs()) { setTimeout(boot, 600); return; }
    var hash = (location.hash || '').replace('#', '');
    if (TABS.some(function (t) { return t.id === hash; })) { open(hash); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();
