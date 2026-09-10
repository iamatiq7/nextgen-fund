/* NextGen Fund — public dashboard */
(function () {
  'use strict';
  var U = window.NGFUtil, C = window.NGFCOMMON, S = window.NGFStore, L = window.NGFLANG;

  var COLORS = { funding: '#1f3a5f', revenue: '#2e6b5b', loss: '#a6452f' };

  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }

  function content(snap, key, fallbackKey) {
    var c = (snap && snap.content) || {};
    var lang = L.lang === 'bn' ? 'bn' : 'en';
    return (c[lang] && c[lang][key]) || (c.en && c.en[key]) || L.t(fallbackKey);
  }

  function renderChart(months) {
    var box = document.getElementById('chart');
    var legend = document.getElementById('chart-legend');
    if (!months.length) {
      box.innerHTML = '<div class="empty">' + U.esc(L.t('idx.chartEmpty')) + '</div>';
      legend.innerHTML = '';
      return;
    }
    var series = [];
    if (months.some(function (m) { return m.funding > 0; })) series.push(['funding', L.t('idx.legFunding')]);
    if (months.some(function (m) { return m.revenue > 0; })) series.push(['revenue', L.t('idx.legRevenue')]);
    if (months.some(function (m) { return m.loss > 0; })) series.push(['loss', L.t('idx.legLoss')]);
    legend.innerHTML = series.map(function (s) {
      return '<span><i style="background:' + COLORS[s[0]] + '"></i>' + U.esc(s[1]) + '</span>';
    }).join('');
    if (!series.length) { box.innerHTML = '<div class="empty">' + U.esc(L.t('idx.chartEmpty')) + '</div>'; return; }

    var W = 1040, H = 340, padL = 84, padR = 16, padT = 18, padB = 44;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = 0;
    months.forEach(function (m) { ['funding', 'revenue', 'loss'].forEach(function (k) { if (m[k] > max) max = m[k]; }); });
    max = max || 1;
    var p = Math.pow(10, Math.floor(Math.log10(max)));
    var cands = [1, 2, 2.5, 5, 10].map(function (x) { return x * p; });
    var top = cands.find(function (x) { return x >= max; }) || max;
    var n = months.length;
    var slot = iw / n;
    var bw = Math.min(30, slot / (series.length + 1.2));

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">'];
    for (var g = 0; g <= 4; g++) {
      var yv = top * g / 4;
      var y = padT + ih - (yv / top) * ih;
      svg.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#e8eaec" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#8a97a3">\u09F3' + Math.round(yv).toLocaleString('en-IN') + '</text>');
    }
    months.forEach(function (m, i) {
      var x0 = padL + slot * i + (slot - bw * series.length - 4 * (series.length - 1)) / 2;
      series.forEach(function (s, si) {
        var v = m[s[0]] || 0;
        var h = (v / top) * ih;
        var x = x0 + si * (bw + 4);
        var y = padT + ih - h;
        svg.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, v > 0 ? 2 : 0) + '" fill="' + COLORS[s[0]] + '"><title>' +
          U.fmtMonth(m.month) + ' · ' + s[1] + ': \u09F3' + Math.round(v).toLocaleString('en-IN') + '</title></rect>');
        if (v > 0 && series.length <= 2) {
          svg.push('<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="10.5" fill="#5c6b7a">' +
            (v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : Math.round(v)) + '</text>');
        }
      });
      svg.push('<text x="' + (padL + slot * i + slot / 2) + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="11" fill="#5c6b7a">' +
        U.fmtMonth(m.month) + '</text>');
    });
    svg.push('<line x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (W - padR) + '" y2="' + (padT + ih) + '" stroke="#1c2b3a" stroke-width="1.2"/>');
    svg.push('</svg>');
    box.innerHTML = svg.join('');
  }

  async function run() {
    document.title = L.t('idx.title');
    await C.boot('index.html');
    var sess = await S.getSession();
    if (!sess) { location.replace('login.html?next=index.html'); return; }
    document.getElementById('mode-badge').innerHTML = C.modeBadge();
    var snap = await S.getPublicSnapshot();

    // admin-editable content (falls back to dictionary defaults)
    set('idx-subtitle', content(snap, 'sub', 'idx.subtitle'));
    var notice = content(snap, 'notice', '');
    var nEl = document.getElementById('idx-notice');
    if (notice) { nEl.textContent = notice; nEl.classList.remove('hide'); }
    ['1', '2', '3', '4'].forEach(function (i) {
      set('how-' + i, content(snap, 'how' + i, 'idx.how' + i).replace('{amt}', U.fmtBDT(snap.monthlyPerShare || 1000)));
    });

    var d = snap.nextMeeting ? U.daysUntil(snap.nextMeeting) : null;
    set('stat-meeting', snap.nextMeeting ? U.fmtDate(snap.nextMeeting) : L.t('idx.meetingNotSet'));
    set('stat-meeting-note', snap.nextMeeting
      ? (d > 1 ? L.t('idx.meetingIn', { d: d }) : d === 1 ? L.t('idx.meetingTomorrow') : d === 0 ? L.t('idx.meetingToday') : L.t('idx.meetingPassed'))
        + (snap.meetingNote ? ' · ' + snap.meetingNote : '')
      : L.t('idx.meetingNotSetSub'));
    set('stat-funding', U.fmtBDT(snap.totalFunding));
    set('stat-revenue', U.fmtBDT(snap.totalRevenue));
    set('stat-loss', U.fmtBDT(snap.totalLoss));
    var net = document.getElementById('stat-net');
    net.textContent = U.fmtBDT(snap.net);
    net.parentElement.className = 'card stat tone-yellow' + (snap.net < 0 ? ' neg' : '');
    set('stat-members', L.t('idx.members', {
      n: snap.memberCount, s: snap.memberCount === 1 ? '' : 's',
      u: snap.updatedAt ? U.fmtDate(snap.updatedAt) : '—'
    }));

    renderChart(snap.months);
    set('chart-source', L.t('idx.chartSource'));

    var tb = document.querySelector('#month-table tbody');
    if (!snap.months.length) {
      tb.innerHTML = '<tr><td colspan="5"><div class="empty">' + U.esc(L.t('idx.tableEmpty')) + '</div></td></tr>';
    } else {
      tb.innerHTML = snap.months.map(function (m) {
        var netM = m.funding + m.revenue - m.loss;
        return '<tr><td>' + U.fmtMonth(m.month) + '</td><td class="n">' + U.fmtBDT(m.funding) + '</td><td class="n">' +
          (m.revenue ? U.fmtBDT(m.revenue) : '—') + '</td><td class="n">' + (m.loss ? U.fmtBDT(m.loss) : '—') +
          '</td><td class="n">' + U.fmtBDT(netM, { plus: netM > 0 }) + '</td></tr>';
      }).join('') +
      '<tr class="total"><td>' + U.esc(L.t('idx.total')) + '</td><td class="n">' + U.fmtBDT(snap.totalFunding) + '</td><td class="n">' +
      U.fmtBDT(snap.totalRevenue) + '</td><td class="n">' + U.fmtBDT(snap.totalLoss) + '</td><td class="n">' + U.fmtBDT(snap.net) + '</td></tr>';
    }

    set('share-info', L.t('idx.shareInfo', { amt: U.fmtBDT(snap.monthlyPerShare || 1000) }));
  }

  run().catch(function (e) {
    var tb = document.querySelector('#month-table tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="5" class="err">' + U.esc(e.message) + '</td></tr>';
  });
})();
