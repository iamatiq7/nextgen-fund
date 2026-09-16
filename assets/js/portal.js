/* NextGen Fund — member portal (clear payment flow) */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;
  var balance = null, payments = null, settings = null, profile = null;

  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
  function numberFor(method) {
    var pn = settings.paymentNumbers || {};
    if (method === 'bank') {
      var b = pn.bank || {};
      return [b.bankName, b.accountName, 'A/C ' + b.accountNumber, b.branch].filter(Boolean).join(' · ');
    }
    return pn[method] || L.t('por.numberNotSet');
  }

  /* ---------- renderers (called in place, no full reload) ---------- */
  function renderBalances() {
    var b = balance;
    set('bal-paid', U.fmtBDT(b.paid));
    set('bal-paid-sub', L.t('por.paidSub', { amt: U.fmtBDT(b.expected) }));
    set('bal-due', U.fmtBDT(b.due));
    var dueSub = b.due > 0
      ? L.t('por.dueSub', { e: U.fmtBDT(b.expected), p: U.fmtBDT((b.paid || 0) + (b.pending || 0)) })
      : (b.pendingDue > 0 ? L.t('por.dueCovered') : L.t('por.dueOk'));
    if ((b.pending || 0) > 0) dueSub += ' ' + L.t('por.pendingDue', { amt: U.fmtBDT(b.pending) });
    set('bal-due-sub', dueSub);
    document.getElementById('bal-due-card').className = 'card stat ' + (b.due > 0 ? 'tone-red' : 'tone-green');
    set('bal-advance', U.fmtBDT(b.advance));
    var advSub = document.getElementById('bal-advance-sub');
    if (advSub) {
      advSub.textContent = L.t('por.advanceSub') + ((b.advanceMonths || 0) > 0
        ? ' · ' + L.t('por.advanceMonths', { n: b.advanceMonths, s: b.advanceMonths > 1 ? 's' : '' }) : '');
    }
    set('bal-monthly', U.fmtBDT(profile.monthlyDue));
    set('bal-shares', L.t('por.sharesSub', { n: profile.shares, s: '', amt: U.fmtBDT(settings.monthlyPerShare || 1000) }));
    renderDueHint();
  }

  function renderDueHint() {
    var el = document.getElementById('py-due-hint');
    var type = document.getElementById('py-type').value;
    if (type === 'due' && balance.due > 0) {
      el.innerHTML = L.t('pay.dueSuggestion', { amt: '<strong>' + U.fmtBDT(balance.due) + '</strong>' }) +
        ' <button type="button" class="btn sm ghost" id="use-due">' + U.esc(L.t('pay.useDue', { amt: U.fmtBDT(balance.due) })) + '</button>';
      var btn = document.getElementById('use-due');
      if (btn) btn.onclick = function () { document.getElementById('py-amount').value = balance.due; };
    } else if (type === 'due') {
      el.textContent = (balance.pendingDue > 0) ? L.t('por.dueCovered') : L.t('por.dueOk');
    } else {
      el.textContent = '';
    }
  }

  function renderHistory() {
    var tb = document.querySelector('#pay-table tbody');
    if (!payments.length) {
      tb.innerHTML = '<tr><td colspan="5"><div class="empty">' + U.esc(L.t('por.hEmpty')) + '</div></td></tr>';
    } else {
      tb.innerHTML = payments.map(function (x) {
        return '<tr><td class="num">' + U.fmtDate(x.date) + '</td><td>' + (x.type === 'advance' ? '<span class="chip advance">' + U.esc(L.t('st.advance')) + '</span>' : U.esc(L.t('st.due'))) +
          '</td><td>' + U.esc(C.methodLabel(x.method)) + '<span class="sub"><br>ref ' + U.esc(x.ref || '—') + '</span></td>' +
          '<td class="n">' + U.fmtBDT(x.amount) + '</td><td>' + C.chip(x.status) +
          (x.status === 'rejected' && x.rejectReason ? '<span class="sub"><br>' + U.esc(x.rejectReason) + '</span>' : '') + '</td></tr>';
      }).join('');
    }
    var hStats = U.summarisePayments(payments);
    set('history-foot', L.t('por.hFoot', { n: hStats.counts.all, v: hStats.counts.verified, p: hStats.counts.pending }));
    var lg = document.getElementById('pay-legend');
    if (lg) lg.textContent = L.t('pay.legend');
  }

  function renderProfile() {
    document.getElementById('profile-list').innerHTML =
      '<li><strong>' + U.esc(L.t('reg.name').replace(' *', '')) + '</strong> — ' + U.esc(profile.fullName) + '</li>' +
      '<li><strong>' + U.esc(L.t('log.user').replace(' বা ইমেইল', '').replace(' or email', '')) + '</strong> — <span class="mono">' + U.esc(profile.username) + '</span></li>' +
      '<li><strong>' + U.esc(L.t('reg.email').replace(' *', '')) + '</strong> — ' + U.esc(profile.email) + '</li>' +
      '<li><strong>' + U.esc(L.t('reg.phone').replace(' *', '')) + '</strong> — ' + U.esc(profile.phone || '—') + '</li>' +
      '<li><strong>' + U.esc(L.t('adm.mbShares')) + '</strong> — ' + profile.shares + '</li>' +
      '<li><strong>' + U.esc(L.t('adm.mbStatus')) + '</strong> — ' + C.chip(profile.status) + '</li>';
  }

  function showNumber() {
    var m = document.getElementById('py-method').value;
    var numBox = document.getElementById('pay-numbers');
    numBox.style.display = 'flex';
    var numText = numberFor(m);
    var numPlaceholder = /XXXXXXX|update in Admin/i.test(numText);
    numBox.innerHTML =
      '<span><span class="k">' + U.esc(L.t('pay.sendTo')) + '</span><br><span class="num-inline">' + U.esc(numText) + '</span>' +
      (numPlaceholder ? '<span class="sub"><br>' + U.esc(L.t('pay.numberPlaceholder')) + '</span>' : '') + '</span>' +
      (m === 'cash' ? '' : '<span class="btn-row"><button type="button" class="btn sm ghost" id="copy-num">' + U.esc(L.t('pay.copy')) + '</button></span>');
    var btn = document.getElementById('copy-num');
    if (btn) btn.onclick = function () {
      var text = numberFor(m);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { C.toast(L.t('pay.copied')); }, function () { C.toast(text); });
      } else { C.toast(text); }
    };
  }

  async function run() {
    document.title = L.t('por.title2');
    var ctx = await C.requireRole(['member', 'admin'], 'login.html?next=portal.html');
    if (!ctx) return;
    C.renderHeader('portal.html');
    C.renderFooter();
    L.apply(document);
    document.getElementById('mode-badge').innerHTML = C.modeBadge();
    var blocked = document.getElementById('portal-blocked');
    var content = document.getElementById('portal-content');

    var acc;
    try { acc = await S.getMyAccount(); }
    catch (e) { location.href = 'login.html'; return; }

    profile = acc.profile;
    if (profile.status !== 'active') {
      content.classList.add('hide'); blocked.classList.remove('hide');
      blocked.innerHTML = '<div class="notice warn"><strong>' + U.esc(L.t('por.blockStatus', { s: profile.status })) + '</strong> ' +
        (profile.status === 'pending' ? U.esc(L.t('por.blockPending')) : U.esc(L.t('por.blockOther'))) + '</div>' +
        '<p><a class="btn ghost" href="index.html">' + U.esc(L.t('por.back')) + '</a></p>';
      return;
    }

    blocked.classList.add('hide'); content.classList.remove('hide');
    balance = acc.balance;
    payments = acc.payments;
    settings = await S.getSettings();

    set('pf-hello', profile.fullName);
    set('pf-sub', L.t('por.memberSince', { u: profile.username, j: U.fmtMonth(profile.joinMonth || U.currentMonth()) }));
    renderBalances();
    renderHistory();
    renderProfile();

    /* pay form wiring */
    var methodSel = document.getElementById('py-method');
    var typeSel = document.getElementById('py-type');
    showNumber();
    methodSel.addEventListener('change', function () { showNumber(); refHint(); });
    typeSel.addEventListener('change', function () { renderDueHint(); });
    refHint();
    document.getElementById('py-date').value = U.todayISO();
    document.getElementById('py-date').max = U.todayISO();

    function refHint() {
      set('py-ref-hint', document.getElementById('py-method').value === 'cash' ? L.t('por.refHintCash') : L.t('por.refHint'));
      document.getElementById('py-ref').placeholder = document.getElementById('py-method').value === 'cash' ? '' : L.t('ph.ref');
    }

    /* an admin session must not see the member payment form: the admin verifies, never pays */
    (async function () {
      try {
        var sess = await S.getSession();
        if (sess && sess.role === 'admin') {
          var form = document.getElementById('pay-form');
          var card = form && form.closest ? form.closest('.card') : null;
          if (card) {
            var box = document.createElement('div');
            box.className = 'notice warn';
            box.textContent = L.t('por.adminNoPay');
            card.parentNode.insertBefore(box, card);
            card.classList.add('hide');
          }
        }
      } catch (e) { /* not signed in: leave the form as it is */ }
    })();

    document.getElementById('pay-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var errBox = document.getElementById('pay-err');
      errBox.textContent = '';
      var doneBox = document.getElementById('pay-done');
      doneBox.classList.add('hide');
      try {
        await S.submitPayment({
          type: typeSel.value,
          method: methodSel.value,
          amount: document.getElementById('py-amount').value,
          date: document.getElementById('py-date').value,
          ref: document.getElementById('py-ref').value.trim(),
          senderNumber: document.getElementById('py-sender').value.trim(),
          note: document.getElementById('py-note').value.trim()
        });
        /* refresh data in place + show persistent status explanation */
        var fresh = await S.getMyAccount();
        balance = fresh.balance; payments = fresh.payments;
        renderBalances(); renderHistory();
        doneBox.innerHTML = '<strong>' + U.esc(L.t('pay.afterTitle')) + '</strong><br>' + U.esc(L.t('pay.afterText'));
        doneBox.classList.remove('hide');
        document.getElementById('py-amount').value = '';
        document.getElementById('py-ref').value = '';
        document.getElementById('py-note').value = '';
        doneBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        errBox.textContent = e.message || 'Error';
      }
    });

    /* change password */
    document.getElementById('pw-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var errBox = document.getElementById('pw-err');
      errBox.textContent = '';
      try {
        await S.changePassword(document.getElementById('pw-cur').value, document.getElementById('pw-new').value);
        C.toast(L.t('por.pwUpdated'));
        document.getElementById('pw-cur').value = ''; document.getElementById('pw-new').value = '';
      } catch (e) {
        errBox.textContent = e.message;
      }
    });

    /* live updates in Firebase mode: balance + history refresh automatically */
    try {
      if (S.onMyData) S.onMyData(function (fresh) {
        if (!fresh || !fresh.balance) return;
        balance = fresh.balance; payments = fresh.payments;
        renderBalances(); renderHistory();
      });
    } catch (e) { /* live off */ }
  }

  run().catch(function (e) {
    console.error(e);
    var el = document.getElementById('portal-blocked');
    if (el) { el.classList.remove('hide'); el.innerHTML = '<div class="notice bad">' + U.esc(L.t('por.loadErr', { m: e.message })) + '</div>'; }
  });
})();

