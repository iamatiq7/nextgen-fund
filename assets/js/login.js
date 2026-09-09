/* NextGen Fund — login */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  async function run() {
    document.title = L.t('log.title2');
    await C.boot('login.html');

    var s = await S.getSession();
    if (s) { location.href = s.role === 'admin' ? 'admin.html' : 'portal.html'; return; }

    if (C.isDemo()) {
      document.getElementById('demo-note').innerHTML =
        '<div class="notice"><strong>' + U.esc(L.t('log.demoNote')) + '</strong></div>';
    }

    var form = document.getElementById('login-form');
    var errBox = document.getElementById('login-err');
    var btn = document.getElementById('login-btn');

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      errBox.textContent = '';
      var idf = document.getElementById('li-user').value.trim();
      var pw = document.getElementById('li-pass').value;
      if (!idf || !pw) { errBox.textContent = L.t('log.errBoth'); return; }
      btn.disabled = true; btn.textContent = L.t('log.loggingIn');
      try {
        var sess = await S.login(idf, pw);
        var next = new URLSearchParams(location.search).get('next');
        if (sess.role === 'admin') location.href = next && next !== 'portal.html' ? next : 'admin.html';
        else location.href = next || 'portal.html';
      } catch (e) {
        errBox.textContent = e.message || L.t('err.wrong');
        btn.disabled = false; btn.textContent = L.t('log.btn');
      }
    });
  }

  run().catch(function (e) { console.error(e); });
})();
