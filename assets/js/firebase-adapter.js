/* ============================================================
   NextGen Fund — Firebase adapter (live multi-user mode)
   Activates only when firebase-config.js is filled. Registered
   into NGFStore via NGFStore.registerFirebaseBackend().
   SDK is imported from gstatic at runtime — works on GitHub
   Pages (https). The AutoClaw static preview blocks external
   origins via CSP, so the preview stays in demo mode.
   ============================================================ */
(function () {
  'use strict';
  var driveEndpointCache = null;

  if (typeof window === 'undefined' || !window.NGFStore || !window.NGFUtil) return;

  var cfg = window.NGF_FIREBASE_CONFIG || {};
  if (!cfg.apiKey || !cfg.projectId) return; // stay in demo mode

  var V = 'https://www.gstatic.com/firebasejs/10.12.2';

  window.NGFStore.registerFirebaseBackend(async function () {
    var appMod = await import(V + '/firebase-app.js');
    var authMod = await import(V + '/firebase-auth.js');
    var fsMod = await import(V + '/firebase-firestore.js');
    var stMod = await import(V + '/firebase-storage.js');

    var app = appMod.initializeApp(cfg);
    var auth = authMod.getAuth(app);
    var db = fsMod.getFirestore(app);
    var storage = stMod.getStorage(app);

/* Some deployments have no Storage bucket: uploadBytes() then retries and never settles,
   which left the member staring at a disabled button. Every network step gets a deadline. */
function withTimeout(p, ms, tag) {
  return Promise.race([p, new Promise(function (_, rej) {
    setTimeout(function () { var e = new Error(tag || 'timeout'); e.code = 'timeout'; rej(e); }, ms);
  })]);
}
    var U = window.NGFUtil;
    var S = window.NGFStore;

    /* ---------- nominee changes + Drive uploads ----------
       These need fsMod/docIn/getAll/myUid, so they must live inside this factory. */
    /* ---------- nominee changes + Drive uploads (added 2026-09-15) ---------- */
    async function createNomineeRequest(data) {
      var uid = await myUid();
      if (!uid) throw new Error('not-signed-in');
      if (!String(data.requestedNominee || '').trim()) throw new Error('nominee-required');
      var rowN = {
        memberId: uid, memberName: (data.memberName || '').trim(), username: (data.username || '').trim(),
        kind: 'nominee',
        currentNominee: (data.currentNominee || '').trim(), requestedNominee: (data.requestedNominee || '').trim(),
        relation: (data.relation || '').trim(),
        requestedPhone: (data.requestedPhone || '').trim(), requestedAddress: (data.requestedAddress || '').trim(),
        reason: (data.reason || '').trim(),
        status: 'pending', requestedAt: new Date().toISOString()
      };
      return saveRequest(rowN, 'pendingNomineeRequest');
    }
      /* ---- account change requests (name, username, e-mail, mobile, shares, status) ----
     The member sends one request holding only the fields that actually changed; nothing is
     applied until the admin approves, and the previous values stay in force until then. */
  var ACC_FIELDS = ['fullName', 'username', 'email', 'phone', 'shares'];

  /* A member may only write their own users/{uid} document with the published rules
     (registration itself writes it), so a pending request is stored there as one field.
     If that write is refused we fall back to the shared collection; the admin panel reads both. */
  async function saveRequest(row, field) {
    var uid = row.memberId || (await myUid());
    if (!uid) throw err('not-signed-in', 'not-signed-in');
    row.memberId = uid;
    row.savedIn = 'user';
    var patch = {};
    patch[field] = row;
    try {
      await fsMod.updateDoc(docIn('users', uid), patch);
      return row;
    } catch (eUser) {
      try {
        var created = await addDoc('nomineeRequests', row);
        row.id = (created && created.id) || row.id;
        row.savedIn = 'collection';
        return row;
      } catch (eColl) {
        var perm = /permission/i.test(String(eUser && eUser.code) + ' ' + String(eColl && eColl.code));
        throw err(perm ? 'permission-denied' : 'save-failed', perm ? 'permission-denied' : 'save-failed');
      }
    }
  }

  /* every pending request, from both places */
  async function allRequests() {
    var rows = [];
    try {
      var users = (await getAll('users')) || [];
      for (var i = 0; i < users.length; i++) {
        var u = users[i] || {};
        if (u.pendingAccountRequest) { var a = u.pendingAccountRequest; a.id = a.id || ('u-' + u.id); a.memberId = a.memberId || u.id; a.savedIn = 'user'; rows.push(a); }
        if (u.pendingNomineeRequest) { var n = u.pendingNomineeRequest; n.id = n.id || ('u-' + u.id); n.memberId = n.memberId || u.id; n.savedIn = 'user'; rows.push(n); }
      }
    } catch (eU) { /* a read problem must not hide the other source */ }
    try {
      var coll = (await getAll('nomineeRequests')) || [];
      for (var j = 0; j < coll.length; j++) {
        var r = coll[j] || {};
        if (r.status === 'pending' && r.savedIn !== 'user') rows.push(r);
      }
    } catch (eC) { /* the collection may not be published yet */ }
    return rows;
  }

  /* The login identifier lives in Firebase Authentication and can only be changed by the
     signed-in member (never by the admin from their own session), so the approved address is
     applied here: re-authenticate with the current password, then set the new e-mail. */
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v || '').trim()); }

  async function applyEmailChange(password, correctedEmail) {
    var uid = await myUid();
    if (!uid) throw new Error('not-signed-in');
    var snap = await fsMod.getDoc(docIn('users', uid));
    var u = snap.exists() ? (snap.data() || {}) : {};
    /* the member may correct an incomplete address right here (a typo such as gmail.c) */
    var target = String(correctedEmail || u.emailChangePending || '').trim();
    if (!target) throw err('nothing-pending', 'nothing-pending');
    if (!validEmail(target)) throw err('email-bad', 'email-bad');
    var user = auth.currentUser;
    if (!user) throw err('not-signed-in', 'not-signed-in');
    try {
      var cred = authMod.EmailAuthProvider.credential(user.email || u.email || '', password);
      await authMod.reauthenticateWithCredential(user, cred);
    } catch (eAuth) {
      throw err('wrong-password', 'wrong-password');
    }
    var applied = false;
    /* Proved against this very project (accounts:update -> OPERATION_NOT_ALLOWED
       "Please verify the new email before changing email."): the new address must be verified
       first, so the verification link is the primary route here. */
    if (authMod.verifyBeforeUpdateEmail) {
      try {
        await authMod.verifyBeforeUpdateEmail(user, target);
        throw err('verify-sent', 'verify-sent');
      } catch (eVerify) {
        if (eVerify && eVerify.code === 'verify-sent') throw eVerify;
        if (eVerify && /email-already-in-use/.test(String(eVerify.code))) throw err('email-held', 'email-held');
        if (eVerify && /invalid-email/.test(String(eVerify.code))) throw err('email-bad', 'email-bad');
        if (eVerify && /wrong-password|requires-recent-login/.test(String(eVerify.code))) throw err('wrong-password', 'wrong-password');
      }
    }
    try {
      await authMod.updateEmail(user, target);
      applied = true;
    } catch (eMail) {
      var code = String((eMail && eMail.code) || '');
      if (/email-already-in-use/.test(code)) throw err('email-held', 'email-held');
      if (/invalid-email/.test(code)) throw err('email-bad', 'email-bad');
      if (/wrong-password|requires-recent-login/.test(code)) throw err('wrong-password', 'wrong-password');
      /* Some projects cannot change an address directly (operation-not-allowed / admin-created
         accounts). Firebase's own verification link does the same job: it mails the new address
         and the change is applied when the member opens that link. */
      try {
        if (authMod.verifyBeforeUpdateEmail) {
          await authMod.verifyBeforeUpdateEmail(user, target);
          throw err('verify-sent', 'verify-sent');
        }
      } catch (eVerify) {
        if (eVerify && eVerify.code === 'verify-sent') throw eVerify;
        if (eVerify && /email-already-in-use/.test(String(eVerify.code))) throw err('email-held', 'email-held');
        if (eVerify && /invalid-email/.test(String(eVerify.code))) throw err('email-bad', 'email-bad');
      }
      throw err('not-allowed', code || 'not-allowed');
    }
    if (!applied) throw err('not-allowed', 'not-allowed');
    await fsMod.updateDoc(docIn('users', uid), { email: target, emailChangePending: null, emailChangedAt: new Date().toISOString() });
    try {
      var un = String(u.username || '').toLowerCase();
      if (un) await fsMod.setDoc(docIn('usernames', un), { uid: uid, email: target });
    } catch (eMap) { /* the registry is a convenience, not the login identifier */ }
    await writeAudit({ action: 'email.changed', memberId: uid, detail: (u.email || '') + ' -> ' + target });
    return { ok: true, email: target };
  }

  async function createAccountRequest(data) {
    var uid = await myUid();
    if (!uid) throw new Error('not-signed-in');
    var changes = [];
    ACC_FIELDS.forEach(function (f) {
      var to = (data && data[f] !== undefined) ? String(data[f]).trim() : '';
      var from = (data && data['from_' + f] !== undefined) ? String(data['from_' + f]).trim() : '';
      if (to !== '' && to !== from) {
        if (f === 'email' && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(to)) throw err('email-bad', 'email-bad');
        changes.push({ field: f, from: from, to: to });
      }
    });
    if (!changes.length) throw new Error('nothing-to-request');
    var newName = '';
    for (var i = 0; i < changes.length; i++) if (changes[i].field === 'username') newName = changes[i].to.toLowerCase();
    if (newName) {
      var hit = await fsMod.getDoc(docIn('usernames', newName));
      if (hit && hit.exists() && String((hit.data() || {}).uid) !== String(uid)) {
        throw err('username-taken', 'same username existed, try with another.');
      }
    }
    var rowA = {
      kind: 'account', memberId: uid, memberName: (data.memberName || '').trim(),
      username: (data.from_username || '').trim(),
      changes: changes, reason: (data.reason || '').trim(),
      status: 'pending', requestedAt: new Date().toISOString()
    };
    return saveRequest(rowA, 'pendingAccountRequest');
  }

  async function listAccountRequests(status) {
    var all = await allRequests();
    var rows = all.filter(function (r) { return r.kind === 'account'; })
      .sort(function (x, y) { return String(y.requestedAt || '').localeCompare(String(x.requestedAt || '')); });
    return status ? rows.filter(function (r) { return r.status === status; }) : rows;
  }

  async function decideAccountRequest(id, approve, byName) {
    var row = (await allRequests()).filter(function (r) { return r.id === id; })[0];
    if (!row) throw new Error('not-found');
    if (approve) {
      var snapU = await fsMod.getDoc(docIn('users', row.memberId));
      var cur = snapU.exists() ? (snapU.data() || {}) : {};
      var patch = {};
      var list = row.changes || [];
      for (var i = 0; i < list.length; i++) {
        var ch = list[i];
        if (ch.field === 'shares') patch.shares = parseInt(ch.to, 10) || 0;
        else if (ch.field === 'email') {
          if (!validEmail(ch.to)) throw err('email-bad', 'email-bad');   /* never store an address that cannot be a login id */
          patch.emailChangePending = ch.to;                              /* the login e-mail is applied from the member's own session */
        }
        else patch[ch.field] = ch.to;
      }
      if (patch.username) {
        var oldName = String(cur.username || '').toLowerCase();
        var newName = String(patch.username).toLowerCase();
        try {
          var clash = await fsMod.getDoc(docIn('usernames', newName));
          if (clash && clash.exists() && String((clash.data() || {}).uid) !== String(row.memberId)) {
            throw err('username-taken', 'same username existed, try with another.');
          }
          if (oldName && oldName !== newName) await fsMod.deleteDoc(docIn('usernames', oldName));
          await fsMod.setDoc(docIn('usernames', newName), { uid: row.memberId, email: patch.email || cur.email || '' });
        } catch (eMap) {
          if (eMap && eMap.code === 'username-taken') {
            await fsMod.updateDoc(docIn('nomineeRequests', id), { status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: byName || '', note: 'username-taken' });
            await writeAudit({ action: 'account.reject', memberId: row.memberId, detail: 'username already taken: ' + newName });
            return 'username-taken';
          }
        }
      }
      await fsMod.updateDoc(docIn('users', row.memberId), patch);
      await writeAudit({ action: 'account.approve', memberId: row.memberId, detail: JSON.stringify(patch).slice(0, 300) });
    } else {
      await writeAudit({ action: 'account.reject', memberId: row.memberId, detail: (row.reason || '') + ' | ' + JSON.stringify(row.changes || []).slice(0, 200) });
    }
    var clear = {}; clear.pendingAccountRequest = null;
    try { await fsMod.updateDoc(docIn('users', row.memberId), clear); } catch (eClear) { }
    if (row.savedIn !== 'user') {
      try { await fsMod.updateDoc(docIn('nomineeRequests', id), { status: approve ? 'approved' : 'rejected', decidedAt: new Date().toISOString(), decidedBy: byName || '' }); } catch (eRow) { }
    }
    return true;
  }

async function listNomineeRequests(status) {
      var all = await allRequests();
      /* only nominee requests belong here: a member's account change must never show up
         in the nominee view (and the other way round). Rows written before the kind field
         existed are nominee requests. */
      var rows = all.filter(function (r) { return (r.kind || 'nominee') === 'nominee'; })
        .sort(function (x, y) { return String(y.requestedAt || '').localeCompare(String(x.requestedAt || '')); });
      return status ? rows.filter(function (r) { return r.status === status; }) : rows;
    }
    async function decideNomineeRequest(id, approve, byName) {
      var row = (await allRequests()).filter(function (r) { return r.id === id; })[0];
      if (!row) throw new Error('not-found');
      if (approve) {
        var snap = await fsMod.getDoc(docIn('users', row.memberId));
        var cur = snap.exists() ? (snap.data() || {}) : {};
        var patchN = { nominee: row.requestedNominee, nomineeRelation: row.relation || '', nomineeUpdatedAt: new Date().toISOString() };
      if (row.requestedPhone) patchN.nomineePhone = row.requestedPhone;
      if (row.requestedAddress) patchN.nomineeAddress = row.requestedAddress;
      await fsMod.updateDoc(docIn('users', row.memberId), patchN);
        await writeAudit({ action: 'nominee.approve', memberId: row.memberId, detail: 'nominee: ' + (cur.nominee || '(none)') + ' -> ' + row.requestedNominee, by: byName || 'admin' });
      } else {
        await writeAudit({ action: 'nominee.reject', memberId: row.memberId, detail: 'nominee change to ' + row.requestedNominee + ' rejected', by: byName || 'admin' });
      }
      try { await fsMod.updateDoc(docIn('users', row.memberId), { pendingNomineeRequest: null }); } catch (eClear) { }
      await fsMod.updateDoc(docIn('nomineeRequests', id), { status: approve ? 'approved' : 'rejected', decidedAt: new Date().toISOString(), decidedBy: byName || 'admin' });
      return true;
    }
    function fileExt(mime, fallbackName) {
      var map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
      if (map[mime]) return map[mime];
      var m = String(fallbackName || '').match(/\.([a-z0-9]{2,4})$/i);
      return m ? m[1].toLowerCase() : 'jpg';
    }
    async function getDriveEndpoint() {
      if (driveEndpointCache !== null) return driveEndpointCache;
      driveEndpointCache = '';
      try {
        var snap = await fsMod.getDoc(docIn('settings', 'drive'));
        if (snap.exists()) driveEndpointCache = String((snap.data() || {}).endpoint || '').trim();
      } catch (e) {
        if (String(e && e.code) === 'permission-denied') console.warn('settings/drive is not readable with the current rules; using the settings mirror');
      }
      if (!driveEndpointCache) {
        /* the settings form mirrors the endpoint into settings/public as well, so an endpoint the
           admin already saved keeps working even while /settings/drive is not writable/readable */
        try {
          var pub = await fsMod.getDoc(docIn('settings', 'public'));
          if (pub.exists()) driveEndpointCache = String((pub.data() || {}).driveEndpoint || '').trim();
        } catch (e2) { /* fall through */ }
      }
      if (!driveEndpointCache) driveEndpointCache = window.NGF_DRIVE_ENDPOINT || (window.NGF_CONFIG && window.NGF_CONFIG.driveEndpoint) || '';
      return driveEndpointCache;
    }

    async function saveDriveEndpoint(url) {
      var clean = String(url || '').trim();
      if (clean && !/^https:\/\/script\.google\.com\//.test(clean) && !/^https:\/\//.test(clean)) throw new Error('The endpoint must start with https://');
      var stored = 'settings/drive';
      try {
        await fsMod.setDoc(docIn('settings', 'drive'), { endpoint: clean, updatedAt: new Date().toISOString() }, { merge: true });
      } catch (e) {
        if (String(e && e.code) !== 'permission-denied') throw err('denied', (e && e.message) || 'Could not save the Drive endpoint.');
        /* The dedicated document is not writable with the deployed rules (the release needs the
           firebaserules.releases.create permission). The settings form also mirrors this value into
           settings/public, which the admin CAN write, and getDriveEndpoint() reads that mirror - so
           the endpoint works today. No error is shown: the save really did happen. */
        stored = 'settings/public (mirror)';
      }
      driveEndpointCache = clean;
      return { ok: true, endpoint: clean, storedIn: stored };
    }

    async function uploadToDrive(username, docs) {
      var endpoint = await getDriveEndpoint();
      if (!endpoint) return { ok: false, reason: 'drive-endpoint-missing' };
      var files = [];
      for (var i = 0; i < docs.length; i += 1) {
        var f = docs[i].file;
        var b64 = await new Promise(function (res, rej) {
          var r = new FileReader();
          r.onload = function () { res(String(r.result).split(',')[1] || ''); };
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        files.push({ name: docs[i].key + '.' + fileExt(f.type, f.name), mime: f.type || 'image/jpeg', bytes: f.size, base64: b64 });
      }
      var res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ username: String(username || '').toLowerCase(), files: files }) });
      if (!res.ok) return { ok: false, reason: 'drive-http-' + res.status };
      var out = await res.json();
      if (!out || out.ok === false) return { ok: false, reason: (out && out.error) || 'drive-error' };
      return { ok: true, folderId: out.folderId, folderUrl: out.folderUrl, files: out.files || [] };
    }

    /* ---- helpers ---- */
    /* the uploaded profile picture, kept on the user record so every screen can show it */
    function photoOfDocs(docs) {
      var d = (docs || []).filter(function (x) { return x && x.kind === 'profile-picture'; })[0];
      if (!d) return '';
      return d.driveFileId || d.driveUrl || d.dataUrl || d.data || '';
    }
    function col(name) { return fsMod.collection(db, name); }
    function docIn(name, id) { return fsMod.doc(db, name, id); }
  /* wraps the modular helper so the request builders can stay short */
  function addDoc(name, data) { return fsMod.addDoc(col(name), data); }
  async function writeAudit(o) { o = o || {}; return audit(o.actor || '', o.action || '', o.detail || ''); }
    async function getDoc(path, id) { var s = await fsMod.getDoc(docIn(path, id)); return s.exists() ? s.data() : null; }
    async function getAll(path, q) {
      var snap = q ? await fsMod.getDocs(q) : await fsMod.getDocs(col(path));
      var out = []; snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      return out;
    }
    function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

    async function userDoc(uid) { return getDoc('users', uid); }
    async function myUid() {
      var cu = auth.currentUser;
      if (!cu) throw err('unauthenticated', 'Please log in');
      return cu.uid;
    }
    async function requireAdminUid() {
      var uid = await myUid();
      var u = await userDoc(uid);
      if (!u || u.role !== 'admin') throw err('forbidden', 'Admin access required');
      return { uid: uid, user: u };
    }
    async function audit(actor, action, detail) {
      try { await fsMod.addDoc(col('audit'), { at: new Date().toISOString(), actor: actor || '', action: action, detail: detail || '' }); } catch (e) { /* non-fatal */ }
    }
    /* Recompute the public fund totals: manual finance entries + VERIFIED member deposits.
       Stored in settings/public so the (unauthenticated) dashboard can read them. */
    async function syncPublicTotals() {
      try {
        var finance = await getAll('finance');
        var pays = await getAll('payments');
        var users = await getAll('users', fsMod.query(col('users'), fsMod.where('role', '==', 'member')));
        var months = {};
        finance.forEach(function (f) {
          /* funding is never typed by hand any more: legacy 'funding' rows are ignored so they
             cannot double count against the member deposits below. */
          if (f.kind === 'funding') return;
          var m = months[f.month] || (months[f.month] = { month: f.month, funding: 0, revenue: 0, loss: 0, deposits: 0 });
          m[f.kind] = (Number(m[f.kind]) || 0) + (Number(f.amount) || 0);
        });
        var depositTotal = 0, pendingDueTotal = 0, memberAdvance = 0;
        pays.forEach(function (p) {
          var amt = Number(p.amount) || 0;
          if (p.status === 'pending' && p.type === 'due') pendingDueTotal += amt;
          if (p.status !== 'verified') return;
          /* every verified taka that came in is money in the fund (advance too) */
          var mk = String(p.date || '').slice(0, 7);
          if (!mk) return;
          var mm = months[mk] || (months[mk] = { month: mk, funding: 0, revenue: 0, loss: 0, deposits: 0 });
          mm.funding += amt;
          mm.deposits = (mm.deposits || 0) + amt;
          depositTotal += amt;
        });
        var tF = 0, tR = 0, tL = 0;
        Object.keys(months).sort().forEach(function (k) {
          /* funding = verified member money + revenue - loss. Both inputs are automatic. */
          months[k].funding = (months[k].deposits || 0) + (months[k].revenue || 0) - (months[k].loss || 0);
          months[k].net = months[k].funding;
          tF += months[k].funding; tR += months[k].revenue; tL += months[k].loss;
        });
        users.forEach(function (u) {
          if (u.status !== 'active') return; /* suspended members are not counted in the pool */
          memberAdvance += computeBalance(u, pays.filter(function (p) { return p.memberId === u.id; })).advance;
        });
        await fsMod.setDoc(docIn('settings', 'public'), {
          memberCount: users.filter(function (u) { return u.status === 'active'; }).length,
          fundTotals: {
            totalFunding: tF, totalRevenue: tR, totalLoss: tL, net: tF, /* funding already nets revenue and loss */
            memberDeposits: depositTotal, memberAdvance: memberAdvance, pendingDue: pendingDueTotal,
            months: Object.keys(months).sort().map(function (k) { return months[k]; }),
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) { /* non-fatal */ }
    }

    /* keep the public member count in settings/public so non-admin viewers can read it */
    async function syncMemberCount() {
      try {
        var users = await getAll('users', fsMod.query(col('users'), fsMod.where('role', '==', 'member')));
        var active = users.filter(function (u) { return u.status === 'active'; }).length;
        await fsMod.setDoc(docIn('settings', 'public'), { memberCount: active, updatedAt: new Date().toISOString() }, { merge: true });
      } catch (e) { /* non-fatal */ }
    }

    /* ---- balance calc (shared formula) ---- */
    function computeBalance(user, payments) {
      var nowMonth = U.currentMonth();
      var perMonth = Number(user.monthlyDue) || 0;
      var months = U.monthsInclusive(user.joinMonth, nowMonth);
      if (!isFinite(months) || months < 1) months = 1; /* guard a malformed joinMonth */
      var expected = months * perMonth;
      var paidDue = 0, paidAdvance = 0, pendingDue = 0, pendingAdvance = 0;
      (payments || []).forEach(function (p) {
        var amt = Number(p.amount) || 0;
        if (p.status === 'verified') {
          if (p.type === 'advance') paidAdvance += amt; else paidDue += amt;
        } else if (p.status === 'pending') {
          if (p.type === 'advance') pendingAdvance += amt; else pendingDue += amt;
        }
      });
      /* ADVANCE RULE (docs/advance-rule-spec.md): every verified taka is money
         received. Whatever was received beyond the amount billed to date
         (months joined x monthly due) is member credit, i.e. advance - so an
         overpaid monthly due automatically becomes advance. */
      var received = paidDue + paidAdvance;
      var pendingReceived = pendingDue + pendingAdvance;
      var dueVerified = Math.max(0, expected - received);
      var advance = Math.max(0, received - expected);
      /* A submitted (pending) payment already reduces the outstanding due;
         it only enters the fund total after the admin approves it. */
      return {
        expected: expected,
        paid: received,
        paidDue: paidDue,
        advance: advance,
        advanceMonths: perMonth > 0 ? Math.floor(advance / perMonth) : 0,
        pending: pendingReceived,
        pendingDue: pendingReceived - Math.max(0, pendingReceived - dueVerified),
        pendingAdvance: Math.max(0, pendingReceived - dueVerified),
        due: Math.max(0, expected - received - pendingReceived),
        dueVerified: dueVerified
      };
    }

    async function myPaymentsFor(uid) {
      return getAll('payments', fsMod.query(col('payments'), fsMod.where('memberId', '==', uid)));
    }

    var fb = {

      /* ---------- public ---------- */
      getPublicSnapshot: async function () {
        var settings = await getDoc('settings', 'public');
        var agg = settings && settings.fundTotals;
        if (agg && agg.months) {
          return {
            fundName: (settings && settings.fundName) || 'NextGen Fund', currency: 'BDT',
            nextMeeting: settings && settings.nextMeeting, meetingNote: settings && settings.meetingNote,
            totalFunding: Number(agg.totalFunding) || 0, totalRevenue: Number(agg.totalRevenue) || 0,
            totalLoss: Number(agg.totalLoss) || 0, net: Number(agg.net) || 0,
            memberDeposits: Number(agg.memberDeposits) || 0, memberAdvance: Number(agg.memberAdvance) || 0,
            pendingDue: Number(agg.pendingDue) || 0,
            months: agg.months,
            memberCount: Number(settings && settings.memberCount) || 0,
            monthlyPerShare: settings && settings.monthlyPerShare,
            content: (settings && settings.content) || {},
            updatedAt: agg.updatedAt || (settings && settings.updatedAt)
          };
        }
        var finance = await getAll('finance');
        var usersPub = [];
        try { usersPub = await getAll('users', fsMod.query(col('users'), fsMod.where('role', '==', 'member'))); } catch (e) { usersPub = []; }
        var dbLike = { settings: settings || {}, finance: finance, users: usersPub };
        var months = {};
        finance.forEach(function (f) {
          var m = months[f.month] || (months[f.month] = { month: f.month, funding: 0, revenue: 0, loss: 0 });
          m[f.kind] += Number(f.amount) || 0;
        });
        var tF = 0, tR = 0, tL = 0;
        Object.keys(months).sort().forEach(function (k) {
          /* funding = verified member money + revenue - loss. Both inputs are automatic. */
          months[k].funding = (months[k].deposits || 0) + (months[k].revenue || 0) - (months[k].loss || 0);
          months[k].net = months[k].funding;
          tF += months[k].funding; tR += months[k].revenue; tL += months[k].loss;
        });
        return {
          fundName: (settings && settings.fundName) || 'NextGen Fund', currency: 'BDT',
          nextMeeting: settings && settings.nextMeeting, meetingNote: settings && settings.meetingNote,
          totalFunding: tF, totalRevenue: tR, totalLoss: tL, net: tF + tR - tL,
          memberDeposits: 0, memberAdvance: 0, pendingDue: 0,
          months: Object.keys(months).sort().map(function (k) { return months[k]; }),
          memberCount: usersPub.length
            ? usersPub.filter(function (u) { return u.status === 'active'; }).length
            : (Number(settings && settings.memberCount) || 0),
          monthlyPerShare: settings && settings.monthlyPerShare,
          content: (settings && settings.content) || {},
          updatedAt: settings && settings.updatedAt
        };
      },

      getSettings: async function () {
        var s = await getDoc('settings', 'public');
        return s || { docRequirements: ['Photo ID (NID / Birth Certificate)', 'Passport-size Photograph'] };
      },

      /* ---------- live (real-time) subscriptions ---------- */
      onPublicData: function (cb) {
        var active = true;
        var unsubs = [];
        var timer = null;
        function emit() {
          if (!active) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () {
            if (!active) return;
            fb.getPublicSnapshot().then(function (snap) { if (active) cb(snap); })
              .catch(function (e) { console.warn('live update skipped:', e && e.message); });
          }, 200);
        }
        function watch(ref) {
          return fsMod.onSnapshot(ref, emit, function (e) { console.warn('live listener error:', e && e.message); });
        }
        try {
          unsubs.push(watch(docIn('settings', 'public')));
          unsubs.push(watch(col('finance')));
        } catch (e) {
          unsubs.forEach(function (u) { try { u(); } catch (e2) {} });
          return null;
        }
        return function () {
          active = false;
          if (timer) clearTimeout(timer);
          unsubs.forEach(function (u) { try { u(); } catch (e) {} });
        };
      },

      onMyData: function (cb) {
        var active = true;
        var unsub = null;
        myUid().then(function (uid) {
          if (!active) return;
          try {
            unsub = fsMod.onSnapshot(fsMod.query(col('payments'), fsMod.where('memberId', '==', uid)), function () {
              if (!active) return;
              fb.getMyAccount().then(function (acc) { if (active) cb(acc); }).catch(function () {});
            }, function (e) { console.warn('live listener error:', e && e.message); });
          } catch (e) { /* ignore */ }
        }).catch(function () {});
        return function () { active = false; try { if (unsub) unsub(); } catch (e) {} };
      },

      /* ---------- registration (creates Auth account immediately) ---------- */
      register: async function (data, uname) {
        var cred;
        /* the username must be free: usernames/NAME is the registry every login path reads */
        try {
          var taken = await fsMod.getDoc(docIn('usernames', uname));
          if (taken && taken.exists()) throw err('username-taken', 'same username existed, try with another.');
        } catch (eChk) {
          if (eChk && eChk.code === 'username-taken') throw eChk;
        }
        try {
          cred = await authMod.createUserWithEmailAndPassword(auth, data.email, data.password);
        } catch (e) {
          if (e.code === 'auth/email-already-in-use') throw err('email-held', 'That email is already registered.');
          if (e.code === 'auth/weak-password') throw err('invalid', 'Password must be at least 8 characters.');
          throw err('invalid', e.message);
        }
        var uid = cred.user.uid;
        try {
        var docs = [];
        var docsPending = false;
        for (var i = 0; i < (data.docs || []).length; i++) {
          var d = data.docs[i];
          /* documents already stored in Google Drive keep only their reference here */
          if (d.driveUrl || d.driveFileId) { docs.push({ kind: d.kind, name: d.name, mime: d.mime, size: d.size, driveUrl: d.driveUrl || '', driveFileId: d.driveFileId || '' }); continue; }
          try {
            var path = 'registrations/' + uid + '/' + Date.now() + '-' + d.name;
            var ref = stMod.ref(storage, path);
            if (!d.file) throw new Error('no-file');
            await withTimeout(stMod.uploadBytes(ref, d.file, { contentType: d.mime }), 8000, 'storage-timeout');
            docs.push({ kind: d.kind, name: d.name, mime: d.mime, size: d.size, path: path });
          } catch (e) {
            docsPending = true; /* Drive and Storage both unavailable: keep the compact copy inside the record */
            docs.push({ kind: d.kind, name: d.name, mime: d.mime, size: d.size, dataUrl: d.data || '', storedIn: 'record' });
          }
        }
        var reg = {
          fullName: data.fullName.trim(), username: uname, email: data.email.trim(),
          phone: data.phone.trim(), address: (data.address || '').trim(), occupation: (data.occupation || '').trim(),
          nominee: (data.nominee || '').trim(), nomineeAddress: (data.nomineeAddress || '').trim(),
          nomineePhone: (data.nomineePhone || '').trim(), nomineeRelation: (data.nomineeRelation || '').trim(),
          fatherName: (data.fatherName || '').trim(), motherName: (data.motherName || '').trim(),
          joinMonth: String(data.joinMonth || '').trim(),
          shares: parseInt(data.shares, 10),
          docs: docs, docsPending: docsPending, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, note: ''
        };
        try {
          await fsMod.setDoc(docIn('registrations', uid), reg);
        } catch (e1) {
          if (String(e1 && e1.code) === 'permission-denied') throw err('closed', 'Registration is not open yet - the fund admin has not finished setting up the fund. Please try again later.');
          throw err('invalid', e1.message || 'Could not save the registration.');
        }
        try {
        await fsMod.setDoc(docIn('users', uid), {
          role: 'member', status: 'pending', username: uname, email: data.email.trim(),
          photo: photoOfDocs(reg.docs),
          fullName: data.fullName.trim(), phone: (U.normPhone ? U.normPhone(data.phone) : data.phone), address: reg.address,
          nominee: reg.nominee, nomineeAddress: reg.nomineeAddress || '', nomineePhone: reg.nomineePhone || '',
          joinMonth: reg.joinMonth || '',
          nomineeRelation: reg.nomineeRelation || '', fatherName: reg.fatherName || '', motherName: reg.motherName || '',
          shares: reg.shares, monthlyDue: reg.shares * ((await fb.getSettings()).monthlyPerShare || 1000),
          createdAt: new Date().toISOString()
        });
        } catch (e2) {
          if (String(e2 && e2.code) === 'permission-denied') throw err('closed', 'Registration is not open yet - the fund admin has not finished setting up the fund. Please try again later.');
          throw err('invalid', e2.message || 'Could not save the profile.');
        }
        await fsMod.setDoc(docIn('usernames', uname), { uid: uid, email: data.email.trim() });
        /* the audit entry must be written while the new member is still signed in:
           /audit only allows creates for signed-in users, so after signOut it was
           always rejected (PERMISSION_DENIED) and the entry was lost. */
        await audit(reg.fullName, 'registration-submitted', 'username ' + uname);
        await authMod.signOut(auth);
        return { ok: true, registrationId: uid };
        } catch (eFail) {
          /* the account was created before the rest of the registration ran: if anything after it
             fails, drop that fresh account so the member can retry with the same email. */
          try { await cred.user.delete(); } catch (eDel) { /* best effort, nothing else to do */ }
          throw eFail;
        }
      },

      /* ---------- auth ---------- */
      login: async function (identifier, password) {
        var email = identifier.trim().toLowerCase();
        if (email.indexOf('@') < 0) {
          var map = await getDoc('usernames', email);
          if (!map || !map.uid) throw err('wrong-credentials', 'Wrong username or password.');
          /* the member record holds the address that is actually live in Authentication;
             the registry copy can lag behind after an e-mail change, so it is only a fallback. */
          var rec = null;
          try { rec = await getDoc('users', map.uid); } catch (eRec) { rec = null; }
          var recEmail = (rec && rec.email) ? String(rec.email).toLowerCase() : '';
          email = recEmail || String(map.email || '').toLowerCase();
          if (!email) throw err('wrong-credentials', 'This username has no email on file yet - log in with the email address instead.');
          /* keep the registry in step when it was the stale side */
          if (recEmail && String(map.email || '').toLowerCase() !== recEmail) {
            try { await fsMod.setDoc(docIn('usernames', String(map.id || '')), { uid: map.uid, email: recEmail }); } catch (eSync) { }
          }
        }
        try { await authMod.signInWithEmailAndPassword(auth, email, password); }
        catch (e) { throw err('wrong-credentials', 'Wrong username or password.'); }
        var cu = auth.currentUser;
        var u = await userDoc(cu.uid);
        if (!u) { await authMod.signOut(auth); throw err('wrong-credentials', 'Account not found.'); }
        if (u.status === 'pending') { await authMod.signOut(auth); throw err('pending', 'Your registration is still awaiting admin approval.'); }
        if (u.status === 'rejected') { await authMod.signOut(auth); throw err('rejected', 'Your registration was not approved. Contact the fund admin.'); }
        if (u.status === 'suspended') { await authMod.signOut(auth); throw err('suspended', 'This account is suspended. Contact the fund admin.'); }
        return { uid: cu.uid, role: u.role, username: u.username, fullName: u.fullName };
      },

      logout: async function () { await authMod.signOut(auth); },

      getSession: async function () {
        if (auth.authStateReady) { try { await auth.authStateReady(); } catch (e) {} }
        var cu = auth.currentUser;
        if (!cu) return null;
        var u = await userDoc(cu.uid);
        if (!u) return null;
        return { uid: cu.uid, role: u.role, username: u.username, fullName: u.fullName };
      },

      onSession: function (cb) {
        authMod.onAuthStateChanged(auth, async function (cu) {
          if (!cu) return cb(null);
          var u = await userDoc(cu.uid);
          cb(u ? { uid: cu.uid, role: u.role, username: u.username, fullName: u.fullName } : null);
        });
      },

      updateMyName: async function (name) {
        var uid = await myUid();
        var clean = String(name || '').trim();
        if (clean.length < 2) throw err('invalid', 'Enter your name (min 2 characters).');
        await fsMod.updateDoc(docIn('users', uid), { fullName: clean });
        await audit(clean, 'profile-updated', 'display name changed');
        return { fullName: clean };
      },

      changePassword: async function (currentPw, newPw) {
        var cu = auth.currentUser;
        if (!cu) throw err('unauthenticated', 'Please log in');
        if (!newPw || newPw.length < 8) throw err('invalid', 'New password must be at least 8 characters.');
        var cred = authMod.EmailAuthProvider.credential(cu.email, currentPw);
        try {
          await authMod.reauthenticateWithCredential(cu, cred);
        } catch (e) {
          throw err('wrong-credentials', 'Current password is incorrect.');
        }
        await authMod.updatePassword(cu, newPw);
        await audit((cu.email || ''), 'password-changed', 'own password changed');
        return { ok: true };
      },

      setupAdmin: async function (data) {
        if (await fb.adminExists()) throw err('exists', 'An admin account already exists.');
        // Claim bootstrap: sign in/up, then write settings/bootstrap with own uid.
        var cu = auth.currentUser;
        if (!cu) {
          if (!data.email || !data.password) throw err('invalid', 'Enter email and password (min 8 characters).');
          try { await authMod.signInWithEmailAndPassword(auth, data.email, data.password); }
          catch (e) {
            try { await authMod.createUserWithEmailAndPassword(auth, data.email, data.password); }
            catch (e2) { throw err('invalid', e2.message); }
          }
          cu = auth.currentUser;
        }
        var uname = (data.username || 'admin').trim().toLowerCase();
        await fsMod.setDoc(docIn('settings', 'bootstrap'), { adminUid: cu.uid, claimedAt: new Date().toISOString() });
        await fsMod.setDoc(docIn('users', cu.uid), {
          role: 'admin', status: 'active', username: uname, email: cu.email || (uname + '@nextgen.local'),
          fullName: data.fullName || 'Fund Administrator', phone: '', address: '', shares: 0,
          monthlyDue: 0, joinMonth: '', createdAt: new Date().toISOString()
        }, { merge: true });
        await fsMod.setDoc(docIn('usernames', uname), { uid: cu.uid, email: cu.email || '' });
        if (!(await getDoc('settings', 'public'))) {
          await fsMod.setDoc(docIn('settings', 'public'), {
            fundName: 'NextGen Fund', currency: 'BDT', monthlyPerShare: 1000,
            nextMeeting: '', meetingNote: '', paymentNumbers: {}, 
            docRequirements: ['Photo ID (NID / Birth Certificate)', 'Passport-size Photograph'],
            updatedAt: new Date().toISOString()
          });
        }
        await audit(uname, 'admin-created', 'bootstrap claim');
        await syncPublicTotals();
        return { ok: true };
      },

      adminExists: async function () {
        var b = await getDoc('settings', 'bootstrap');
        return !!(b && b.adminUid);
      },

      /* ---------- member ---------- */
      /* If an e-mail change was completed on Firebase's own verification page, Authentication
         already has the new address while the record still shows the old one. Reading the account
         reconciles the two, so the profile, the login and the registry always agree. */
      reconcileEmail: async function () {
        var user = auth.currentUser;
        if (!user) return null;
        var uid = user.uid;
        var live = String(user.email || '').trim();
        if (!live) return null;
        var doc = await userDoc(uid);
        if (!doc) return null;
        var mine = String(doc.email || '');
        if (mine.toLowerCase() === live.toLowerCase() && !doc.emailChangePending) return null;
        var patch = { email: live, emailChangePending: null, emailChangedAt: new Date().toISOString() };
        await fsMod.updateDoc(docIn('users', uid), patch);
        try {
          var un = String(doc.username || '').toLowerCase();
          if (un) await fsMod.setDoc(docIn('usernames', un), { uid: uid, email: live });
        } catch (eMap) { }
        await writeAudit({ action: 'email.changed', memberId: uid, detail: mine + ' -> ' + live + ' (reconciled from the login account)' });
        return { from: mine, to: live };
      },

      getMyAccount: async function () {
        var uid = await myUid();
        var u = await userDoc(uid);
        if (!u) throw err('not-found', 'Account not found');
        var payments = await myPaymentsFor(uid);
        payments.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
        return {
          profile: Object.assign({ id: uid }, u),
          balance: computeBalance(u, payments),
          payments: payments
        };
      },

      getMyPayments: async function () { return myPaymentsFor(await myUid()); },
      applyEmailChange: applyEmailChange,
    createAccountRequest: createAccountRequest,
      listAccountRequests: listAccountRequests,
      decideAccountRequest: decideAccountRequest,
      createNomineeRequest: createNomineeRequest,
      listNomineeRequests: listNomineeRequests,
      decideNomineeRequest: decideNomineeRequest,
      uploadToDrive: uploadToDrive,
      getDriveEndpoint: getDriveEndpoint,
      saveDriveEndpoint: saveDriveEndpoint,

      /* Resolve an e-mail / username / mobile number to the account e-mail and ask Firebase to
         send the reset link. Nothing is changed by us: the owner follows the e-mail. */
      requestPasswordReset: async function (identifier) {
        var id = String(identifier || '').trim();
        if (!id) throw err('invalid', 'Enter your e-mail, username or mobile number.');
        var email = '';
        if (id.indexOf('@') > 0) {
          email = id.toLowerCase();
        } else {
          var digits = U.phoneKey ? U.phoneKey(id) : id.replace(/[^0-9]/g, '');
          if (digits && /^01[0-9]{9}$/.test(digits)) {
            try {
              var ph = await fsMod.getDoc(docIn('phones', digits));
              if (ph.exists()) email = String((ph.data() || {}).email || '').toLowerCase();
            } catch (e) { /* the phones map may not be published yet; fall through */ }
          }
          if (!email) {
            try {
              var un = await fsMod.getDoc(docIn('usernames', id.toLowerCase()));
              if (un.exists()) email = String((un.data() || {}).email || '').toLowerCase();
            } catch (e2) { /* ignore */ }
          }
        }
        if (!email) throw err('notfound', 'No account matches that e-mail, username or mobile number.');
        try {
          await authMod.sendPasswordResetEmail(auth, email);
        } catch (e3) {
          var code = String((e3 && e3.code) || '');
          if (code.indexOf('too-many-requests') >= 0) throw err('rate', 'Too many attempts - wait a few minutes and try again.');
          if (code.indexOf('invalid-email') >= 0) throw err('invalid', 'That e-mail address is not valid.');
          throw err('reset', 'The reset e-mail could not be sent right now. Try again shortly.');
        }
        var at = email.indexOf('@');
        var masked = at > 1 ? email.slice(0, 2) + '***' + email.slice(at) : '***';
        await audit(email, 'password-reset-requested', 'reset link sent');
        return { ok: true, sentTo: masked };
      },

      submitPayment: async function (data) {
        var uid = await myUid();
        var u = await userDoc(uid);
        /* The admin must never file a payment (least of all for themselves): the admin verifies
           member payments, they are not a payer in this ledger. */
        if (u && u.role === 'admin') {
          throw err('admin-not-payer', 'The fund admin cannot submit payments. The admin only verifies the payments members send.');
        }
        var amount = Number(data.amount);
        if (!(amount > 0)) throw err('invalid', 'Enter an amount greater than 0.');
        if (amount % 1000 !== 0 || amount < 1000) throw err('invalid', 'Amount must be a multiple of 1,000 tk (1x1000, 2x1000, 3x1000, ...).');
        if (S.METHODS.indexOf(data.method) < 0) throw err('invalid', 'Choose a payment method.');
        if (data.type !== 'due' && data.type !== 'advance') throw err('invalid', 'Choose Due payment or Advance payment.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) throw err('invalid', 'Enter the payment date.');
        var ref = (data.ref || '').trim();
        if (data.method !== 'cash' && ref.length < 4) throw err('invalid', 'Enter the transaction ID / reference (min 4 characters).');
        var existing = await myPaymentsFor(uid);
        var dup = existing.find(function (p) { return p.method === data.method && p.ref && p.ref.toLowerCase() === ref.toLowerCase() && p.status !== 'rejected'; });
        if (dup && ref) throw err('dup-ref', 'This transaction ID was already submitted.');
        var p = {
          memberId: uid, memberName: (u && u.fullName) || '', type: data.type, method: data.method,
          amount: amount, date: data.date, ref: ref, senderNumber: (data.senderNumber || '').trim(),
          note: (data.note || '').trim(), status: 'pending', submittedAt: new Date().toISOString(),
          verifiedAt: null, verifiedBy: null, rejectReason: ''
        };
        var created = await fsMod.addDoc(col('payments'), p);
        await audit(u ? u.username : uid, 'payment-submitted', data.method + ' ' + data.type + ' ' + amount + ' ref ' + ref);
        return { ok: true, paymentId: created.id };
      },

      /* ---------- admin ---------- */
      listRegistrations: async function (status) {
        await requireAdminUid();
        var list = await getAll('registrations');
        if (status) list = list.filter(function (r) { return r.status === status; });
        return list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
      },

      decideRegistration: async function (regId, approve, note) {
        var me = await requireAdminUid();
        var r = await getDoc('registrations', regId);
        if (!r) throw err('not-found', 'Registration not found');
        if (r.status !== 'pending') throw err('invalid', 'Already decided.');
        await fsMod.updateDoc(docIn('registrations', regId), {
          status: approve ? 'approved' : 'rejected', decidedAt: new Date().toISOString(),
          decidedBy: me.user.username || 'admin', note: note || ''
        });
        var memberPatch = {
          status: approve ? 'active' : 'rejected',
          joinMonth: approve ? ((r && r.joinMonth) || U.currentMonth()) : '',
          monthlyDue: approve ? (r.shares * ((await fb.getSettings()).monthlyPerShare || 1000)) : 0
        };
        /* approvals also refresh the uploaded profile picture on the member record */
        var ph = photoOfDocs(r.docs);
        if (ph) memberPatch.photo = ph;
        await fsMod.updateDoc(docIn('users', regId), memberPatch);
        await syncPublicTotals();
        await audit(me.user.username, approve ? 'registration-approved' : 'registration-rejected', r.username + (note ? ' — ' + note : ''));
        return { ok: true, decidedAt: new Date().toISOString() };
      },

      listMembers: async function () {
        await requireAdminUid();
        var users = await getAll('users', fsMod.query(col('users'), fsMod.where('role', '==', 'member')));
        var payments = await getAll('payments');
        return users.map(function (u) {
          return Object.assign({}, u, { id: u.id, balance: computeBalance(u, payments.filter(function (p) { return p.memberId === u.id; })) });
        }).sort(function (a, b) { return (a.fullName || '').localeCompare(b.fullName || ''); });
      },

      getMemberDetail: async function (memberId) {
        await requireAdminUid();
        var u = await userDoc(memberId);
        if (!u) throw err('not-found', 'Member not found');
        var payments = await myPaymentsFor(memberId);
        payments.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
        return { profile: Object.assign({ id: memberId }, u), balance: computeBalance(u, payments), payments: payments };
      },

      updateMember: async function (memberId, patch) {
        var me = await requireAdminUid();
        var allowed = {};
        ['fullName', 'phone', 'address', 'joinMonth', 'status', 'fatherName', 'motherName', 'nomineeRelation'].forEach(function (k) { if (patch[k] !== undefined) allowed[k] = patch[k]; });
        if (patch.shares !== undefined) {
          var sh = parseInt(patch.shares, 10);
          if (!(sh >= 0 && sh <= 20)) throw err('invalid', 'Shares must be 0\u201320.');
          allowed.shares = sh;
          if (patch.monthlyDue === undefined) allowed.monthlyDue = sh * ((await fb.getSettings()).monthlyPerShare || 1000);
        }
        if (patch.monthlyDue !== undefined) allowed.monthlyDue = Number(patch.monthlyDue) || 0;
        await fsMod.updateDoc(docIn('users', memberId), allowed);
        await syncPublicTotals();
        await audit(me.user.username, 'member-updated', memberId);
        return { ok: true };
      },

      listPayments: async function (filter) {
        await requireAdminUid();
        var list = await getAll('payments');
        var st = U.normPayFilter(filter);
        if (st) list = list.filter(function (p) { return p.status === st; });
        return list.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
      },

      /* Same numbers as the demo backend — one shared implementation. */
      paymentStats: async function () {
        await requireAdminUid();
        return U.summarisePayments(await getAll('payments'));
      },

      verifyPayment: async function (paymentId) {
        var me = await requireAdminUid();
        var pay = await getDoc('payments', paymentId);
        if (!pay) throw err('not-found', 'Payment not found');
        /* parity with the demo store: only a pending payment may change state,
           otherwise a second click (or a stale row) would silently flip a
           verified payment and move money out of the fund totals. */
        if (pay.status !== 'pending') throw err('invalid', 'Only pending payments can be verified.');
        await fsMod.updateDoc(docIn('payments', paymentId), {
          status: 'verified', verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin'
        });
        await audit(me.user.username, 'payment-verified', paymentId);
        await syncPublicTotals();
        return { ok: true };
      },


      /* ---------- full reset (admin only) ----------
         Empties every application collection, then deletes the two configuration
         documents, then optionally the caller's own sign-in account. Needs the v3
         rules (see docs/database-reset-runbook.md).

         Two orderings are deliberate:
         - the per-collection counts are gathered and reported BEFORE
           settings/bootstrap is released, because releasing the bootstrap ends
           the admin's own rights - anything read afterwards comes back denied;
         - the caller's Auth account is deleted LAST, so a failure part-way still
           leaves a usable admin sign-in to retry with. */
      resetDatabase: async function (opts) {
        opts = opts || {};
        var me = await requireAdminUid();
        var onStep = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
        var report = { collections: {}, deleted: 0, errors: [] };
        var order = ['payments', 'registrations', 'audit', 'usernames', 'users', 'finance'];
        for (var i = 0; i < order.length; i++) {
          var name = order[i];
          var docs = [];
          try {
            docs = await getAll(name);
          } catch (e) {
            /* e.g. the admin rights are already gone because an earlier partial reset released
               settings/bootstrap: report it and carry on with the other collections */
            report.errors.push(name + ': ' + (e.code || e.message || 'denied'));
            report.collections[name] = null;
            onStep('skipped /' + name + ' (' + (e.code || e.message || 'denied') + ')');
            continue;
          }
          for (var k = 0; k < docs.length; k++) {
            try { await fsMod.deleteDoc(docIn(name, docs[k].id)); report.deleted++; }
            catch (e) { report.errors.push(name + '/' + docs[k].id + ': ' + (e.code || e.message)); }
          }
          report.collections[name] = docs.length;
          onStep('deleted ' + docs.length + ' from /' + name);
        }
        for (var s = 0; s < 2; s++) {
          var which = s === 0 ? 'public' : 'bootstrap';
          try { await fsMod.deleteDoc(docIn('settings', which)); onStep('deleted settings/' + which); }
          catch (e) { report.errors.push('settings/' + which + ': ' + (e.code || e.message)); }
        }
        if (opts.deleteAccount && auth.currentUser) {
          try { await authMod.deleteUser(auth.currentUser); report.accountDeleted = true; onStep('deleted my sign-in account'); }
          catch (e) { report.accountDeleted = false; report.errors.push('auth: ' + (e.code || e.message)); }
        }
        return report;
      },

      /* ---------- flat inventory for the reset screen ---------- */
      resetInventory: async function () {
        await requireAdminUid();
        var out = {};
        var names = ['users', 'payments', 'registrations', 'audit', 'usernames', 'finance'];
        for (var i = 0; i < names.length; i++) {
          try { out[names[i]] = (await getAll(names[i])).length; } catch (e) { out[names[i]] = null; }
        }
        out.adminExists = await fb.adminExists();
        return out;
      },
      rejectPayment: async function (paymentId, reason) {
        var me = await requireAdminUid();
        var pay = await getDoc('payments', paymentId);
        if (!pay) throw err('not-found', 'Payment not found');
        /* rejecting an already verified/rejected payment would silently remove
           money from the member balance - refuse it, exactly like the demo store. */
        if (pay.status !== 'pending') throw err('invalid', 'Only pending payments can be rejected.');
        await fsMod.updateDoc(docIn('payments', paymentId), {
          status: 'rejected', verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin', rejectReason: reason || ''
        });
        await audit(me.user.username, 'payment-rejected', paymentId + ' ' + (reason || ''));
        await syncPublicTotals();
        return { ok: true };
      },

      addManualPayment: async function (data) {
        var me = await requireAdminUid();
        var u = await userDoc(data.memberId);
        if (!u) throw err('not-found', 'Member not found');
        var amount = Number(data.amount);
        if (!(amount > 0)) throw err('invalid', 'Amount must be > 0.');
        if (amount % 1000 !== 0 || amount < 1000) throw err('invalid', 'Amount must be a multiple of 1,000 tk (1x1000, 2x1000, 3x1000, ...).');
        var method = S.METHODS.indexOf(data.method) >= 0 ? data.method : 'cash';
        var ref = (data.ref || '').trim();
        /* one transaction ID = one payment row, exactly like a member submission */
        if (ref) {
          var allPays = await getAll('payments');
          var dupRef = allPays.filter(function (x) {
            return x.memberId === data.memberId && x.method === method && x.status !== 'rejected' &&
              String(x.ref || '').toLowerCase() === ref.toLowerCase();
          })[0];
          if (dupRef) throw err('dup-ref', 'This transaction ID is already recorded for this member.');
        }
        var p = {
          memberId: data.memberId, memberName: u.fullName, type: data.type === 'advance' ? 'advance' : 'due',
          method: method, amount: amount,
          date: data.date || U.todayISO(), ref: ref, senderNumber: '',
          note: ((data.note || '').trim() + ' (recorded by admin)').trim(),
          status: 'verified', submittedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin', rejectReason: ''
        };
        var created = await fsMod.addDoc(col('payments'), p);
        await audit(me.user.username, 'payment-recorded-manually', u.username + ' ' + amount);
        await syncPublicTotals();
        return { ok: true, paymentId: created.id };
      },

      listFinance: async function () {
        await requireAdminUid();
        var list = await getAll('finance');
        return list.sort(function (a, b) { return a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind); });
      },

      upsertFinanceEntry: async function (entry) {
        var me = await requireAdminUid();
        if (['funding', 'revenue', 'loss'].indexOf(entry.kind) < 0) throw err('invalid', 'Invalid kind.');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.month || '')) throw err('invalid', 'Pick a month.');
        if (!(Number(entry.amount) > 0)) throw err('invalid', 'Amount must be greater than 0.');
        var body = { kind: entry.kind, month: entry.month, amount: Number(entry.amount), note: entry.note || '' };
        if (entry.id) await fsMod.setDoc(docIn('finance', entry.id), body, { merge: true });
        else await fsMod.addDoc(col('finance'), body);
        await audit(me.user.username, entry.id ? 'finance-updated' : 'finance-added', entry.kind + ' ' + entry.month);
        await syncPublicTotals();
        return { ok: true };
      },

      deleteFinanceEntry: async function (id) {
        var me = await requireAdminUid();
        await fsMod.deleteDoc(docIn('finance', id));
        await audit(me.user.username, 'finance-deleted', id);
        await syncPublicTotals();
        return { ok: true };
      },

      saveSettings: async function (patch) {
        var me = await requireAdminUid();
        var uid = (me && (me.uid || (me.user && (me.user.id || me.user.uid)))) || '';
        patch.updatedAt = new Date().toISOString();
        patch.updatedByUid = uid;
        patch.updatedBy = (me.user && me.user.username) || '';
        try {
          await fsMod.setDoc(docIn('settings', 'public'), patch, { merge: true });
        } catch (e) {
          if (String(e && e.code) === 'permission-denied') {
            throw err('denied', 'Only the fund admin account can save settings. Sign in with the account created at setup (settings/bootstrap) and try again.');
          }
          throw err('denied', (e && e.message) || 'Could not save the settings.');
        }
        await audit((me.user && me.user.username) || '', 'settings-updated', Object.keys(patch).join(', ') + ' | uid ' + uid);
        await syncPublicTotals();
        return { ok: true };
      },

      listAudit: async function () {
        await requireAdminUid();
        return (await getAll('audit')).sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); }).slice(0, 200);
      },

      exportMembersCSV: async function () {
        var members = await fb.listMembers();
        var rows = [['id', 'username', 'fullName', 'email', 'phone', 'address', 'shares', 'monthlyDue', 'joinMonth', 'status', 'totalPaid', 'currentDue', 'advance']];
        members.forEach(function (u) {
          rows.push([u.id, u.username, u.fullName, u.email, u.phone, u.address, u.shares, u.monthlyDue, u.joinMonth, u.status, u.balance.paid, u.balance.due, u.balance.advance]);
        });
        return U.csv(rows);
      },

      exportPaymentsCSV: async function () {
        await requireAdminUid();
        var payments = await getAll('payments');
        var users = await getAll('users');
        var rows = [['id', 'paymentDate', 'memberName', 'username', 'type', 'method', 'amount', 'transactionRef', 'senderNumber', 'status', 'submittedAt', 'verifiedAt', 'verifiedBy', 'rejectReason', 'note']];
        payments.forEach(function (p) {
          var u = users.find(function (x) { return x.id === p.memberId; });
          rows.push([p.id, p.date, p.memberName, u ? u.username : '', p.type, p.method, p.amount, p.ref, p.senderNumber, p.status, p.submittedAt, p.verifiedAt || '', p.verifiedBy || '', p.rejectReason || '', p.note]);
        });
        return U.csv(rows);
      },

      exportFinanceCSV: async function () {
        await requireAdminUid();
        var rows = [['id', 'kind', 'month', 'amount', 'note']];
        (await getAll('finance')).forEach(function (f) { rows.push([f.id, f.kind, f.month, f.amount, f.note]); });
        return U.csv(rows);
      }
    };

    return fb;
  });
})();
