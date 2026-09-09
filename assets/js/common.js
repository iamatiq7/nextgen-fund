/* NextGen Fund — shared page chrome, language switch + session helpers (browser only) */
(function () {
  'use strict';
  var U = window.NGFUtil, S = window.NGFStore, L = window.NGFLANG;

  window.NGFCOMMON = {
    modeLabel: function () { return S.mode === 'firebase' ? L.t('mode.live') : L.t('mode.demo'); },
    isDemo: function () { return S.mode !== 'firebase'; },

    esc: U.esc, fmtBDT: U.fmtBDT, fmtDate: U.fmtDate, fmtMonth: U.fmtMonth, t: function (k, v) { return L.t(k, v); },

    chip: function (status) {
      var key = { pending: 'st.pending', verified: 'st.verified', rejected: 'st.rejected', active: 'st.active', approved: 'st.approved', suspended: 'st.suspended' }[status];
      return '<span class="chip ' + (key ? key.slice(3) : 'pending') + '">' + U.esc(key ? L.t(key) : status) + '</span>';
    },

    methodLabel: function (m) {
      var key = { bkash: 'm.bkash', nagad: 'm.nagad', rocket: 'm.rocket', upay: 'm.upay', bank: 'm.bank', cash: 'm.cash' }[m];
      return key ? L.t(key) : m;
    },

    toast: function (msg, bad) {
      var t = document.createElement('div');
      t.className = 'toast' + (bad ? ' bad' : '');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 3400);
    },

    modal: function (html) {
      var back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
      back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
      document.body.appendChild(back);
      return back;
    },

    confirmModal: function (title, body, okLabel, okClass) {
      return new Promise(function (resolve) {
        var m = NGFCOMMON.modal(
          '<h2>' + U.esc(title) + '</h2><p>' + U.esc(body) + '</p>' +
          '<div class="btn-row" style="justify-content:flex-end"><button class="btn subtle" data-x="no">' + U.esc(L.t('common.cancel')) + '</button>' +
          '<button class="btn ' + (okClass || '') + '" data-x="yes">' + U.esc(okLabel) + '</button></div>'
        );
        m.querySelector('[data-x=no]').onclick = function () { m.remove(); resolve(false); };
        m.querySelector('[data-x=yes]').onclick = function () { m.remove(); resolve(true); };
      });
    },

    requireRole: async function (roles, redirect) {
      var boot = await S.init();
      var s = await S.getSession();
      if (!s || (roles && roles.indexOf(s.role) < 0)) {
        location.href = redirect || 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop());
        return null;
      }
      return { session: s, mode: boot.mode };
    },

    renderHeader: function (active) {
      var el = document.getElementById('site-header');
      if (!el) return;
      var links = [
        ['index.html', 'nav.dashboard'],
        ['register.html', 'nav.register'],
        ['login.html', 'nav.login'],
        ['portal.html', 'nav.portal'],
        ['admin.html', 'nav.admin']
      ];
      var html = '<div class="bar">' +
        '<a class="brand" href="index.html">' +
        '<img class="mark" src="assets/img/logo.png" alt="' + U.esc(L.t('brand.name')) + '">' +
        '<span>' + U.esc(L.t('brand.name')) + ' <small>' + U.esc(L.t('brand.tag')) + '</small></span></a>' +
        '<nav class="nav" aria-label="Main">' +
        links.map(function (l) {
          return '<a href="' + l[0] + '" data-i18n="' + l[1] + '"' + (active === l[0] ? ' class="active" aria-current="page"' : '') + '></a>';
        }).join('') +
        '<button type="button" class="btn sm subtle lang-btn" id="lang-btn" title="English / বাংলা">' + U.esc(L.t('lang.other')) + '</button>' +
        '<span class="who" id="nav-who"></span>' +
        '<button class="btn sm subtle hide" id="nav-logout" data-i18n="nav.logout"></button>' +
        '</nav></div>';
      el.innerHTML = html;
      document.getElementById('lang-btn').onclick = function () { L.toggle(); location.reload(); };
      L.apply(el);

      S.getSession().then(function (s) {
        if (!s) return;
        var who = document.getElementById('nav-who');
        var out = document.getElementById('nav-logout');
        who.textContent = s.fullName + ' (' + s.role + ')';
        out.classList.remove('hide');
        out.onclick = async function () { await S.logout(); location.href = 'index.html'; };
      }).catch(function () {});
    },

    renderFooter: function () {
      var el = document.getElementById('site-footer');
      if (!el) return;
      el.innerHTML = '<div class="bar"><span>' + U.esc(L.t('footer.tag')) + '</span>' +
        '<span>' + U.esc(NGFCOMMON.modeLabel()) + '</span>' +
        '<span><a href="admin.html">' + U.esc(L.t('nav.admin')) + '</a> · <a href="setup.html">Setup</a></span></div>';
    },

    modeBadge: function () {
      return '<span class="chip ' + (S.mode === 'firebase' ? 'verified' : 'demo') + '">' + U.esc(NGFCOMMON.modeLabel()) + '</span>';
    },

    boot: async function (active) {
      var boot = await S.init();
      NGFCOMMON.renderHeader(active);
      NGFCOMMON.renderFooter();
      L.apply(document); // static page text
      return boot;
    }
  };
})();
