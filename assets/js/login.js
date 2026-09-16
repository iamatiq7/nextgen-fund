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
        var withTimeout = function (pr, ms) {
          return Promise.race([pr, new Promise(function (_, rej) {
            setTimeout(function () { rej(new Error(L.t('fb.timeout'))); }, ms);
          })]);
        };
        var sess = await withTimeout(S.login(idf, pw), 25000);
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

/* ---------------- forgot / reset password ----------------
   The member enters an e-mail, a username or the mobile number they registered with; the app
   resolves that to the account e-mail and asks Firebase to send the reset link. */
(function () {
  var link = document.getElementById('pw-link');
  var card = document.getElementById('pw-card');
  var send = document.getElementById('pw-send');
  var cancel = document.getElementById('pw-cancel');
  if (!link || !card || !send) return;
  var input = document.getElementById('pw-id');
  var errBox = document.getElementById('pw-err');
  var doneBox = document.getElementById('pw-done');

  link.addEventListener('click', function (ev) {
    ev.preventDefault();
    card.classList.remove('hide');
    errBox.textContent = '';
    doneBox.classList.add('hide');
    input.focus();
  });
  if (cancel) cancel.addEventListener('click', function () { card.classList.add('hide'); });

  send.addEventListener('click', async function () {
    errBox.textContent = '';
    doneBox.classList.add('hide');
    var idf = (input.value || '').trim();
    if (!idf) { errBox.textContent = L.t('log.resetEmpty'); return; }
    send.disabled = true;
    try {
      var r = await S.requestPasswordReset(idf);
      doneBox.innerHTML = U.esc(L.t('log.resetSent', { email: r.sentTo || '' }));
      doneBox.classList.remove('hide');
      input.value = '';
    } catch (e) {
      errBox.textContent = (e && e.message) || L.t('log.resetErr');
    } finally {
      send.disabled = false;
    }
  });
})();
