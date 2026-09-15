/* NextGen Fund — registration form with document upload */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;
  var pickedDocs = {};

  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function docField(kind, labelKey, required) {
    var wrap = document.createElement('label');
    wrap.className = 'f';
    wrap.innerHTML = '<span>' + U.esc(kind) + ' *</span>' +
      '<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" data-kind="' + U.esc(kind) + '">' +
      '<span class="hint" data-hint="' + U.esc(kind) + '">' + U.esc(L.t('reg.docHint')) + '</span>';
    wrap.querySelector('input').addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      var hint = wrap.querySelector('[data-hint]');
      if (!file) { delete pickedDocs[kind]; hint.textContent = L.t('reg.noFile'); return; }
      var bad = null;
      if (!/^image\/(png|jpe?g|webp)$|^application\/pdf$/.test(file.type)) bad = L.t('reg.badType');
      else if (file.size > S.docLimit()) bad = L.t('reg.tooBig', { sz: fmtSize(S.docLimit()) });
      if (bad) {
        hint.textContent = bad; hint.style.color = 'var(--loss)';
        ev.target.value = ''; delete pickedDocs[kind];
        return;
      }
      hint.style.color = '';
      var reader = new FileReader();
      reader.onload = function () {
        pickedDocs[kind] = { kind: kind, name: file.name, mime: file.type, size: file.size, data: reader.result, file: file };
        hint.textContent = L.t('reg.picked', { name: file.name, sz: fmtSize(file.size) });
      };
      reader.readAsDataURL(file);
    });
    return wrap;
  }

  async function run() {
    document.title = L.t('reg.title2');
    await C.boot('register.html');
    var settings = await S.getSettings();
    /* The owner asked for four named documents, uploaded to Google Drive under a folder named
     after the username. The keys double as the file names inside that folder. */
  var DOCS = [
    { key: 'nid-front', label: 'reg.docNidFront', required: true },
    { key: 'nid-back', label: 'reg.docNidBack', required: true },
    { key: 'profile-picture', label: 'reg.docPhoto', required: true },
    { key: 'nominee-passport-photo', label: 'reg.docNomineePhoto', required: true }
  ];
  var reqs = settings.docRequirements || [];
    var per = settings.monthlyPerShare || 1000;

    document.getElementById('reg-intro').innerHTML = '<strong>' + U.esc(L.t('reg.glance', { amt: U.fmtBDT(per) })) + '</strong>';

    var docsBox = document.getElementById('doc-fields');
    DOCS.forEach(function (d) {
      docsBox.appendChild(docField(d.key, d.label, d.required));
      reqs.push(d.key); /* the four named documents are mandatory */
    });
    /* anything the admin added in settings stays optional and keeps its own label */
    (settings.docRequirements || []).forEach(function (kind) {
      if (reqs.indexOf(kind) === -1) { docsBox.appendChild(docField(kind, null, false)); }
    });

    var sel = document.getElementById('rg-shares');
    Array.prototype.forEach.call(sel.options, function (o) {
      o.textContent = L.t('reg.shareN', {
        n: o.value, s: L.t(o.value === '1' ? 'reg.shareOne' : 'reg.shareMany'), amt: U.fmtBDT(o.value * per)
      });
    });

    var form = document.getElementById('reg-form');
    var errBox = document.getElementById('reg-err');
    var btn = document.getElementById('reg-btn');

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      errBox.textContent = '';
      var pw = document.getElementById('rg-pass').value;
      var pw2 = document.getElementById('rg-pass2').value;
      var docs = Object.keys(pickedDocs).map(function (k) { return pickedDocs[k]; });

      var data = {
        fullName: document.getElementById('rg-name').value.trim(),
        username: document.getElementById('rg-username').value.trim(),
        email: document.getElementById('rg-email').value.trim(),
        phone: document.getElementById('rg-phone').value.trim(),
        occupation: document.getElementById('rg-occupation').value.trim(),
        nominee: document.getElementById('rg-nominee').value.trim(),
        address: document.getElementById('rg-address').value.trim(),
        shares: sel.value,
        password: pw,
        docs: docs
      };

      var local = [];
      if (pw !== pw2) local.push(L.t('reg.errMatch'));
      /* Documents are optional while Firebase Storage is not enabled:
         the registration still goes through; the admin collects files directly. */
      var missing = reqs.filter(function (k) { return !pickedDocs[k]; });
      var docsMissingCount = missing.length;
      if (local.length) { errBox.textContent = local.join(' '); return; }

      btn.disabled = true; btn.textContent = L.t('reg.submit') + '…';
      try {
        await S.register(data);
        document.getElementById('register-main').innerHTML =
          '<span class="k">' + U.esc(L.t('reg.doneKicker')) + '</span><h1>' + U.esc(L.t('reg.doneTitle', { name: data.fullName })) + '</h1>' +
          '<div class="notice ok"><strong>' + U.esc(L.t('reg.pending')) + '</strong></div>' +
          '<div class="card"><ul class="clean">' +
          '<li><strong>' + U.esc(L.t('reg.doneUser')) + '</strong> <span class="mono">' + U.esc(data.username) + '</span> — ' + U.esc(L.t('reg.doneUserNote')) + '</li>' +
          '<li><strong>' + U.esc(L.t('reg.doneDocs')) + '</strong> ' + docs.length + ' ' + U.esc(L.t('reg.doneFiles')) + (docsMissingCount ? ' (' + docsMissingCount + ' pending - give them to the admin directly)' : '') + '.</li>' +
          '<li><strong>' + U.esc(L.t('reg.doneNext')) + '</strong> ' + U.esc(L.t('reg.doneNextText')) + '</li>' +
          '</ul></div><p><a class="btn ghost" href="index.html">' + U.esc(L.t('reg.back')) + '</a></p>';
      } catch (e) {
        errBox.textContent = e.message || 'Error';
        btn.disabled = false; btn.textContent = L.t('reg.submit');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  run().catch(function (e) { console.error(e); });
})();
