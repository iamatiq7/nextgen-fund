/* NextGen Fund — first-run admin setup */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  async function run() {
    document.title = L.t('su.title2');
    await C.boot('setup.html');
    var body = document.getElementById('setup-body');

    var exists = await S.adminExists();
    if (exists) {
      body.innerHTML =
        '<div class="notice ok">' + U.esc(L.t('su.exists')) + '</div>' +
        '<div class="card"><p>' + U.esc(L.t('su.existsText')) + '</p>' +
        '<p><a class="btn" href="login.html?next=admin.html">' + U.esc(L.t('su.goLogin')) + '</a>' +
        '<a class="btn ghost" href="index.html" style="margin-left:6px">' + U.esc(L.t('su.toDash')) + '</a></p>' +
        '<p class="foot">' + U.esc(L.t('su.existsFoot')) + '</p></div>';
      return;
    }

    body.innerHTML =
      '<div class="notice warn"><strong>' + U.esc(L.t('su.none')) + '</strong>' +
      (C.isDemo() ? U.esc(L.t('su.demoNote')) : U.esc(L.t('su.fbNote'))) + '</div>' +
      '<form id="su-form" class="card" novalidate>' +
      '<label class="f"><span>' + U.esc(L.t('su.user')) + '</span><input type="text" id="su-user" value="admin" autocomplete="username"></label>' +
      '<label class="f"><span>' + U.esc(L.t('su.name')) + '</span><input type="text" id="su-name" placeholder="' + U.esc(L.t('ph.setupName')) + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('su.email')) + '</span><input type="email" id="su-email" placeholder="' + U.esc(L.t('ph.setupEmail')) + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('su.pass')) + '</span><input type="password" id="su-pass" autocomplete="new-password" placeholder="' + U.esc(L.t('ph.passNew')) + '"></label>' +
      '<div id="su-err" class="err" role="alert"></div>' +
      '<button class="btn" type="submit">' + U.esc(L.t('su.create')) + '</button>' +
      '</form>';

    document.getElementById('su-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = document.getElementById('su-err');
      err.textContent = '';
      try {
        await S.setupAdmin({
          username: document.getElementById('su-user').value.trim() || 'admin',
          fullName: document.getElementById('su-name').value.trim(),
          email: document.getElementById('su-email').value.trim(),
          password: document.getElementById('su-pass').value
        });
        body.innerHTML = '<div class="notice ok"><strong>' + U.esc(L.t('su.created')) + '</strong></div>' +
          '<p><a class="btn" href="login.html?next=admin.html">' + U.esc(L.t('su.goAdmin')) + '</a></p>';
      } catch (e) {
        err.textContent = e.message;
      }
    });
  }

  run().catch(function (e) {
    document.getElementById('setup-body').innerHTML = '<div class="err">' + (e.message || 'Error') + '</div>';
  });
})();
