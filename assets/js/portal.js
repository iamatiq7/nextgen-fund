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
})();
