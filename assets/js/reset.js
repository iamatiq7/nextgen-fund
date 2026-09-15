/* ============================================================
   NextGen Fund - database reset screen (admin only)

   Deletes every application document, the two configuration
   documents, and optionally the admin's own sign-in account,
   leaving the app in first-run state (setup.html).

   Requires the v3 security rules - see
   docs/database-reset-runbook.md. Safe to run twice.
   ============================================================ */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return U.esc(String(v)); }

  var STORES = ['users', 'payments', 'registrations', 'audit', 'usernames', 'finance'];

  function table(inv) {
    var rows = STORES.map(function (k) {
      var v = inv[k];
      return '<tr><td><code>/' + esc(k) + '</code></td><td class="num">' +
        (v === null ? '—' : esc(v)) + '</td></tr>';
    }).join('');
    return '<div class="card"><h3>' + esc(L.t('rs.inventory')) + '</h3>' +
      '<table class="data"><thead><tr><th>' + esc(L.t('rs.what')) + '</th><th class="n">' + esc(L.t('rs.count')) + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="foot">' + esc(L.t('rs.pendingSkip')) + '</p></div>';
  }

  function gate(html) {
    el('reset-body').innerHTML = html;
  }

  async function run() {
    document.title = L.t('rs.title');
    await C.boot('reset.html');

    if (C.isDemo()) {
      gate('<div class="notice warn">' + esc(L.t('rs.notLive')) + '</div>');
      return;
    }

    var sess = null;
    try { sess = await S.getSession(); } catch (e) { sess = null; }
    if (!sess || sess.role !== 'admin') {
      gate('<div class="notice warn">' + esc(L.t('rs.needAdmin')) + '</div>' +
        '<p><a class="btn" href="login.html?next=reset.html">' + esc(L.t('rs.goLogin')) + '</a></p>');
      return;
    }

    var inv = {};
    try { inv = await S.resetInventory(); } catch (e) { inv = {}; }

    gate(table(inv) +
      '<div class="card">' +
      '<label class="f"><span>' + esc(L.t('rs.confirmLabel')) + '</span>' +
      '<input type="text" id="rs-word" autocomplete="off" placeholder="' + esc(L.t('rs.confirmPh')) + '" spellcheck="false"></label>' +
      '<label class="f" style="display:flex;gap:8px;align-items:flex-start">' +
      '<input type="checkbox" id="rs-account" style="margin-top:4px">' +
      '<span>' + esc(L.t('rs.alsoAccount')) + '</span></label>' +
      '<div id="rs-err" class="err" role="alert"></div>' +
      '<button class="btn" id="rs-go" type="button" disabled>' + esc(L.t('rs.wipe')) + '</button>' +
      '<p class="foot">' + esc(L.t('rs.backupHint')) + '</p>' +
      '<div id="rs-log" class="foot" style="white-space:pre-wrap;margin-top:10px"></div>' +
      '</div>');

    var word = el('rs-word'), go = el('rs-go'), err = el('rs-err'), log = el('rs-log');
    word.addEventListener('input', function () {
      var ok = word.value.trim() === 'RESET';
      go.disabled = !ok;
      err.textContent = ok ? '' : L.t('rs.wrongWord');
    });

    go.addEventListener('click', async function () {
      go.disabled = true;
      err.textContent = '';
      log.textContent = L.t('rs.running') + '\n';
      try {
        var report = await S.resetDatabase({
          deleteAccount: el('rs-account').checked,
          onProgress: function (line) { log.textContent += '· ' + line + '\n'; }
        });
        log.textContent += '\n' + L.t('rs.deleted') + ': ' + report.deleted + '\n';
        var bad = (report.errors || []).length;
        if (bad) {
          log.textContent += L.t('rs.errors') + '\n' + report.errors.join('\n') + '\n';
        }
        var denied = (report.errors || []).some(function (x) { return /permission|denied|insufficient/i.test(String(x)); });
        if (denied) {
          /* the classic stranded case: settings/bootstrap was released by an earlier run, so the
             admin's own rights are gone. Say so plainly and point at the way forward. */
          gate('<div class="notice warn"><strong>' + esc(L.t('rs.deniedTitle')) + '</strong><br>' + esc(L.t('rs.deniedBody')) + '</div>' +
            '<p><a class="btn" href="setup.html">' + esc(L.t('rs.toSetup')) + '</a>' +
            '<a class="btn ghost" href="admin.html" style="margin-left:6px">' + esc(L.t('rs.toAdmin')) + '</a></p>' +
            '<div class="card"><div class="foot" style="white-space:pre-wrap">' + esc(log.textContent) + '</div></div>');
          return;
        }
        var done = report.accountDeleted ? L.t('rs.doneAccount') : L.t('rs.done');
        gate('<div class="notice ok">' + esc(done) + '</div>' +
          '<p><a class="btn" href="setup.html">' + esc(L.t('rs.toSetup')) + '</a>' +
          '<a class="btn ghost" href="index.html" style="margin-left:6px">' + esc(L.t('rs.toDash')) + '</a></p>' +
          '<div class="card"><div class="foot" style="white-space:pre-wrap">' + esc(log.textContent) + '</div></div>');
      } catch (e) {
        err.textContent = e && e.message ? e.message : 'Reset failed';
        go.disabled = false;
      }
    });
  }

  run().catch(function (e) {
    el('reset-body').innerHTML = '<div class="err">' + esc((e && e.message) || 'Error') + '</div>';
  });
})();