/* ---- nominee change request: a member asks, an admin approves (added 2026-09-15) ---- */
(function () {
  'use strict';
  var S = window.NGFStore, C = window.NGFCOMMON, L = window.NGFLANG, U = window.NGFUtil;
  function el(id) { return document.getElementById(id); }
  function esc(s) { return U.esc(s); }

  async function init() {
    var box = el('nom-body');
    if (!box) return;
    try {
      await S.init();
      var s = await S.getSession();
      if (!s) { box.innerHTML = ''; return; }
      var acc = await S.getMyAccount().catch(function () { return null; });
      var profile = (acc && acc.profile) || {};
      /* the list of past requests is a nice extra: if the rules deny it we simply show none,
         and the member still sees the stored nominee block and the request form. */
      var mine = [];
      try {
        mine = (await S.listNomineeRequests()) || [];
        mine = mine.filter(function (r) { return r.memberId === (s.uid || profile.id || ''); });
      } catch (eList) { mine = []; }
      var latest = mine.slice().sort(function (a, b) { return String(b.requestedAt).localeCompare(String(a.requestedAt)); })[0];

      var status = '';
      if (latest && latest.status === 'pending') status = '<p class="notice">' + esc(L.t('por.nomPending')) + '</p>';
      else if (latest && latest.status === 'approved') status = '<p class="notice ok">' + esc(L.t('por.nomApproved', { d: U.fmtDate(latest.decidedAt) })) + '</p>';
      else if (latest && latest.status === 'rejected') status = '<p class="notice bad">' + esc(L.t('por.nomRejected', { d: U.fmtDate(latest.decidedAt) })) + '</p>';
      else status = '<p class="footnote">' + esc(L.t('por.nomNone')) + '</p>';

      var canAsk = !latest || latest.status !== 'pending';
      function line(label, value) {
        return '<li><span class="k">' + esc(label) + '</span> ' + (value ? esc(value) : '<span class="hint">-</span>') + '</li>';
      }
      var hasAny = profile.nominee || profile.nomineeRelation || profile.nomineePhone || profile.nomineeAddress;
      box.innerHTML =
        (hasAny
          ? '<ul class="clean">' + line(L.t('nom.name'), profile.nominee) + line(L.t('nom.relation'), profile.nomineeRelation) +
            line(L.t('nom.phone'), profile.nomineePhone) + line(L.t('nom.address'), profile.nomineeAddress) + '</ul>'
          : '<div class="empty">' + esc(L.t('nom.none')) + '</div>') +
        status +
        '<h3 style="margin-top:14px">' + esc(L.t('nom.reqTitle')) + '</h3><p class="footnote">' + esc(L.t('nom.hint')) + '</p>' +
        (canAsk ? (
          '<div class="grid two" style="margin-top:8px">' +
          '<label class="f"><span>' + esc(L.t('nom.name')) + '</span><input type="text" id="nom-name" maxlength="80"></label>' +
          '<label class="f"><span>' + esc(L.t('nom.relation')) + '</span><input type="text" id="nom-rel" maxlength="40"></label>' +
          '<label class="f"><span>' + esc(L.t('nom.phone')) + '</span><input type="tel" id="nom-phone" maxlength="11" inputmode="numeric" placeholder="01xxxxxx (11 digits, optional)"></label>' +
          '<label class="f"><span>' + esc(L.t('nom.address')) + '</span><input type="text" id="nom-addr" maxlength="120"></label>' +
          '<label class="f" style="grid-column:1/-1"><span>' + esc(L.t('nom.reason')) + '</span><input type="text" id="nom-why" maxlength="160"></label>' +
          '</div><div class="btn-row"><button class="btn" id="nom-send">' + esc(L.t('nom.send')) + '</button></div>' +
          '<p class="err" id="nom-err" role="alert"></p>'
        ) : '<p class="footnote">' + esc(L.t('nom.pending')) + '</p>');

      var btn = el('nom-send');
      if (btn) btn.onclick = async function () {
        var name = (el('nom-name').value || '').trim();
        var errBox = el('nom-err');
        errBox.textContent = '';
        if (name.length < 2) { errBox.textContent = L.t('v.required') || 'Name is required'; return; }
        btn.disabled = true;
        try {
          await S.createNomineeRequest({
            memberId: s.uid || profile.id || '', memberName: s.fullName, username: s.username || profile.username || '',
            currentNominee: profile.nominee || '',
            requestedNominee: name || profile.nominee || '',
            relation: (el('nom-rel').value || '').trim() || profile.nomineeRelation || '',
            requestedPhone: (el('nom-phone') && el('nom-phone').value || '').trim() || profile.nomineePhone || '',
            requestedAddress: (el('nom-addr') && el('nom-addr').value || '').trim() || profile.nomineeAddress || '',
            reason: (el('nom-why').value || '').trim()
          });
          C.toast(L.t('por.nomPending'));
          init();
        } catch (e) {
          var perm = e && /permission/i.test(String(e.code) + ' ' + String(e.message));
          errBox.textContent = (e && e.message === 'nominee-required') ? L.t('v.required')
            : (perm ? L.t('acc.noAccess') : String(e && e.message || e));
          btn.disabled = false;
        }
      };
    } catch (e) {
      /* never wipe the card with a raw error: keep it usable */
      box.innerHTML = '<div class="empty">' + esc(L.t('nom.none')) + '</div>' +
        '<p class="footnote">' + esc(L.t('nom.hint')) + '</p>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); });
  else setTimeout(init, 300);
  /* ================= member requests (nominee + account), cleaned 2026-09-16 =================
     Rules of this block:
       - one heading per area, never the same value twice on screen
       - the account change request lives INSIDE the existing Account settings card
       - the nominee card shows the stored block once, and the form starts empty
     Nothing is applied until the admin approves the request. */
  async function renderRequests() {
    var host = document.getElementById('portal-content');
    if (!host) return;
    if (document.getElementById('sec-nominee')) return;          /* idempotent: never render twice */
    var mine = await S.getMyAccount();
    var profile = (mine && mine.profile) || null;
    if (!profile) return;
    var esc = U.esc;
    var myName = profile.fullName || '';
    var myUser = profile.username || '';

    /* what is already waiting for the admin */
    var pendAccount = profile.pendingAccountRequest || null;   /* stored on the member's own record */
    try {
      var all = (await S.listNomineeRequests()) || [];
      for (var i = 0; i < all.length; i++) {
        var r = all[i];
        if (r.status !== 'pending' || String(r.memberId) !== String(profile.id || profile.uid || '')) continue;
        if (r.kind === 'account' && !pendAccount) pendAccount = r;
      }
    } catch (e) { /* no access to the list (or an empty fund): show nothing, never an error */ }

    /* the nominee card was removed on the owner's request: the outline in the
       screenshot marked that block. The stored nominee data stays in the record. */

    /* ---------- 2. account: the form is appended to the card that already lists the values ---------- */
    var cards = host.querySelectorAll('section.card');
    var accCard = null;
    for (var c = 0; c < cards.length; c++) {
      var h = cards[c].querySelector('h2[data-i18n="por.account"]');
      if (h) { accCard = cards[c]; break; }
    }
    var accForm =
      '<div id="acc-req" style="margin-top:18px">' +
        '<h3>' + esc(L.t('acc.send')) + '</h3>' +
        '<p class="footnote">' + esc(L.t('acc.hint')) + '</p>' +
        (pendAccount ? '<div class="notice">' + esc(L.t('acc.pendingRow', { list: (pendAccount.changes || []).map(function (x) { return L.t('acc.' + x.field) || x.field; }).join(', ') })) + '</div>' : '') +
        '<form id="acc-form" novalidate>' +
          '<div class="grid two">' +
            '<label class="f"><span>' + esc(L.t('acc.name')) + '</span><input type="text" id="ac-fullName"></label>' +
            '<label class="f"><span>' + esc(L.t('acc.username')) + '</span><input type="text" id="ac-username"></label>' +
            '<label class="f"><span>' + esc(L.t('acc.email')) + '</span><input type="email" id="ac-email"></label>' +
            '<label class="f"><span>' + esc(L.t('acc.phone')) + '</span><input type="tel" id="ac-phone" maxlength="11" inputmode="numeric" placeholder="01xxxxxx"></label>' +
            '<label class="f"><span>' + esc(L.t('acc.shares')) + '</span><input type="number" id="ac-shares" min="1" step="1"></label>' +
            '<label class="f" style="grid-column:1/-1"><span>' + esc(L.t('acc.reason')) + '</span><input type="text" id="ac-reason"></label>' +
          '</div>' +
          '<div id="ac-err" class="err" role="alert"></div><div id="ac-done" class="notice ok hide"></div>' +
          '<button class="btn" type="submit" id="ac-send">' + esc(L.t('acc.send')) + '</button>' +
        '</form>' +
      '</div>';
    if (accCard) accCard.insertAdjacentHTML('beforeend', accForm);
    else host.insertAdjacentHTML('beforeend', '<section class="card" style="margin-top:16px"><h2>' + esc(L.t('acc.title')) + '</h2>' + accForm + '</section>');

    /* ---------- wiring: the account change request ---------- */
    var af = document.getElementById('acc-form');
    if (af) af.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var e2 = document.getElementById('ac-err'), d2 = document.getElementById('ac-done');
      e2.textContent = ''; d2.classList.add('hide');
      var fields = ['fullName', 'username', 'email', 'phone', 'shares'];
      var payload = { memberName: myName, from_username: myUser, reason: document.getElementById('ac-reason').value.trim() };
      var changed = false;
      for (var i = 0; i < fields.length; i++) {
        var k = fields[i];
        var el = document.getElementById('ac-' + k);
        var v = el ? el.value.trim() : '';
        payload[k] = v;
        payload['from_' + k] = (profile[k] === undefined ? '' : String(profile[k]));
        if (v !== '' && v !== payload['from_' + k]) changed = true;
      }
      if (!changed) { e2.textContent = L.t('acc.reqEmpty'); return; }
      if (payload.phone && U.validPhone && !U.validPhone(payload.phone)) { e2.textContent = L.t('reg.errPhone'); return; }
      var b2 = document.getElementById('ac-send'); b2.disabled = true;
      try {
        await S.createAccountRequest(payload);
        d2.textContent = L.t('acc.reqSent'); d2.classList.remove('hide');
        af.reset();
      } catch (e) {
        var map = { 'username-taken': 'reg.errUserTaken' };
        if (e && map[e.code]) e2.textContent = L.t(map[e.code]);
        else if (e && /permission/i.test(String(e.code) + ' ' + String(e.message))) e2.textContent = L.t('acc.noAccess');
        else e2.textContent = (e && e.message) || L.t('acc.reqEmpty');
      } finally { b2.disabled = false; }
    });
  }

  /* ================= member sections (tabs), added 2026-09-16 =================
     The portal now works like the admin panel: a tab bar on top, one section at a time.
     Only what a member needs: Overview (balances), Payments (pay + history) and Account
     (profile, password, change request). The address bar keeps the section (#payments),
     so refresh, back and shared links land on the right place. */
  function sectionFromHash(h) {
    var t = String(h || '').replace(/^#/, '').toLowerCase();
    if (t === 'payments' || t === 'payment' || t === 'pay') return 'payments';
    if (t === 'account') return 'account';
    if (t === 'nominee') return 'nominee';
    return 'overview';
  }

  function setupSections() {
    var host = document.getElementById('portal-content');
    var bar = document.getElementById('portal-tabs');
    if (!host || !bar) return;
    if (bar.getAttribute('data-wired')) return;
    bar.setAttribute('data-wired', '1');

    /* group the existing cards - nothing is re-created, only shown or hidden */
    var cards = Array.prototype.slice.call(host.querySelectorAll('section.card, section.grid, div.row-flex'));
    var stats = host.querySelector('section.grid.stats');
    var payCard = document.getElementById('pay-card');
    var accountCard = null;
    var history = null;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.querySelector('h2[data-i18n="por.account"]')) accountCard = c;
      if (c.querySelector('#pay-table')) history = c;
    }
    /* the payment card and the history card sit in the same grid row: keep the wrapper too */
    var payRow = payCard ? payCard.parentNode : null;

    var nomBody = document.getElementById('nom-body');
    var nomineeCard = nomBody ? nomBody.closest('section.card') : null;
    var groups = {
      overview: [stats].filter(Boolean),
      nominee: [nomineeCard].filter(Boolean),
      payments: [payRow, history].filter(Boolean),
      account: [accountCard].filter(Boolean)
    };

    function show(name) {
      ['overview', 'payments', 'account', 'nominee'].forEach(function (k) {
        var list = groups[k] || [];
        for (var j = 0; j < list.length; j++) {
          var el = list[j];
          if (!el) continue;
          el.style.display = (k === name) ? '' : 'none';
        }
      });
      var btns = bar.querySelectorAll('button');
      for (var b = 0; b < btns.length; b++) {
        btns[b].setAttribute('aria-selected', String(btns[b].getAttribute('data-tab') === name));
      }
      try { if (location.hash !== '#' + name) history_push(name); } catch (e) { }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function history_push(name) {
      try { history.pushState(null, '', '#' + name); } catch (e) { location.hash = name; }
    }

    var btnsAll = bar.querySelectorAll('button');
    for (var q = 0; q < btnsAll.length; q++) {
      btnsAll[q].addEventListener('click', function (ev) {
        ev.preventDefault();
        show(this.getAttribute('data-tab'));
      });
    }
    window.addEventListener('hashchange', function () { show(sectionFromHash(location.hash)); });
    show(sectionFromHash(location.hash));
    bar.classList.remove('hide');
  }

  /* the portal fills its own cards asynchronously: wait for it, then add ours (once) */
  (function () {
    var tries = 0;
    var timer = setInterval(async function () {
      tries++;
      var host = document.getElementById('portal-content');
      var ready = host && !host.classList.contains('hide') && !document.getElementById('sec-nominee');
      if (ready) { try { await renderRequests(); } catch (e) { } try { setupSections(); } catch (e) { } }
      if (ready || tries > 40) clearInterval(timer);
    }, 250);
  })();
})();
