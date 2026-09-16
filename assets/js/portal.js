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
      var mine = (await S.listNomineeRequests()) || [];
      mine = mine.filter(function (r) { return r.memberId === (s.uid || profile.id || ''); });
      var latest = mine.slice().sort(function (a, b) { return String(b.requestedAt).localeCompare(String(a.requestedAt)); })[0];

      var status = '';
      if (latest && latest.status === 'pending') status = '<p class="notice">' + esc(L.t('por.nomPending')) + '</p>';
      else if (latest && latest.status === 'approved') status = '<p class="notice ok">' + esc(L.t('por.nomApproved', { d: U.fmtDate(latest.decidedAt) })) + '</p>';
      else if (latest && latest.status === 'rejected') status = '<p class="notice bad">' + esc(L.t('por.nomRejected', { d: U.fmtDate(latest.decidedAt) })) + '</p>';
      else status = '<p class="footnote">' + esc(L.t('por.nomNone')) + '</p>';

      var canAsk = !latest || latest.status !== 'pending';
      box.innerHTML =
        '<p><strong>' + esc(L.t('por.nomCurrent')) + ':</strong> ' + esc(profile.nominee || '—') + '</p>' + status +
        (canAsk ? (
          '<div class="grid two" style="margin-top:8px">' +
          '<label class="f"><span>' + esc(L.t('por.nomNew')) + '</span><input type="text" id="nom-name" maxlength="80"></label>' +
          '<label class="f"><span>' + esc(L.t('por.nomRelation')) + '</span><input type="text" id="nom-rel" maxlength="40"></label>' +
          '<label class="f" style="grid-column:1/-1"><span>' + esc(L.t('por.nomReason')) + '</span><input type="text" id="nom-why" maxlength="160"></label>' +
          '</div><div class="btn-row"><button class="btn" id="nom-send">' + esc(L.t('por.nomSubmit')) + '</button></div>' +
          '<p class="err" id="nom-err" role="alert"></p>'
        ) : '');

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
            currentNominee: profile.nominee || '', requestedNominee: name,
            relation: (el('nom-rel').value || '').trim(), reason: (el('nom-why').value || '').trim()
          });
          C.toast(L.t('por.nomPending'));
          init();
        } catch (e) {
          errBox.textContent = (e && e.message === 'nominee-required') ? L.t('v.required') : String(e && e.message || e);
          btn.disabled = false;
        }
      };
    } catch (e) {
      box.innerHTML = '<p class="footnote">' + esc(String(e && e.message || e)) + '</p>';
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
    var pendNominee = 0, pendAccount = null;
    try {
      var all = (await S.listNomineeRequests()) || [];
      for (var i = 0; i < all.length; i++) {
        var r = all[i];
        if (r.status !== 'pending' || String(r.memberId) !== String(profile.id || profile.uid || '')) continue;
        if (r.kind === 'account') { if (!pendAccount) pendAccount = r; } else { pendNominee++; }
      }
    } catch (e) { /* a read problem must not empty the page */ }

    /* ---------- 1. nominee: stored values shown once, then an empty request form ---------- */
    function line(label, value) {
      return '<li><span class="k">' + esc(label) + '</span> ' + (value ? esc(value) : '<span class="hint">-</span>') + '</li>';
    }
    var nomineeCard =
      '<section class="card" id="sec-nominee" style="margin-top:16px">' +
        '<h2>' + esc(L.t('nom.title')) + '</h2>' +
        '<p class="footnote">' + esc(L.t('nom.hint')) + '</p>' +
        '<ul class="clean">' +
          line(L.t('nom.name'), profile.nominee) + line(L.t('nom.relation'), profile.nomineeRelation) +
          line(L.t('nom.phone'), profile.nomineePhone) + line(L.t('nom.address'), profile.nomineeAddress) +
        '</ul>' +
        (pendNominee ? '<div class="notice">' + esc(L.t('nom.pending')) + '</div>' : '') +
        '<h3>' + esc(L.t('nom.reqTitle')) + '</h3>' +
        '<form id="nom-form" novalidate>' +
          '<div class="grid two">' +
            '<label class="f"><span>' + esc(L.t('nom.name')) + '</span><input type="text" id="nm-name"></label>' +
            '<label class="f"><span>' + esc(L.t('nom.relation')) + '</span><input type="text" id="nm-rel"></label>' +
            '<label class="f"><span>' + esc(L.t('nom.phone')) + '</span><input type="tel" id="nm-phone" maxlength="11" inputmode="numeric" placeholder="01xxxxxx (11 digits, optional)"></label>' +
            '<label class="f" style="grid-column:1/-1"><span>' + esc(L.t('nom.address')) + '</span><input type="text" id="nm-addr" placeholder="Village/Street, Thana, District"></label>' +
            '<label class="f" style="grid-column:1/-1"><span>' + esc(L.t('nom.reason')) + '</span><input type="text" id="nm-reason"></label>' +
          '</div>' +
          '<div id="nm-err" class="err" role="alert"></div><div id="nm-done" class="notice ok hide"></div>' +
          '<button class="btn" type="submit" id="nm-send">' + esc(L.t('nom.send')) + '</button>' +
        '</form>' +
      '</section>';
    host.insertAdjacentHTML('beforeend', nomineeCard);

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

    /* ---------- wiring: nominee ---------- */
    var nf = document.getElementById('nom-form');
    if (nf) nf.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var e1 = document.getElementById('nm-err'), d1 = document.getElementById('nm-done');
      e1.textContent = ''; d1.classList.add('hide');
      var want = {
        requestedNominee: document.getElementById('nm-name').value.trim(),
        relation: document.getElementById('nm-rel').value.trim(),
        requestedPhone: document.getElementById('nm-phone').value.trim(),
        requestedAddress: document.getElementById('nm-addr').value.trim()
      };
      if (!want.requestedNominee && !want.relation && !want.requestedPhone && !want.requestedAddress) { e1.textContent = L.t('nom.reqEmpty'); return; }
      if (want.requestedPhone && U.validPhone && !U.validPhone(want.requestedPhone)) { e1.textContent = L.t('reg.errNomineePhone') || L.t('nom.reqEmpty'); return; }
      var b1 = document.getElementById('nm-send'); b1.disabled = true;
      try {
        await S.createNomineeRequest({
          memberName: myName, username: myUser, currentNominee: profile.nominee || '',
          requestedNominee: want.requestedNominee || profile.nominee || '',
          relation: want.relation || profile.nomineeRelation || '',
          requestedPhone: want.requestedPhone || profile.nomineePhone || '',
          requestedAddress: want.requestedAddress || profile.nomineeAddress || '',
          reason: document.getElementById('nm-reason').value.trim()
        });
        d1.textContent = L.t('nom.reqSent'); d1.classList.remove('hide');
        nf.reset();
      } catch (e) { e1.textContent = (e && e.message) || L.t('nom.reqEmpty'); }
      finally { b1.disabled = false; }
    });

    /* ---------- wiring: account ---------- */
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
        e2.textContent = (e && map[e.code]) ? L.t(map[e.code]) : ((e && e.message) || L.t('acc.reqEmpty'));
      } finally { b2.disabled = false; }
    });
  }

  /* the portal fills its own cards asynchronously: wait for it, then add ours (once) */
  (function () {
    var tries = 0;
    var timer = setInterval(async function () {
      tries++;
      var host = document.getElementById('portal-content');
      var ready = host && !host.classList.contains('hide') && !document.getElementById('sec-nominee');
      if (ready) { try { await renderRequests(); } catch (e) { } }
      if (ready || tries > 40) clearInterval(timer);
    }, 250);
  })();
})();
