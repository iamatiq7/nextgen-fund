/* NGF — admin: download the documents that travel inside a registration record.
   Loaded by admin.html after admin.js. Adds one row of download links under every
   "documents" button in the registrations tab, for each document that was stored in the
   record itself (Drive links are opened by the existing viewer). */
(function () {
  'use strict';
  var S = window.NGFStore, L = window.NGFLANG;

  function fileName(kind, name) {
    var ext = (String(name || '').match(/\.([a-z0-9]{2,4})$/i) || [, 'jpg'])[1];
    return kind + '.' + ext.toLowerCase();
  }

  async function decorate() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-docs]'));
    if (!buttons.length) return;
    var regs = [];
    try { regs = (await S.listRegistrations()) || []; } catch (e) { return; }
    buttons.forEach(function (b) {
      if (b.getAttribute('data-decorated')) return;
      var reg = regs.filter(function (r) { return r.id === b.getAttribute('data-docs'); })[0];
      var docList = (reg && reg.docs) || [];
      var stored = docList.filter(function (d) { return d && d.dataUrl; });
      if (!stored.length) { b.setAttribute('data-decorated', '1'); return; }
      var box = document.createElement('span');
      box.className = 'doc-links';
      box.style.cssText = 'display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:8px;vertical-align:middle';
      stored.forEach(function (d) {
        var a = document.createElement('a');
        a.className = 'btn sm ghost';
        a.href = d.dataUrl;
        a.setAttribute('download', fileName(d.kind, d.name));
        a.textContent = '⬇ ' + fileName(d.kind, d.name);
        a.title = (L ? L.t('adm.rgStored') || '' : '') + ' ' + (d.name || '');
        box.appendChild(a);
      });
      b.parentNode.insertBefore(box, b.nextSibling);
      b.setAttribute('data-decorated', '1');
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tab="registrations"], [data-go="registrations"]') : null;
    if (t) setTimeout(decorate, 900);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(decorate, 1400); });
  else setTimeout(decorate, 1400);
})();
