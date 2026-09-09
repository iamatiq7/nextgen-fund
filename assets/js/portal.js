/* NextGen Fund — member portal */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  function numberFor(settings, method) {
    var pn = settings.paymentNumbers || {};
    if (method === 'bank') {
      var b = pn.bank || {};
      return [b.bankName, b.accountName, 'A/C ' + b.accountNumber, b.branch].filter(Boolean).join(' · ');
    }
    return pn[method] || L.t('por.numberNotSet');
  }

  async function run() {
    document.title = L.t('por.title2');
    var ctx = await C.requireRole(['member', 'admin'], 'login.html?next=portal.html');
    if (!ctx) return;
    C.renderHeader('portal.html');
    document.getElementById('mode-badge').innerHTML = C.modeBadge();
    var blocked = document.getElementById('portal-blocked');
    var content = document.getElementById('portal-content');

    var acc;
    try { acc = await S.getMyAccount(); }
    catch (e) { location.href = 'login.html'; return; }

    var p = acc.profile;
    if (p.status !== 'active') {
      content.classList.add('hide'); blocked.classList.remove('hide');
      blocked.innerHTML = '<div class="notice warn"><strong>' + U.esc(L.t('por.blockStatus', { s: p.status })) + '</strong> ' +
        (p.status === 'pending' ? U.esc(L.t('por.blockPending')) : U.esc(L.t('por.blockOther'))) + '</div>' +
        '<p><a class="btn ghost" href="index.html">' + U.esc(L.t('por.back')) + '</a></p>';
      return;
    }

    blocked.classList.add('hide'); content.classList.remove('hide');
    var b = acc.balance;
    document.getElementById('pf-hello').textContent = p.fullName;
    document.getElementById('pf-sub').textContent = L.t('por.memberSince', { u: p.username, j: U.fmtMonth(p.joinMonth || U.currentMonth()) });

    document.getElementById('bal-paid').textContent = U.fmtBDT(b.paid);
    document.getElementById('bal-paid-sub').textContent = L.t('por.paidSub', { amt: U.fmtBDT(b.expected) });
    document.getElementById('bal-due').textContent = U.fmtBDT(b.due);
    document.getElementById('bal-due-sub').textContent = b.due > 0
      ? L.t('por.dueSub', { e: U.fmtBDT(b.expected), p: U.fmtBDT(b.paidDue) })
      : L.t('por.dueOk');
    document.getElementById('bal-due-card').className = 'card stat ' + (b.due > 0 ? 'neg' : 'pos');
    document.getElementById('bal-advance').textContent = U.fmtBDT(b.advance);
    document.getElementById('bal-monthly').textContent = U.fmtBDT(p.monthlyDue);
    document.getElementById('bal-shares').textContent = L.t('por.sharesSub', {
      n: p.shares, s: p.shares === 1 ? '' : '', amt: U.fmtBDT((await S.getSettings()).monthlyPerShare || 1000)
    });

    /* profile */
    document.getElementById('profile-list').innerHTML =
      '<li><strong>' + U.esc(L.t('reg.name').replace(' *', '')) + '</strong> — ' + U.esc(p.fullName) + '</li>' +
      '<li><strong>' + U.esc(L.t('log.user').replace(' বা ইমেইল', '').replace(' or email', '')) + '</strong> — <span class="mono">' + U.esc(p.username) + '</span></li>' +
      '<li><strong>' + U.esc(L.t('reg.email').replace(' *', '')) + '</strong> — ' + U.esc(p.email) + '</li>' +
      '<li><strong>' + U.esc(L.t('reg.phone').replace(' *', '')) + '</strong> — ' + U.esc(p.phone || '—') + '</li>' +
      '<li><strong>' + U.esc(L.t('adm.mbShares')) + '</strong> — ' + p.shares + '</li>' +
      '<li><strong>' + U.esc(L.t('adm.mbStatus')) + '</strong> — ' + C.chip(p.status) + '</li>';

    /* history */
    var tb = document.querySelector('#pay-table tbody');
    if (!acc.payments.length) {
      tb.innerHTML = '<tr><td colspan="5"><div class="empty">' + U.esc(L.t('por.hEmpty')) + '</div></td></tr>';
    } else {
      tb.innerHTML = acc.payments.map(function (x) {
        return '<tr><td class="num">' + U.fmtDate(x.date) + '</td><td>' + (x.type === 'advance' ? '<span class="chip advance">' + U.esc(L.t('st.advance')) + '</span>' : U.esc(L.t('st.due'))) +
          '</td><td>' + U.esc(C.methodLabel(x.method)) + '<span class="sub"><br>ref ' + U.esc(x.ref || '—') + '</span></td>' +
          '<td class="n">' + U.fmtBDT(x.amount) + '</td><td>' + C.chip(x.status) +
          (x.status === 'rejected' && x.rejectReason ? '<span class="sub"><br>' + U.esc(x.rejectReason) + '</span>' : '') + '</td></tr>';
      }).join('');
    }
    document.getElementById('history-foot').textContent = L.t('por.hFoot', {
      n: acc.payments.length,
      v: acc.payments.filter(function (x) { return x.status === 'verified'; }).length,
      p: acc.payments.filter(function (x) { return x.status === 'pending'; }).length
    });

    /* pay form */
    var settings = await S.getSettings();
    var methodSel = document.getElementById('py-method');
    var numBox = document.getElementById('pay-numbers');
    function showNumber() {
      var m = methodSel.value;
      numBox.style.display = 'block';
      numBox.innerHTML = '<strong>' + U.esc(C.methodLabel(m)) + ':</strong> ' + U.esc(numberFor(settings, m)) +
        (m === 'cash' ? '' : '<br><span class="footnote">' + U.esc(L.t('por.sendFirst')) + '</span>');
    }
    methodSel.addEventListener('change', showNumber);
    showNumber();
    function refHint() {
      document.getElementById('py-ref-hint').textContent = methodSel.value === 'cash' ? L.t('por.refHintCash') : L.t('por.refHint');
      document.getElementById('py-ref').placeholder = methodSel.value === 'cash' ? '' : L.t('ph.ref');
    }
    methodSel.addEventListener('change', refHint); refHint();
    document.getElementById('py-date').value = U.todayISO();
    document.getElementById('py-date').max = U.todayISO();

    document.getElementById('pay-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var errBox = document.getElementById('pay-err');
      errBox.textContent = '';
      try {
        await S.submitPayment({
          type: document.getElementById('py-type').value,
          method: methodSel.value,
          amount: document.getElementById('py-amount').value,
          date: document.getElementById('py-date').value,
          ref: document.getElementById('py-ref').value.trim(),
          senderNumber: document.getElementById('py-sender').value.trim(),
          note: document.getElementById('py-note').value.trim()
        });
        C.toast(L.t('por.submitted'));
        run();
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
  }

  run().catch(function (e) {
    console.error(e);
    var el = document.getElementById('portal-blocked');
    if (el) { el.classList.remove('hide'); el.innerHTML = '<div class="notice bad">' + U.esc(L.t('por.loadErr', { m: e.message })) + '</div>'; }
  });
})();
