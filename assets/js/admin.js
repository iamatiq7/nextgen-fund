/* NextGen Fund — admin panel (full access, EN/BN) */
(function () {
  'use strict';
  var GUIDE_URL = 'https://github.com/iamatiq7/nextgen-fund/blob/main/docs/firebase_setup_bn.md';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  var state = { tab: 'overview', payFilter: 'pending' };
  var body;

  /* ---------------- overview ---------------- */
  async function tabOverview() {
    var regs = await S.listRegistrations('pending');
    /* counts come from the shared summariser - never from a hand-made filter */
    var stats = await S.paymentStats();
    var rawStats = U.summarisePayments(await S.listPayments());
    var members = await S.listMembers();
    var snap = await S.getPublicSnapshot();
    var dueTotal = members.reduce(function (a, m) { return a + m.balance.due; }, 0);
    var pendC = stats.counts.pending, pendA = stats.amounts.pending;
    var membersPaid = members.reduce(function (a, m) { return a + (m.balance.paid || 0); }, 0);
    var unassigned = rawStats.amounts.verified - membersPaid;
    /* the numbers shown must equal a fresh scan of the raw records */
    var statsMatch = rawStats.counts.pending === stats.counts.pending &&
      rawStats.counts.verified === stats.counts.verified &&
      rawStats.counts.rejected === stats.counts.rejected &&
      rawStats.amounts.all === stats.amounts.all;
    var nice = {
      pc: stats.counts.pending, pa: U.fmtBDT(stats.amounts.pending),
      vc: stats.counts.verified, va: U.fmtBDT(stats.amounts.verified),
      rc: stats.counts.rejected, ra: U.fmtBDT(stats.amounts.rejected),
      ac: stats.counts.all, aa: U.fmtBDT(stats.amounts.all)
    };
    body.innerHTML =
      '<section class="grid stats" style="margin-bottom:16px">' +
      stat('adm.ovPendingRegs', regs.length, 'adm.ovPendingRegsSub', 'blue') +
      stat('adm.ovPendingPays', pendC, 'adm.ovPendAmt', 'red', { amt: U.fmtBDT(pendA) }) +
      stat('adm.ovMembers', members.length, '', 'green') +
      stat('adm.ovDueTotal', U.fmtBDT(dueTotal), 'adm.ovDueSub', 'yellow') +
      '</section>' +
      '<div class="grid two">' +
      '<div class="card"><h2>' + U.esc(L.t('adm.ovDoNext')) + '</h2><ul class="clean">' +
      '<li><a href="#" data-go="registrations">' + U.esc(L.t('adm.ovGoRegs', { n: regs.length })) + '</a></li>' +
      '<li><a href="#" data-go="payments">' + U.esc(pendC ? L.t('adm.ovGoPays', { n: pendC }) : L.t('adm.ovGoPaysNone')) + '</a></li>' +
      '<li><a href="#" data-go="finance">' + U.esc(L.t('adm.ovGoFinance')) + '</a></li>' +
      '<li><a href="#" data-go="settings">' + U.esc(L.t('adm.ovGoSettings')) + '</a></li>' +
      '</ul></div>' +
      '<div class="card"><h2>' + U.esc(L.t('adm.ovQuick')) + '</h2><ul class="clean">' +
      '<li>' + U.esc(L.t('idx.funding')) + ' — <strong class="num">' + U.fmtBDT(snap.totalFunding) + '</strong></li>' +
      '<li>' + U.esc(L.t('adm.ovRevenueTotal')) + ' — <strong class="num">' + U.fmtBDT(snap.totalRevenue) + '</strong></li>' +
      '<li>' + U.esc(L.t('adm.ovLossTotal')) + ' — <strong class="num">' + U.fmtBDT(snap.totalLoss) + '</strong></li>' +
      '<li>' + U.esc(L.t('adm.ovNet')) + ' — <strong class="num">' + U.fmtBDT(snap.net) + '</strong></li>' +
      '<li>' + U.esc(L.t('adm.ovMeeting')) + ' — <strong>' + (snap.nextMeeting ? U.fmtDate(snap.nextMeeting) : U.esc(L.t('adm.ovNotSet'))) + '</strong></li>' +
      '</ul></div></div>' +
      '<div class="card" style="margin-top:16px"><h2>' + U.esc(L.t('adm.ovCheck')) + '</h2>' +
      '<p class="num">' + U.esc(L.t('adm.ovCheckLine', nice)) + '</p>' +
      '<p class="foot">' + U.esc(L.t('adm.ovCheckSum', { v: U.fmtBDT(rawStats.amounts.verified), d: U.fmtBDT(membersPaid), diff: U.fmtBDT(unassigned) })) + '</p>' +
      '<p class="foot">' + U.esc(L.t('adm.ovCheckSumNote')) + '</p>' +
      (rawStats.duplicates.length ? '<p class="foot">' + U.esc(L.t('adm.ovCheckDup', { n: rawStats.duplicates.length })) + '</p>' : '') +
      (pendC ? '<p class="foot">' + U.esc(L.t('adm.ovCheckOldest', { d: U.fmtDate(rawStats.pendingOldest) })) + '</p>' : '') +
      '<p style="margin-top:10px"><span class="chip ' + (statsMatch ? 'clear' : 'rejected') + '">' + U.esc(L.t(statsMatch ? 'adm.ovCheckOk' : 'adm.ovCheckBad')) + '</span></p>' +
      '</div>';
    body.querySelectorAll('[data-go]').forEach(function (a) {
      a.addEventListener('click', function (ev) { ev.preventDefault(); selectTab(a.getAttribute('data-go')); });
    });
  }
  function stat(k, v, s, tone, params) {
    return '<div class="card stat' + (tone ? ' tone-' + tone : '') + '"><span class="k">' + U.esc(L.t(k)) + '</span><span class="v num">' + v + '</span>' + (s ? '<span class="s">' + U.esc(L.t(s, params || {})) + '</span>' : '') + '</div>';
  }

  /* ---------------- registrations ---------------- */
  async function tabRegistrations() {
    var pending = await S.listRegistrations('pending');
    var done = (await S.listRegistrations()).filter(function (r) { return r.status !== 'pending'; });
    body.innerHTML =
      '<h2>' + U.esc(L.t('adm.rgPending', { n: pending.length })) + '</h2>' +
      (pending.length ? '<div class="tablewrap"><table class="data"><thead><tr>' +
        ['adm.rgApplicant', 'adm.rgUsername', 'adm.rgContact', 'adm.rgShares', 'adm.rgSubmitted', 'adm.rgActions'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        pending.map(function (r) {
          return '<tr><td><strong>' + U.esc(r.fullName) + '</strong><span class="sub"><br>' + U.esc(r.occupation || '') + (r.nominee ? ' · ' + U.esc(L.t('adm.rgNominee', { n: r.nominee })) : '') + '</span></td>' +
            '<td class="mono">' + U.esc(r.username) + '</td><td>' + U.esc(r.email) + '<span class="sub"><br>' + U.esc(r.phone) + '</span></td>' +
            '<td class="n">' + r.shares + '</td><td>' + U.fmtDate(r.createdAt) + '</td>' +
            '<td><div class="btn-row"><button class="btn sm ghost" data-docs="' + r.id + '">' + U.esc(L.t('adm.rgDocs', { n: (r.docs || []).length })) + '</button>' +
            '<button class="btn sm ok" data-approve="' + r.id + '">' + U.esc(L.t('adm.rgAccept')) + '</button>' +
            '<button class="btn sm danger" data-reject="' + r.id + '">' + U.esc(L.t('adm.rgReject')) + '</button></div></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + U.esc(L.t('adm.rgEmpty')) + '</div>') +
      '<h2 style="margin-top:22px">' + U.esc(L.t('adm.rgDecided', { n: done.length })) + '</h2>' +
      (done.length ? '<div class="tablewrap"><table class="data"><thead><tr>' +
        ['adm.rgApplicant', 'adm.rgDecision', 'adm.rgDecidedAt', 'adm.rgBy', 'adm.rgNote'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        done.map(function (r) {
          return '<tr><td>' + U.esc(r.fullName) + ' <span class="sub">(' + U.esc(r.username) + ')</span></td><td>' + C.chip(r.status) + '</td>' +
            '<td>' + U.fmtDate(r.decidedAt) + '</td><td>' + U.esc(r.decidedBy || '') + '</td><td>' + U.esc(r.note || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="footnote">' + U.esc(L.t('adm.rgNoDecisions')) + '</p>');

    body.querySelectorAll('[data-docs]').forEach(function (b) {
      b.addEventListener('click', function () { viewDocs(b.getAttribute('data-docs')); });
    });
    body.querySelectorAll('[data-approve]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var ok = await C.confirmModal(L.t('adm.rgAcceptQ'), L.t('adm.rgAcceptB'), L.t('adm.rgAccept'), 'ok');
        if (!ok) return;
        await S.decideRegistration(b.getAttribute('data-approve'), true, '');
        C.toast(L.t('adm.rgAccepted')); refresh();
      });
    });
    body.querySelectorAll('[data-reject]').forEach(function (b) {
      b.addEventListener('click', function () { rejectReg(b.getAttribute('data-reject')); });
    });
  }
  function rejectReg(id) {
    var m = C.modal('<h2>' + U.esc(L.t('adm.rgRejectT')) + '</h2><p class="footnote">' + U.esc(L.t('adm.rgRejectB')) + '</p>' +
      '<label class="f"><span>' + U.esc(L.t('adm.rgReason')) + '</span><input type="text" id="rj-note" placeholder="' + U.esc(L.t('adm.rgReasonPh')) + '"></label>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn subtle" data-x="no">' + U.esc(L.t('common.cancel')) + '</button><button class="btn danger" data-x="yes">' + U.esc(L.t('adm.rgReject')) + '</button></div>');
    m.querySelector('[data-x=no]').onclick = function () { m.remove(); };
    m.querySelector('[data-x=yes]').onclick = async function () {
      await S.decideRegistration(id, false, m.querySelector('#rj-note').value.trim());
      m.remove(); C.toast(L.t('adm.rgRejected')); refresh();
    };
  }
  function docView(d) {
    /* a record may hold: a Drive file (driveFileId/driveUrl), the shrunk copy inside the record
       (dataUrl - what happens while Storage is off), a Storage path, or the legacy d.data */
    var thumb = '', open = '', dl = '', note = '';
    var ref = d.driveFileId || (d.driveUrl ? (String(d.driveUrl).match(/[-\w]{25,}/) || [''])[0] : '');
    if (ref) {
      thumb = U.photoSrc ? U.photoSrc(ref) : '';
      open = d.driveUrl || ('https://drive.google.com/file/d/' + ref + '/view');
      dl = 'https://drive.google.com/uc?export=download&id=' + ref;
      note = L.t('adm.rgInDrive');
    } else if (d.dataUrl || d.data) {
      thumb = d.dataUrl || d.data;
      open = thumb; dl = thumb;
      note = L.t('adm.rgStored');
    } else if (d.path) {
      note = L.t('adm.rgStored') + ' ' + d.path;
    } else {
      note = L.t('adm.rgNoFile');
    }
    var isPdf = String(d.mime || '').indexOf('pdf') >= 0;
    var fname = (d.kind || 'document') + '.' + ((String(d.name || '').match(/\.([a-z0-9]{2,4})$/i) || [0, 'jpg'])[1].toLowerCase());
    var html = '<li><div class="doc-row">';
    if (thumb && !isPdf) html += '<img class="doc-thumb" src="' + thumb + '" alt="' + U.esc(d.kind || '') + '" loading="lazy" onerror="this.style.display=\'none\'">';
    if (thumb && isPdf) html += '<span class="doc-ico">PDF</span>';
    html += '<div class="doc-meta"><strong>' + U.esc(d.kind || 'document') + '</strong> <span class="mono">' + U.esc(fname) + '</span>' +
      '<span class="sub">' + U.esc(d.name || '') + (d.size ? ' - ' + U.esc(L.t('adm.rgKB', { kb: Math.max(1, Math.round(d.size / 1024)) })) : '') + '<br>' + U.esc(note) + '</span>' +
      '<div class="btn-row" style="margin-top:6px">' +
      (open ? '<a class="btn sm" href="' + open + '" target="_blank" rel="noopener">' + U.esc(L.t('adm.rgOpen')) + '</a>' : '') +
      (dl ? '<a class="btn sm ghost" href="' + dl + '" download="' + U.esc(fname) + '">' + U.esc(L.t('adm.rgDownload')) + '</a>' : '') +
      '</div></div></div></li>';
    return html;
  }

  async function viewDocs(regId) {
    var regs = await S.listRegistrations();
    var r = regs.find(function (x) { return x.id === regId; });
    if (!r) return;
    var list = (r.docs || []);
    var docs = list.length
      ? list.map(docView).join('')
      : '<li><strong>' + U.esc(L.t('adm.rgNoDocs')) + '</strong></li>';
    var missing = ((await S.getSettings()).docRequirements || []).filter(function (label) {
      return !list.some(function (d) { return String(d.name || d.kind || '').toLowerCase().indexOf(String(label).split(' ')[0].toLowerCase()) >= 0; });
    });
    C.modal('<h2>' + U.esc(L.t('adm.rgDocsT', { name: r.fullName })) + '</h2>' +
      '<p class="footnote">' + U.esc(L.t('adm.rgDocsCount', { n: list.length })) + '</p>' +
      '<ul class="clean doc-view">' + docs + '</ul>' +
      (missing.length && list.length ? '<p class="foot">' + U.esc(L.t('adm.rgMissing', { list: missing.join(', ') })) + '</p>' : '') +
      '<p class="foot">' + U.esc(L.t('adm.rgApplicantFoot', { name: r.fullName, email: r.email, phone: r.phone })) + '</p>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" onclick="this.closest(\'.modal-back\').remove()">' + U.esc(L.t('common.close')) + '</button></div>');
    if (U.trackDocAccess) U.trackDocAccess(regId, 'viewed');
  }

  /* ---------------- payments ---------------- */
  async function tabPayments() {
    var stats = await S.paymentStats();
    var list = await S.listPayments(state.payFilter === 'all' ? null : { status: state.payFilter });
    var counts = stats.counts;
    var members = await S.listMembers();
    var dupKeys = {};
    stats.duplicates.forEach(function (d) { dupKeys[String(d.memberId || d.memberName || '?') + '|' + String(d.ref || '').trim().toLowerCase()] = true; });

    body.innerHTML =
      '<div class="card" style="margin-bottom:12px"><h2>' + U.esc(L.t('adm.ovCheck')) + '</h2>' +
      '<p class="num">' + U.esc(L.t('adm.ovCheckLine', {
        pc: stats.counts.pending, pa: U.fmtBDT(stats.amounts.pending),
        vc: stats.counts.verified, va: U.fmtBDT(stats.amounts.verified),
        rc: stats.counts.rejected, ra: U.fmtBDT(stats.amounts.rejected),
        ac: stats.counts.all, aa: U.fmtBDT(stats.amounts.all)
      })) + '</p></div>' +
      (stats.duplicates.length
        ? '<div class="notice warn" style="margin-bottom:12px"><strong>' + U.esc(L.t('adm.pyDupTitle')) + '</strong><ul class="clean">' +
          stats.duplicates.map(function (d) {
            return '<li>' + U.esc(L.t('adm.pyDupLine', { name: d.memberName || d.memberId || '', ref: d.ref, n: d.count, amt: U.fmtBDT(d.amount) })) + '</li>';
          }).join('') + '</ul><p class="foot">' + U.esc(L.t('adm.pyDupNote')) + '</p></div>'
        : '') +
      '<div class="row-flex" style="margin-bottom:12px">' +
      ['pending', 'verified', 'rejected', 'all'].map(function (f) {
        var n = counts[f] || 0;
        var label = f === 'all' ? L.t('adm.pyAll') : L.t('st.' + f);
        return '<button class="btn sm ' + (state.payFilter === f ? '' : 'subtle') + '" data-f="' + f + '">' + U.esc(label) + ' (' + n + ')</button>';
      }).join('') +
      '<span style="margin-left:auto"></span><button class="btn sm ghost" id="add-pay">' + U.esc(L.t('adm.pyManual')) + '</button></div>' +
      (list.length ? '<div class="tablewrap"><table class="data"><thead><tr>' +
        ['adm.pyMember', 'adm.pyType', 'adm.pyMethod', 'adm.pyAmount', 'adm.pyDate', 'adm.pyRef', 'adm.pyStatus', 'adm.pyActions'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        list.map(function (p) {
          var mem = members.find(function (m) { return m.id === p.memberId; });
          return '<tr><td><strong>' + U.esc(p.memberName) + '</strong>' + (mem && mem.phone ? '<span class="sub"><br>' + U.esc(mem.phone) + '</span>' : '') + '</td><td>' + (p.type === 'advance' ? U.esc(L.t('st.advance')) : U.esc(L.t('st.due'))) + '</td>' +
            '<td>' + U.esc(C.methodLabel(p.method)) + '<span class="sub"><br>' + U.esc(p.senderNumber || '') + '</span></td>' +
            '<td class="n">' + U.fmtBDT(p.amount) + '</td><td class="num">' + U.fmtDate(p.date) + '</td>' +
            '<td class="mono">' + U.esc(p.ref || '—') + (dupKeys[String(p.memberId || p.memberName || '?') + '|' + String(p.ref || '').trim().toLowerCase()] ? ' <span class="chip pending">' + U.esc(L.t('adm.pyDupChip')) + '</span>' : '') + '</td><td>' + C.chip(p.status) +
            (p.status === 'verified' ? '<span class="sub"><br>' + U.esc(L.t('adm.pyBy', { b: p.verifiedBy || '' })) + '</span>' : '') + '</td>' +
            '<td>' + (p.status === 'pending'
              ? '<div class="btn-row"><button class="btn sm ok" data-v="' + p.id + '">' + U.esc(L.t('adm.pyVerify')) + '</button><button class="btn sm danger" data-r="' + p.id + '">' + U.esc(L.t('adm.pyReject')) + '</button></div>'
              : '<span class="footnote">' + (p.rejectReason ? U.esc(p.rejectReason) : '—') + '</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + U.esc(L.t('adm.pyNo', { f: state.payFilter })) + '</div>');

    body.querySelectorAll('[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { state.payFilter = b.getAttribute('data-f'); refresh(); });
    });
    body.querySelectorAll('[data-v]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await S.verifyPayment(b.getAttribute('data-v'));
        C.toast(L.t('adm.pyVerified')); refresh();
      });
    });
    body.querySelectorAll('[data-r]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = C.modal('<h2>' + U.esc(L.t('adm.pyRejectT')) + '</h2><label class="f"><span>' + U.esc(L.t('adm.pyRejectReason')) + '</span><input type="text" id="rj-pay" placeholder="' + U.esc(L.t('adm.pyRejectPh')) + '"></label>' +
          '<div class="btn-row" style="justify-content:flex-end"><button class="btn subtle" data-x="no">' + U.esc(L.t('common.cancel')) + '</button><button class="btn danger" data-x="yes">' + U.esc(L.t('adm.pyReject')) + '</button></div>');
        m.querySelector('[data-x=no]').onclick = function () { m.remove(); };
        m.querySelector('[data-x=yes]').onclick = async function () {
          await S.rejectPayment(b.getAttribute('data-r'), m.querySelector('#rj-pay').value.trim());
          m.remove(); C.toast(L.t('adm.pyRejected')); refresh();
        };
      });
    });
    document.getElementById('add-pay').addEventListener('click', function () {
      var m = C.modal('<h2>' + U.esc(L.t('adm.pyManualT')) + '</h2><p class="footnote">' + U.esc(L.t('adm.pyManualB')) + '</p>' +
        '<label class="f"><span>' + U.esc(L.t('adm.pyMember')) + '</span><select id="ap-member">' + members.map(function (x) { return '<option value="' + x.id + '">' + U.esc(x.fullName) + ' (' + U.esc(x.username) + ')</option>'; }).join('') + '</select></label>' +
        '<div class="grid form2"><label class="f"><span>' + U.esc(L.t('adm.pyMType')) + '</span><select id="ap-type"><option value="due">' + U.esc(L.t('st.due')) + '</option><option value="advance">' + U.esc(L.t('st.advance')) + '</option></select></label>' +
        '<label class="f"><span>' + U.esc(L.t('adm.pyMMethod')) + '</span><select id="ap-method">' + S.METHODS.map(function (x) { return '<option value="' + x + '">' + U.esc(C.methodLabel(x)) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>' + U.esc(L.t('adm.pyMAmount')) + '</span><input type="number" id="ap-amount" min="1"></label>' +
        '<label class="f"><span>' + U.esc(L.t('adm.pyMDate')) + '</span><input type="date" id="ap-date" value="' + U.todayISO() + '"></label>' +
        '<label class="f" style="grid-column:1/-1"><span>' + U.esc(L.t('adm.pyMRef')) + '</span><input type="text" id="ap-ref"></label></div>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn subtle" data-x="no">' + U.esc(L.t('common.cancel')) + '</button><button class="btn" data-x="yes">' + U.esc(L.t('adm.pyMRecord')) + '</button></div>');
      m.querySelector('[data-x=no]').onclick = function () { m.remove(); };
      m.querySelector('[data-x=yes]').onclick = async function () {
        try {
          await S.addManualPayment({
            memberId: m.querySelector('#ap-member').value, type: m.querySelector('#ap-type').value,
            method: m.querySelector('#ap-method').value, amount: m.querySelector('#ap-amount').value,
            date: m.querySelector('#ap-date').value, ref: m.querySelector('#ap-ref').value.trim()
          });
          m.remove(); C.toast(L.t('adm.pyMRecorded')); refresh();
        } catch (e) { C.toast(e.message, true); }
      };
    });
  }

  /* ---------------- members ---------------- */
  async function tabMembers() {
    var members = await S.listMembers();
    /* Advance audit: who holds credit, and who has paid more than billed.
       These are exactly the accounts the old (buggy) formula showed as 0. */
    var withAdv = members.filter(function (m) { return m.balance.advance > 0; });
    var advTotal = withAdv.reduce(function (a, m) { return a + m.balance.advance; }, 0);
    var overpaid = members.filter(function (m) { return m.balance.paid > m.balance.expected; });
    var audit = '<div class="card" style="max-width:980px"><h2>' + U.esc(L.t('adm.advAudit')) + '</h2>' +
      '<p class="footnote">' + (withAdv.length
        ? U.esc(L.t('adm.advAuditLine', { n: withAdv.length, amt: U.fmtBDT(advTotal), over: overpaid.length }))
        : U.esc(L.t('adm.advAuditNone'))) + '</p>' +
      (withAdv.length ? '<p class="footnote mono">' + withAdv.map(function (m) { return U.esc(m.username) + ' = ' + U.fmtBDT(m.balance.advance); }).join(' · ') + '</p>' : '') +
      '</div>';
    body.innerHTML =
      audit +
      (members.length ? '<div class="tablewrap"><table class="data"><thead><tr>' +
        ['adm.mbName', 'adm.rgUsername', 'adm.mbShares', 'adm.mbMonthly', 'adm.mbPaid', 'adm.mbDue', 'adm.mbAdvance', 'adm.mbStatus', 'adm.rgActions'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        members.map(function (m) {
          return '<tr><td><strong>' + U.esc(m.fullName) + '</strong><span class="sub"><br>' + U.esc(m.phone || '—') + '</span></td>' +
            '<td class="mono">' + U.esc(m.username) + '</td><td class="n">' + m.shares + '</td><td class="n">' + U.fmtBDT(m.monthlyDue) + '</td>' +
            '<td class="n">' + U.fmtBDT(m.balance.paid) + '</td><td class="n">' + (m.balance.due > 0 ? '<strong style="color:var(--loss)">' + U.fmtBDT(m.balance.due) + '</strong>' : '—') + '</td>' +
            '<td class="n">' + (m.balance.advance ? U.fmtBDT(m.balance.advance) : '—') + '</td><td>' + C.chip(m.status) + '</td>' +
            '<td><div class="btn-row"><button class="btn sm ghost" data-view="' + m.id + '">' + U.esc(L.t('common.detail')) + '</button>' +
            '<button class="btn sm subtle" data-edit="' + m.id + '">' + U.esc(L.t('common.edit')) + '</button></div></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">' + U.esc(L.t('adm.mbNone')) + '</div>');

    body.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var d = await S.getMemberDetail(b.getAttribute('data-view'));
        C.modal('<h2>' + U.esc(d.profile.fullName) + '</h2>' +
          '<p class="footnote">' + U.esc(L.t('por.paid')) + ' <strong class="num">' + U.fmtBDT(d.balance.paid) + '</strong> · ' +
          U.esc(L.t('por.due')) + ' <strong class="num">' + U.fmtBDT(d.balance.due) + '</strong> · ' +
          U.esc(L.t('por.advance')) + ' <strong class="num">' + U.fmtBDT(d.balance.advance) + '</strong> (' +
          U.esc(L.t('por.paidSub', { amt: U.fmtBDT(d.balance.expected) })) + ')</p>' +
          '<div class="tablewrap" style="max-height:320px;overflow:auto"><table class="data"><thead><tr>' +
          ['por.hDate', 'por.hType', 'por.hMethod', 'por.hAmount', 'por.hStatus', 'adm.pyRef'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          (d.payments.length ? d.payments.map(function (p) {
            return '<tr><td class="num">' + U.fmtDate(p.date) + '</td><td>' + (p.type === 'advance' ? U.esc(L.t('st.advance')) : U.esc(L.t('st.due'))) + '</td><td>' + U.esc(C.methodLabel(p.method)) + '</td><td class="n">' + U.fmtBDT(p.amount) + '</td><td>' + C.chip(p.status) + '</td><td class="mono">' + U.esc(p.ref || '') + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="footnote">' + U.esc(L.t('adm.mbNoPays')) + '</td></tr>') + '</tbody></table></div>' +
          '<div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="this.closest(\'.modal-back\').remove()">' + U.esc(L.t('common.close')) + '</button></div>');
      });
    });
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var d = await S.getMemberDetail(b.getAttribute('data-edit'));
        var p = d.profile;
        var m = C.modal('<h2>' + U.esc(L.t('adm.mbEditT')) + '</h2>' +
          '<div class="grid form2">' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEName')) + '</span><input type="text" id="em-name" value="' + U.esc(p.fullName) + '"></label>' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEPhone')) + '</span><input type="text" id="em-phone" value="' + U.esc(p.phone || '') + '"></label>' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEShares')) + '</span><input type="number" id="em-shares" min="0" max="20" value="' + p.shares + '"></label>' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEMonthly')) + '</span><input type="number" id="em-md" min="0" value="' + p.monthlyDue + '"><span class="hint">' + U.esc(L.t('adm.mbEMonthlyHint')) + '</span></label>' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEJoin')) + '</span><input type="month" id="em-join" value="' + U.esc(p.joinMonth || '') + '"></label>' +
          '<label class="f"><span>' + U.esc(L.t('adm.mbEStatus')) + '</span><select id="em-status">' + ['active', 'suspended'].map(function (s) { return '<option' + (p.status === s ? ' selected' : '') + ' value="' + s + '">' + U.esc(L.t('st.' + s)) + '</option>'; }).join('') + '</select></label>' +
          '</div><div class="btn-row" style="justify-content:flex-end"><button class="btn subtle" data-x="no">' + U.esc(L.t('common.cancel')) + '</button><button class="btn" data-x="yes">' + U.esc(L.t('common.save')) + '</button></div>');
        m.querySelector('[data-x=no]').onclick = function () { m.remove(); };
        m.querySelector('[data-x=yes]').onclick = async function () {
          try {
            await S.updateMember(p.id, {
              fullName: m.querySelector('#em-name').value.trim(), phone: m.querySelector('#em-phone').value.trim(),
              shares: m.querySelector('#em-shares').value, monthlyDue: m.querySelector('#em-md').value,
              joinMonth: m.querySelector('#em-join').value, status: m.querySelector('#em-status').value
            });
            m.remove(); C.toast(L.t('adm.mbSaved')); refresh();
          } catch (e) { C.toast(e.message, true); }
        };
      });
    });
  }

  /* ---------------- finance ---------------- */
  async function tabFinance() {
    var entries = await S.listFinance();
    body.innerHTML =
      '<div class="grid two" style="align-items:start">' +
      '<div class="card"><h2>' + U.esc(L.t('adm.fiAdd')) + '</h2><form id="fin-form" novalidate>' +
      '<div class="grid form2">' +
      '<label class="f"><span>' + U.esc(L.t('adm.fiKind')) + '</span><select id="fi-kind">' +
      
      '<option value="revenue">' + U.esc(L.t('adm.fiKRevenue')) + '</option>' +
      '<option value="loss">' + U.esc(L.t('adm.fiKLoss')) + '</option></select></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.fiMonth')) + '</span><input type="month" id="fi-month" value="' + U.currentMonth() + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.fiAmount')) + '</span><input type="number" id="fi-amount" min="1"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.fiNote')) + '</span><input type="text" id="fi-note"></label>' +
      '</div><div id="fi-err" class="err"></div><button class="btn" type="submit">' + U.esc(L.t('adm.fiSave')) + '</button></form>' +
      '<p class="foot">' + U.esc(L.t('adm.fiFoot')) + '</p></div>' +
      '<div class="card"><h2>' + U.esc(L.t('adm.fiEntries', { n: entries.length })) + '</h2><div class="tablewrap" style="max-height:420px;overflow:auto">' +
      '<table class="data"><thead><tr>' +
      ['idx.thMonth', 'adm.fiKind', 'adm.fiAmount', 'adm.fiNote', 'adm.fiActions'].map(function (k) { return '<th>' + (k ? U.esc(L.t(k)) : '') + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (entries.length ? entries.map(function (f) {
        return '<tr><td class="num">' + U.fmtMonth(f.month) + '</td><td>' + U.esc(L.t(f.kind === 'funding' ? 'adm.fiKFunding' : f.kind === 'revenue' ? 'adm.fiKRevenue' : 'adm.fiKLoss')) + '</td><td class="n">' + U.fmtBDT(f.amount) + '</td>' +
          '<td>' + U.esc(f.note || '') + '</td><td><div class="btn-row">' +
          '<button class="btn sm subtle" data-fe="' + f.id + '" data-kind="' + f.kind + '" data-month="' + f.month + '" data-amount="' + f.amount + '" data-note="' + U.esc(f.note || '') + '">' + U.esc(L.t('common.edit')) + '</button>' +
          '<button class="btn sm danger" data-fd="' + f.id + '">' + U.esc(L.t('common.delete')) + '</button></div></td></tr>';
      }).join('') : '<tr><td colspan="5"><div class="empty">' + U.esc(L.t('adm.fiEmpty')) + '</div></td></tr>') +
      '</tbody></table></div></div></div>';

    document.getElementById('fin-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = document.getElementById('fi-err'); err.textContent = '';
      try {
        await S.upsertFinanceEntry({
          kind: document.getElementById('fi-kind').value, month: document.getElementById('fi-month').value,
          amount: document.getElementById('fi-amount').value, note: document.getElementById('fi-note').value.trim()
        });
        C.toast(L.t('adm.fiSaved')); refresh();
      } catch (e) { err.textContent = e.message; }
    });
    body.querySelectorAll('[data-fe]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById('fi-kind').value = b.getAttribute('data-kind');
        document.getElementById('fi-month').value = b.getAttribute('data-month');
        document.getElementById('fi-amount').value = b.getAttribute('data-amount');
        document.getElementById('fi-note').value = b.getAttribute('data-note');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    body.querySelectorAll('[data-fd]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var ok = await C.confirmModal(L.t('adm.fiDeleteQ'), L.t('adm.fiDeleteB'), L.t('common.delete'), 'danger');
        if (!ok) return;
        await S.deleteFinanceEntry(b.getAttribute('data-fd'));
        C.toast(L.t('adm.fiDeleted')); refresh();
      });
    });
  }

  /* ---------------- settings (+ content) ---------------- */
  async function tabSettings() {
    var s = await S.getSettings();
    var pn = s.paymentNumbers || {};
    var bank = pn.bank || {};
    var c = s.content || { en: {}, bn: {} };
    var en = c.en || {}, bn = c.bn || {};
    function cf(id, labelKey, val) {
      return '<label class="f"><span>' + U.esc(L.t(labelKey)) + '</span><input type="text" id="' + id + '" value="' + U.esc(val || '') + '"></label>';
    }
    var modeNotice = C.isDemo() ?
      ('<div class="notice">' + U.esc(L.t('adm.demoNotice')) +
      ' <a href="' + GUIDE_URL + '" target="_blank" rel="noopener">' + U.esc(L.t('adm.demoNoticeLink')) + '</a></div>') :
      ('');
    var sess = await S.getSession();
    body.innerHTML =
      modeNotice +
      '<div class="card" style="max-width:820px"><h2>' + U.esc(L.t('adm.pfTitle')) + '</h2>' +
      '<label class="f"><span>' + U.esc(L.t('adm.pfName')) + '</span><input type="text" id="pf-name" value="' + U.esc((sess && sess.fullName) || '') + '"></label>' +
      '<p><button type="button" class="btn" id="pf-save-name">' + U.esc(L.t('adm.pfNameSave')) + '</button> <span class="hint" id="pf-name-msg"></span></p>' +
      '<div id="admin-reset-slot"></div>' +
      '</div>' +
      '<div class="card" style="max-width:820px"><form id="set-form" novalidate>' +
      '<div class="grid form2">' +
      '<label class="f"><span>' + U.esc(L.t('adm.stFundName')) + '</span><input type="text" id="st-name" value="' + U.esc(s.fundName || 'NextGen Fund') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stMeeting')) + '</span><input type="date" id="st-meet" value="' + U.esc(s.nextMeeting || '') + '"></label>' +
      '<label class="f" style="grid-column:1/-1"><span>' + U.esc(L.t('adm.stMeetingNote')) + '</span><input type="text" id="st-note" placeholder="' + U.esc(L.t('adm.stMeetingNotePh')) + '" value="' + U.esc(s.meetingNote || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stMps')) + '</span><input type="number" id="st-mps" min="1" value="' + (s.monthlyPerShare || 1000) + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stDrive')) + '</span><input type="text" id="st-drive" placeholder="https://script.google.com/macros/s/.../exec" value="' + U.esc(window.__ngfDriveNow || '') + '">' +
        '<span class="hint">' + U.esc(L.t('adm.stDriveHint')) + '</span></label>' +
        '<label class="f"><span>' + U.esc(L.t('adm.stDocs')) + '</span><input type="text" id="st-docs" value="' + U.esc((s.docRequirements || []).join(' | ')) + '"><span class="hint">' + U.esc(L.t('adm.stDocsHint')) + '</span></label>' +
      '</div>' +
      '<h2 style="margin-top:8px">' + U.esc(L.t('adm.stNumbers')) + '</h3>' +
      '<div class="grid form2">' +
      '<label class="f"><span>' + U.esc(L.t('adm.stBkash')) + '</span><input type="text" id="st-bkash" value="' + U.esc(pn.bkash || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stNagad')) + '</span><input type="text" id="st-nagad" value="' + U.esc(pn.nagad || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stRocket')) + '</span><input type="text" id="st-rocket" value="' + U.esc(pn.rocket || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stUpay')) + '</span><input type="text" id="st-upay" value="' + U.esc(pn.upay || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stBankName')) + '</span><input type="text" id="st-bankname" value="' + U.esc(bank.bankName || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stBankAcc')) + '</span><input type="text" id="st-bankacc" value="' + U.esc(bank.accountName || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stBankNo')) + '</span><input type="text" id="st-bankno" value="' + U.esc(bank.accountNumber || '') + '"></label>' +
      '<label class="f"><span>' + U.esc(L.t('adm.stBankBr')) + '</span><input type="text" id="st-bankbr" value="' + U.esc(bank.branch || '') + '"></label>' +
      '</div>' +
      '<h2 style="margin-top:8px">' + U.esc(L.t('adm.stContent')) + '</h3>' +
      '<p class="footnote">' + U.esc(L.t('adm.stContentHint')) + '</p>' +
      '<div class="grid two">' +
      '<div><h3 class="k">English</h4>' +
      cf('ct-en-sub', 'adm.stSub', en.sub) +
      cf('ct-en-notice', 'adm.stNotice', en.notice) +
      cf('ct-en-how1', 'adm.stHow1', en.how1) +
      cf('ct-en-how2', 'adm.stHow2', en.how2) +
      cf('ct-en-how3', 'adm.stHow3', en.how3) +
      cf('ct-en-how4', 'adm.stHow4', en.how4) +
      '</div>' +
      '<div><h3 class="k">বাংলা</h4>' +
      cf('ct-bn-sub', 'adm.stSub', bn.sub) +
      cf('ct-bn-notice', 'adm.stNotice', bn.notice) +
      cf('ct-bn-how1', 'adm.stHow1', bn.how1) +
      cf('ct-bn-how2', 'adm.stHow2', bn.how2) +
      cf('ct-bn-how3', 'adm.stHow3', bn.how3) +
      cf('ct-bn-how4', 'adm.stHow4', bn.how4) +
      '</div></div>' +
      '<div id="st-err" class="err"></div>' +
      '<button class="btn" type="submit">' + U.esc(L.t('adm.stSave')) + '</button></form></div>';

    try {
      var rslot = document.getElementById('admin-reset-slot');
      if (rslot && C.resetPasswordCard) {
        rslot.innerHTML = C.resetPasswordCard('admin', (sess && sess.email) || '');
        C.wireResetCard();
      }
    } catch (eRst) { /* the card is optional */ }

    var pfNameBtn = document.getElementById('pf-save-name');
    if (pfNameBtn) pfNameBtn.onclick = async function () {
      var msg = document.getElementById('pf-name-msg');
      try {
        var r = await S.updateMyName(document.getElementById('pf-name').value);
        msg.textContent = L.t('adm.pfNameSaved');
        var who = document.getElementById('nav-who');
        if (who) who.textContent = r.fullName + ' (admin)';
      } catch (e) { msg.textContent = e.message || 'Error'; }
    };

    document.getElementById('set-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = document.getElementById('st-err'); err.textContent = '';
      var g = function (id) { return document.getElementById(id).value.trim(); };
      try {
        if (g('st-drive') !== undefined && S.saveDriveEndpoint) {
      try { await S.saveDriveEndpoint(g('st-drive')); } catch (e) { C.toast(String(e && e.message || e), true); }
    }
    await S.saveSettings({
          fundName: g('st-name'),
          nextMeeting: g('st-meet'),
          meetingNote: g('st-note'),
          monthlyPerShare: Number(g('st-mps')) || 1000,
          driveEndpoint: (document.getElementById('st-drive') ? document.getElementById('st-drive').value.trim() : undefined),
    docRequirements: g('st-docs').split('|').map(function (x) { return x.trim(); }).filter(Boolean),
          paymentNumbers: {
            bkash: g('st-bkash'), nagad: g('st-nagad'), rocket: g('st-rocket'), upay: g('st-upay'),
            bank: { bankName: g('st-bankname'), accountName: g('st-bankacc'), accountNumber: g('st-bankno'), branch: g('st-bankbr') }
          },
          content: {
            en: { sub: g('ct-en-sub'), notice: g('ct-en-notice'), how1: g('ct-en-how1'), how2: g('ct-en-how2'), how3: g('ct-en-how3'), how4: g('ct-en-how4') },
            bn: { sub: g('ct-bn-sub'), notice: g('ct-bn-notice'), how1: g('ct-bn-how1'), how2: g('ct-bn-how2'), how3: g('ct-bn-how3'), how4: g('ct-bn-how4') }
          }
        });
        C.toast(L.t('adm.stSaved'));
      } catch (e) { err.textContent = e.message; }
    });
  }

  /* ---------------- export ---------------- */
  async function tabExport() {
    body.innerHTML =
      '<div class="card" style="max-width:640px"><h2>' + U.esc(L.t('adm.exTitle')) + '</h2>' +
      '<p class="footnote">' + U.esc(L.t('adm.exText')) + '</p>' +
      '<div class="btn-row">' +
      '<button class="btn" id="ex-members">' + U.esc(L.t('adm.exMembers')) + '</button>' +
      '<button class="btn" id="ex-payments">' + U.esc(L.t('adm.exPayments')) + '</button>' +
      '<button class="btn" id="ex-finance">' + U.esc(L.t('adm.exFinance')) + '</button>' +
      '</div><p class="foot">' + U.esc(L.t('adm.exTip')) + '</p></div>';
    document.getElementById('ex-members').onclick = async function () {
      U.download('nextgen-members-' + U.todayISO() + '.csv', await S.exportMembersCSV());
    };
    document.getElementById('ex-payments').onclick = async function () {
      U.download('nextgen-payments-' + U.todayISO() + '.csv', await S.exportPaymentsCSV());
    };
    document.getElementById('ex-finance').onclick = async function () {
      U.download('nextgen-finance-' + U.todayISO() + '.csv', await S.exportFinanceCSV());
    };
  }

  /* ---------------- audit ---------------- */
  async function tabAudit() {
    var list = await S.listAudit();
    body.innerHTML =
      '<div class="tablewrap"><table class="data"><thead><tr>' +
      ['adm.auWhen', 'adm.auActor', 'adm.auAction', 'adm.auDetail'].map(function (k) { return '<th>' + U.esc(L.t(k)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (list.length ? list.map(function (a) {
        return '<tr><td class="num">' + U.fmtDate(a.at) + ' <span class="sub">' + new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</span></td>' +
          '<td>' + U.esc(a.actor) + '</td><td>' + U.esc(a.action) + '</td><td>' + U.esc(a.detail || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="4"><div class="empty">' + U.esc(L.t('adm.auEmpty')) + '</div></td></tr>') + '</tbody></table></div>';
  }

  /* ---------------- shell ---------------- */
  var TABS = { overview: tabOverview, registrations: tabRegistrations, payments: tabPayments, members: tabMembers, finance: tabFinance, settings: tabSettings, export: tabExport, audit: tabAudit };

  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#admin-tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab));
    });
    body.innerHTML = '<p class="loading">' + U.esc(L.t('common.loading')) + '</p>';
    TABS[tab]().catch(function (e) { body.innerHTML = '<div class="notice bad">' + U.esc(e.message) + '</div>'; });
  }
  function refresh() { selectTab(state.tab); }

  async function run() {
    document.title = L.t('adm.title') + ' — NextGen Fund';
    var ctx = await C.requireRole(['admin'], 'login.html?next=admin.html');
    if (!ctx) return;
    C.renderHeader('admin.html');
  C.renderFooter();
  L.apply(document);
    document.getElementById('mode-badge').innerHTML = C.modeBadge();
    body = document.getElementById('tab-body');
    document.getElementById('admin-content').classList.remove('hide');

    document.querySelectorAll('#admin-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.getAttribute('data-tab')); });
    });

    var regs = await S.listRegistrations('pending');
    var bootStats = await S.paymentStats();
    document.getElementById('tab-reg-n').textContent = regs.length ? '(' + regs.length + ')' : '';
    document.getElementById('tab-pay-n').textContent = bootStats.counts.pending ? '(' + bootStats.counts.pending + ')' : '';

    selectTab('overview');
  }

  run().catch(function (e) { console.error(e); });
})();

/* ---- nominee change approvals (added 2026-09-15): member asks, admin decides ---- */
(function () {
  'use strict';
  var S = window.NGFStore, C = window.NGFCOMMON, L = window.NGFLANG, U = window.NGFUtil;
  function el(id) { return document.getElementById(id); }

  function row(r) {
    return '<tr><td><strong>' + U.esc(r.memberName || r.username || r.memberId) + '</strong><span class="sub"><br>' +
      U.esc(r.username || '') + '</span></td>' +
      '<td>' + U.esc(r.currentNominee || '—') + '</td>' +
      '<td><strong>' + U.esc(r.requestedNominee) + '</strong>' + (r.relation ? '<span class="sub"><br>' + U.esc(r.relation) + '</span>' : '') + '</td>' +
      '<td>' + U.esc(r.reason || '') + '</td>' +
      '<td class="sub">' + U.esc(U.fmtDate ? U.fmtDate(r.requestedAt) : r.requestedAt) + '</td>' +
      '<td><div class="btn-row"><button class="btn sm" data-ok="' + U.esc(r.id) + '">' + U.esc(L.t('adm.nomApprove')) + '</button>' +
      '<button class="btn sm subtle" data-no="' + U.esc(r.id) + '">' + U.esc(L.t('adm.nomReject')) + '</button></div></td></tr>';
  }

  async function render() {
    var body = el('tab-body');
    if (!body) return;
    var rows = [], history = [];
    try { rows = (await S.listNomineeRequests('pending')) || []; history = (await S.listNomineeRequests()) || []; } catch (e) { rows = []; }
    body.innerHTML = '<h2>' + U.esc(L.t('adm.nomTitle')) + '</h2>' +
      '<div class="tablewrap"><table class="data"><thead><tr><th>Member</th><th>Current</th><th>Requested</th><th>Reason</th><th>When</th><th></th></tr></thead>' +
      '<tbody>' + (rows.length ? rows.map(row).join('') : '<tr><td colspan="6" class="loading">' + U.esc(L.t('adm.nomNone')) + '</td></tr>') + '</tbody></table></div>' +
      (history.filter(function (h) { return h.status !== 'pending'; }).length
        ? '<h3 style="margin-top:14px">History</h3><div class="tablewrap"><table class="data"><thead><tr><th>Member</th><th>Requested</th><th>Status</th><th>Decided</th></tr></thead><tbody>' +
          history.filter(function (h) { return h.status !== 'pending'; }).map(function (h) {
            return '<tr><td>' + U.esc(h.memberName || h.username || '') + '</td><td>' + U.esc(h.requestedNominee) + '</td><td>' + C.chip(h.status) + '</td><td class="sub">' + U.esc(U.fmtDate ? U.fmtDate(h.decidedAt) : (h.decidedAt || '')) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '');

    Array.prototype.forEach.call(body.querySelectorAll('[data-ok],[data-no]'), function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-ok') || b.getAttribute('data-no');
        var approve = !!b.getAttribute('data-ok');
        b.disabled = true;
        try {
          await S.decideNomineeRequest(id, approve, 'admin');
          C.toast(approve ? L.t('adm.nomDone') : L.t('adm.nomRejected'));
          render();
        } catch (e) { b.disabled = false; C.toast(String(e && e.message || e), true); }
      };
    });
  }

  function wire() {
    var btn = document.querySelector('[data-tab="nominee"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-selected', 'false'); });
      btn.setAttribute('aria-selected', 'true');
      render();
    });
    /* pending count on the tab, so an admin sees it without opening the tab */
    S.listNomineeRequests('pending').then(function (rows) {
      var n = (rows || []).length;
      if (n) { var box = el('tab-nom-n'); if (box) box.textContent = '(' + n + ')'; }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(wire, 600); });
  else setTimeout(wire, 600);
})();
