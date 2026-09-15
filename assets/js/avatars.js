/* NextGen Fund - avatars and the profile-picture view.
   Puts a member's picture wherever that member is shown and lets an admin open it full size.

   Where the picture comes from (in this order, so members who registered before the photo field
   existed still show their uploaded picture - no data migration needed):
     1. users/{uid}.photo        - set when somebody registers or is approved
     2. their registration's "profile-picture" document - the file the applicant uploaded
     3. the initials of the name - a missing picture never shows a broken image
   A reference may be a Drive file id, a Drive link, an https link or a data: URL.

   Privacy: member pictures are only ever resolved on the admin panel (S.listMembers /
   S.listRegistrations are admin-only in the security rules, so a non-admin simply cannot read
   them) and on the portal for the signed-in member's own record. */
(function () {
  'use strict';
  var U = window.NGFUtil, S = window.NGFStore, C = window.NGFCOMMON, L = window.NGFLANG;
  if (!U || !S || !C) return;

  var t = function (key, fallback) { try { var v = L && L.t(key); return (v && v !== key) ? v : fallback; } catch (e) { return fallback; } };

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
      img.addEventListener('error', function () {
        img.remove();                                   /* the initials stay visible */
        console.warn('avatar: the picture could not be loaded for ' + (name || 'a member') + ' - showing initials');
        el.setAttribute('data-av-failed', '1');
      });
      img.src = src;
      el.appendChild(img);
    }
    return el;
  }
  C.avatarEl = avatarEl;

  function photoOfDocs(docs) {
    var d = (docs || []).filter(function (x) { return x && x.kind === 'profile-picture'; })[0];
    if (!d) return '';
    return d.driveFileId || d.driveUrl || d.dataUrl || d.data || '';
  }
  function driveFileId(ref) {
    var v = String(ref || '');
    if (/^[-\w]{25,}$/.test(v)) return v;
    var m = v.match(/[-\\w]{25,}/);
    return m ? m[0] : '';
  }
  function sourceLabel(ref) {
    if (!ref) return t('av.srcNone', 'No picture has been uploaded for this member yet.');
    if (/^data:/i.test(ref)) return t('av.srcRecord', 'Stored with the registration record.');
    if (driveFileId(ref)) return t('av.srcDrive', 'Stored in the member\u2019s Google Drive folder.');
    return t('av.srcLink', 'Stored as an image link.');
  }
  function nameOf(x) { return (x && (x.fullName || x.username || x.email)) || ''; }

  /* ---------- the profile picture view ---------- */
  function openProfile(member, ref, extra) {
    if (C.modalHijack) { }
    var id = ref ? driveFileId(ref) : '';
    var open = id ? 'https://drive.google.com/file/d/' + id + '/view' : (ref && /^https?:/i.test(ref) && !/^data:/i.test(ref) ? ref : '');
    var dl = id ? 'https://drive.google.com/uc?export=download&id=' + id : (/^data:/i.test(ref) ? ref : '');
    var rows = [
      [t('av.username', 'Username'), member.username || '-'],
      [t('av.email', 'Email'), member.email || '-'],
      [t('av.phone', 'Mobile'), member.phone || '-'],
      [t('av.shares', 'Shares'), member.shares != null ? member.shares : '-'],
      [t('av.status', 'Status'), member.status || '-']
    ].map(function (r) {
      return '<li><strong>' + U.esc(r[0]) + '</strong> \u2014 ' + U.esc(String(r[1])) + '</li>';
    }).join('');
    var pic = ref
      ? '<img class="pf-big" src="' + U.esc(U.photoSrc(ref)) + '" alt="' + U.esc(nameOf(member)) + '" loading="eager" onerror="this.replaceWith(document.createTextNode(\'\'))">'
      : '<span class="av" style="width:132px;height:132px;font-size:44px">' + U.esc(U.initials(nameOf(member))) + '</span>';
    C.modal('<h2>' + U.esc(nameOf(member)) + '</h2>' +
      '<div class="pf-view">' + pic +
      '<div class="pf-meta"><p class="footnote"><strong>' + U.esc(t('av.title', 'Profile picture')) + '</strong><br>' + U.esc(sourceLabel(ref)) + '</p>' +
      '<ul class="clean">' + rows + '</ul>' +
      (extra ? '<p class="foot">' + U.esc(extra) + '</p>' : '') +
      '<div class="btn-row">' +
      (open ? '<a class="btn sm" href="' + U.esc(open) + '" target="_blank" rel="noopener">' + U.esc(t('av.open', 'Open full size')) + '</a>' : '') +
      (dl ? '<a class="btn sm ghost" href="' + U.esc(dl) + '" download="' + U.esc((member.username || 'member') + '-profile-picture.jpg') + '">' + U.esc(t('av.download', 'Download')) + '</a>' : '') +
      '</div></div></div>' +
      '<p class="foot">' + U.esc(t('av.identityFoot', 'Reference: username {u} \u00b7 the picture above belongs to this record only.', { u: member.username || '' })) + '</p>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" onclick="this.closest(\'.modal-back\').remove()">' + U.esc(t('common.close', 'Close')) + '</button></div>');
    var mb = document.querySelector('.modal-back img.pf-big');
    if (mb && !mb.complete) console.info('avatar: loading the full-size picture for ' + (member.username || ''));
  }

  function attachOpen(box, member, ref, extra) {
    if (!box || box.getAttribute('data-av-open')) return;
    box.setAttribute('data-av-open', '1');
    box.style.cursor = 'pointer';
    box.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openProfile(member, ref, extra); });
  }

  function explicit(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-av-ref]'), function (box) {
      if (box.getAttribute('data-av-done')) return;
      box.setAttribute('data-av-done', '1');
      box.innerHTML = '';
      box.appendChild(avatarEl(box.getAttribute('data-av-ref'), box.getAttribute('data-av-name') || '', parseInt(box.getAttribute('data-av-px') || '36', 10)));
    });
  }

  /* ---------- admin: member table ---------- */
  async function adminMembers() {
    var table = document.querySelector('table.data');
    if (!table || !table.querySelector('td.mono')) return;
    var members, regs;
    try { members = await S.listMembers(); } catch (e) { return; }
    try { regs = await S.listRegistrations(); } catch (e) { regs = []; }
    if (!members || !members.length) return;
    var byUser = {}, reg = {};
    members.forEach(function (m) { if (m && m.username) byUser[String(m.username).toLowerCase()] = m; });
    (regs || []).forEach(function (r) {
      if (!r) return;
      if (r.username) reg[String(r.username).toLowerCase()] = r;
      if (r.email) reg[String(r.email).toLowerCase()] = r;
    });
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      var cell = tr.querySelector('td.mono');
      if (!cell) return;
      var key = String(cell.textContent || '').trim().toLowerCase();
      var m = byUser[key];
      if (!m) return;
      var r = reg[key] || reg[String(m.email || '').toLowerCase()];
      var ref = m.photo || photoOfDocs(r && r.docs);
      var first = tr.querySelector('td');
      if (!first) return;
      if (!tr.querySelector('.av')) first.insertBefore(avatarEl(ref, m.fullName || m.username, 32), first.firstChild);
      var av = first.querySelector('.av');
      attachOpen(av, m, ref, r && !m.photo ? t('av.fromRegistration', 'Taken from this member\u2019s registration (before approval).') : '');
    });
  }

  /* ---------- admin: registrations ---------- */
  async function adminRegistrations() {
    var buttons = document.querySelectorAll('[data-docs]');
    if (!buttons.length) return;
    var regs;
    try { regs = await S.listRegistrations(); } catch (e) { return; }
    var byId = {};
    (regs || []).forEach(function (r) { byId[r.id] = r; });
    Array.prototype.forEach.call(buttons, function (b) {
      var tr = b.closest('tr');
      if (!tr) return;
      var r = byId[b.getAttribute('data-docs')];
      if (!r) return;
      var ref = photoOfDocs(r.docs);
      var first = tr.querySelector('td');
      if (first && !tr.querySelector('.av')) first.insertBefore(avatarEl(ref, r.fullName, 32), first.firstChild);
      var av = first && first.querySelector('.av');
      attachOpen(av, { fullName: r.fullName, username: r.username, email: r.email, phone: r.phone, shares: r.shares, status: r.status }, ref, t('av.fromRegistration', 'Taken from this member\u2019s registration (before approval).'));
    });
  }

  /* ---------- portal: the signed-in member ---------- */
  async function portalSelf() {
    var list = document.getElementById('profile-list');
    if (!list || list.querySelector('.av')) return;
    var acc;
    try { acc = await S.getMyAccount(); } catch (e) { return; }
    if (!acc || !acc.profile) return;
    var p = acc.profile;
    var li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:center;gap:10px';
    var av = avatarEl(p.photo, p.fullName || p.username, 56);
    li.appendChild(av);
    var span = document.createElement('span');
    span.innerHTML = '<strong>' + U.esc(p.fullName || '') + '</strong><br><span class="mono">' + U.esc(p.username || '') + '</span>';
    li.appendChild(span);
    list.insertBefore(li, list.firstChild);
    attachOpen(av, p, p.photo, p.photo ? '' : t('av.srcNone', 'No picture has been uploaded for this member yet.'));
  }

  async function decorate() {
    explicit(document);
    await adminMembers();
    await adminRegistrations();
    await portalSelf();
  }
  window.NGFAVATARS = { decorate: decorate, avatarEl: avatarEl, openProfile: openProfile, photoOfDocs: photoOfDocs };

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tab], [data-go]') : null;
    if (el) setTimeout(decorate, 900);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(decorate, 1200); });
  else setTimeout(decorate, 1200);
  window.addEventListener('load', function () { setTimeout(decorate, 1600); });
})();
