/* NextGen Fund - avatars.
   One small module that puts a member's uploaded profile picture wherever that member is shown,
   with the initials of the name as a built-in fallback (a missing or broken picture never shows
   a broken-image icon).

   Where it looks
     1. any element carrying data-av-ref="<ref>" data-av-name="<name>"  (explicit hook)
     2. the member portal: the profile card of the signed-in member
     3. the admin member list: each row is matched to a member by its username cell
     4. the admin registrations list: each row's profile-picture document, before approval
   A "ref" may be a Drive file id, a Drive link, an https link or a data: URL. */
(function () {
  'use strict';
  var U = window.NGFUtil, S = window.NGFStore, C = window.NGFC;
  if (!U || !S || !C) return;

  function avatarEl(ref, name, px) {
    var size = px || 36;
    var el = document.createElement('span');
    el.className = 'av';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.fontSize = Math.max(10, Math.round(size / 2.6)) + 'px';
    el.textContent = U.initials(name);
    if (name) el.title = name;
    var src = U.photoSrc ? U.photoSrc(ref) : '';
    if (src) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', function () { img.remove(); }); /* initials stay visible */
      img.src = src;
      el.appendChild(img);
    }
    return el;
  }
  C.avatarEl = avatarEl;

  function explicit(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-av-ref]'), function (box) {
      if (box.getAttribute('data-av-done')) return;
      box.setAttribute('data-av-done', '1');
      box.innerHTML = '';
      box.appendChild(avatarEl(box.getAttribute('data-av-ref'), box.getAttribute('data-av-name') || '', parseInt(box.getAttribute('data-av-px') || '36', 10)));
    });
  }

  function photoOfDocs(docs) {
    var d = (docs || []).filter(function (x) { return x && x.kind === 'profile-picture'; })[0];
    if (!d) return '';
    return d.driveFileId || d.driveUrl || d.dataUrl || d.data || '';
  }

  /* admin: member table - match rows by the username cell */
  async function adminMembers() {
    var table = document.querySelector('table.data');
    if (!table || !table.querySelector('td.mono')) return;
    var members;
    try { members = await S.listMembers(); } catch (e) { return; }
    if (!members || !members.length) return;
    var byUser = {};
    members.forEach(function (m) { if (m && m.username) byUser[String(m.username).toLowerCase()] = m; });
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      if (tr.querySelector('.av')) return;
      var cell = tr.querySelector('td.mono');
      if (!cell) return;
      var m = byUser[String(cell.textContent || '').trim().toLowerCase()];
      if (!m) return;
      var first = tr.querySelector('td');
      if (first) first.insertBefore(avatarEl(m.photo, m.fullName || m.username, 32), first.firstChild);
    });
  }

  /* admin: registrations - the applicant's uploaded picture, straight from the registration */
  async function adminRegistrations() {
    var buttons = document.querySelectorAll('[data-docs]');
    if (!buttons.length) return;
    var regs;
    try { regs = await S.listRegistrations(); } catch (e) { return; }
    var byId = {};
    (regs || []).forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(buttons, function (b) {
      var tr = b.closest('tr');
      if (!tr || tr.querySelector('.av')) return;
      var r = byId[b.getAttribute('data-docs')];
      if (!r) return;
      var first = tr.querySelector('td');
      if (first) first.insertBefore(avatarEl(photoOfDocs(r.docs), r.fullName, 32), first.firstChild);
    });
  }

  /* portal: the signed-in member's own profile card */
  async function portalSelf() {
    var list = document.getElementById('profile-list');
    if (!list || list.querySelector('.av')) return;
    var acc;
    try { acc = await S.getMyAccount(); } catch (e) { return; }
    if (!acc || !acc.profile) return;
    var li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:10px';
    li.appendChild(avatarEl(acc.profile.photo, acc.profile.fullName || acc.profile.username, 56));
    var span = document.createElement('span');
    span.innerHTML = '<strong>' + U.esc(acc.profile.fullName || '') + '</strong><br><span class="mono">' + U.esc(acc.profile.username || '') + '</span>';
    li.appendChild(span);
    list.insertBefore(li, list.firstChild);
  }

  async function decorate() {
    explicit(document);
    await adminMembers();
    await adminRegistrations();
    await portalSelf();
  }

  /* the admin panel re-renders its tabs on the fly, so re-run after tab switches too */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tab], [data-go]') : null;
    if (t) setTimeout(decorate, 900);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(decorate, 1200); });
  else setTimeout(decorate, 1200);
  window.addEventListener('load', function () { setTimeout(decorate, 1600); });
})();
