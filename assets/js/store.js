/* ============================================================
   NextGen Fund — data layer (UMD: browser + Node)
   Two interchangeable backends behind one async API:
     · demo     — self-contained, stores everything in localStorage
                  (seeded from seed-data.js). Perfect for preview.
     · firebase — real multi-user backend (Auth + Firestore +
                  Storage). Activates automatically when
                  firebase-config.js is filled AND the adapter is
                  registered (see firebase-adapter.js).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.NGFStore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var U = (typeof self !== 'undefined' && self.NGFUtil) || (typeof require !== 'undefined' ? require('./util.js') : null);
  if (!U) throw new Error('NGFUtil must be loaded before NGFStore');

  var DB_KEY = 'ngf_db_v1';
  var SESSION_KEY = 'ngf_session_v1';
  var METHODS = ['bkash', 'nagad', 'rocket', 'upay', 'bank', 'cash'];
  var DOC_MAX_DEMO = 1.2 * 1024 * 1024; // demo storage quota guard
  var DOC_MAX_LIVE = 5 * 1024 * 1024;

  /* ---------- storage shim (browser localStorage or Node test shim) ---------- */
  var LS = null;
  try { if (typeof localStorage !== 'undefined') LS = localStorage; } catch (e) { LS = null; }
  function lsGet(k) { return LS ? LS.getItem(k) : (Store._mem[k] || null); }
  function lsSet(k, v) { if (LS) LS.setItem(k, v); else Store._mem[k] = v; }
  function lsDel(k) { if (LS) LS.removeItem(k); else delete Store._mem[k]; }

  var Store = {
    mode: 'demo',
    _mem: {},
    _db: null,
    _session: null,
    _fbFactory: null,
    _fb: null,
    METHODS: METHODS,

    registerFirebaseBackend: function (factory) { this._fbFactory = factory; },

    hasFirebaseConfig: function () {
      var c = (typeof self !== 'undefined' && self.NGF_FIREBASE_CONFIG) || {};
      return !!(c.apiKey && c.projectId && this._fbFactory);
    },

    docLimit: function () { return this.mode === 'firebase' ? DOC_MAX_LIVE : DOC_MAX_DEMO; },

    init: async function () {
      if (this.hasFirebaseConfig()) {
        try {
          this._fb = await this._fbFactory();
          this.mode = 'firebase';
          return { mode: 'firebase' };
        } catch (e) {
          this.mode = 'demo'; // fall back (e.g. CSP-blocked preview)
        }
      }
      this.mode = 'demo';
      var rawDb = lsGet(DB_KEY);
      var storedDb = null;
      if (rawDb) { try { storedDb = JSON.parse(rawDb); } catch (e) { storedDb = null; } }
      var seedV = currentSeedVersion();
      if (!storedDb || storedDb.seedVersion !== seedV) {
        /* Stale or corrupt demo DB (older seed) -> refresh to the bundled seed.
           Without this, browsers that visited before a seed update keep showing
           empty payment history and zero balances after login. */
        lsSet(DB_KEY, JSON.stringify(buildSeed()));
      }
      this._db = null;
      var s = lsGet(SESSION_KEY);
      if (s) { try { this._session = JSON.parse(s); } catch (e) { this._session = null; } }
      return { mode: 'demo' };
    },

    /* =============== internal helpers (demo) =============== */
    _d: function () {
      if (!this._db) this._db = JSON.parse(lsGet(DB_KEY) || 'null');
      if (!this._db) { this._db = buildSeed(); lsSet(DB_KEY, JSON.stringify(this._db)); }
      ensureDefaults(this._db);
      return this._db;
    },
    _save: function () { lsSet(DB_KEY, JSON.stringify(this._db)); },
    _resetDemo: function () { lsDel(DB_KEY); lsDel(SESSION_KEY); this._db = null; this._session = null; },
    _audit: function (actor, action, detail) {
      var db = this._d();
      db.audit.unshift({ id: U.uid('a'), at: new Date().toISOString(), actor: actor, action: action, detail: detail || '' });
      if (db.audit.length > 500) db.audit.length = 500;
    },
    _requireAdmin: function () {
      var s = this._session;
      if (!s || s.role !== 'admin') { var e = new Error('Admin access required'); e.code = 'forbidden'; throw e; }
    },
    _requireLogin: function () {
      var s = this._session;
      if (!s) { var e = new Error('Please log in'); e.code = 'unauthenticated'; throw e; }
      return s;
    }
  };

  /* =============== seed =============== */
  function currentSeedVersion() {
    var seed = (typeof self !== 'undefined' && self.NGF_SEED) ||
      (typeof require !== 'undefined' ? require('./seed-data.js') : null);
    return (seed && seed.seedVersion) || 1;
  }
  function buildSeed() {
    var seed = (typeof self !== 'undefined' && self.NGF_SEED) ||
      (typeof require !== 'undefined' ? require('./seed-data.js') : null);
    if (!seed) throw new Error('NGF_SEED missing');
    var db = JSON.parse(JSON.stringify(seed));
    // admin account (demo) + member passwords
    var adminPw = U.sha256('nextgen2026');
    var memberPw = U.sha256('nextgen123');
    db.users.push({
      id: 'm-admin', username: 'admin', email: 'admin@nextgen.local', fullName: 'Fund Administrator',
      phone: '', address: '', shares: 0, monthlyDue: 0, joinMonth: db.settings ? '' : '',
      status: 'active', role: 'admin', passHash: adminPw, createdAt: new Date().toISOString()
    });
    db.users.forEach(function (u) { if (u.role !== 'admin' && !u.passHash) u.passHash = memberPw; });
    return db;
  }

  /* =============== defaults migration (older local DBs) =============== */
  var DEFAULT_CONTENT = {
    en: { sub: '', notice: '', how1: '', how2: '', how3: '', how4: '' },
    bn: { sub: '', notice: '', how1: '', how2: '', how3: '', how4: '' }
  };
  function ensureDefaults(db) {
    if (!db.settings) db.settings = {};
    if (!db.settings.content) db.settings.content = JSON.parse(JSON.stringify(DEFAULT_CONTENT));
    if (!db.settings.content.en) db.settings.content.en = DEFAULT_CONTENT.en;
    if (!db.settings.content.bn) db.settings.content.bn = DEFAULT_CONTENT.bn;
  }

  /* =============== shared calculations =============== */
  function computeBalance(user, payments, nowMonth) {
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

  function snapshotFromData(db) {
    var months = {};
    (db.finance || []).forEach(function (f) {
      var m = months[f.month] || (months[f.month] = { month: f.month, funding: 0, revenue: 0, loss: 0, deposits: 0 });
      m[f.kind] += Number(f.amount) || 0;
    });
    /* verified member deposits are fund income as well. Advances count too:
       the money is in the fund, it is member credit until billed. */
    var memberDeposits = 0;
    (db.payments || []).forEach(function (p) {
      if (p.status !== 'verified') return;
      var mk = String(p.date || '').slice(0, 7);
      if (!mk) return; /* a dateless payment cannot be placed in a month row */
      memberDeposits += Number(p.amount) || 0;
      var mm = months[mk] || (months[mk] = { month: mk, funding: 0, revenue: 0, loss: 0, deposits: 0 });
      mm.funding += Number(p.amount) || 0;
      mm.deposits = (mm.deposits || 0) + (Number(p.amount) || 0);
    });
    var totalFunding = 0, totalRevenue = 0, totalLoss = 0;
    Object.keys(months).sort().forEach(function (k) {
      totalFunding += months[k].funding; totalRevenue += months[k].revenue; totalLoss += months[k].loss;
    });
    var memberCount = (db.users || []).filter(function (u) { return u.role === 'member' && u.status === 'active'; }).length;
    var memberAdvance = 0, pendingDue = 0;
    (db.users || []).filter(function (u) { return u.role === 'member' && u.status === 'active'; }).forEach(function (u) {
      var mine = (db.payments || []).filter(function (p) { return p.memberId === u.id; });
      var bal = computeBalance(u, mine, U.currentMonth());
      memberAdvance += bal.advance;
      pendingDue += bal.pendingDue;
    });
    var list = Object.keys(months).sort().map(function (k) { return months[k]; });
    return {
      fundName: db.settings.fundName, currency: db.settings.currency || 'BDT',
      nextMeeting: db.settings.nextMeeting, meetingNote: db.settings.meetingNote,
      totalFunding: totalFunding, totalRevenue: totalRevenue, totalLoss: totalLoss,
      net: totalFunding + totalRevenue - totalLoss,
      months: list, memberCount: memberCount,
      memberDeposits: memberDeposits, memberAdvance: memberAdvance, pendingDue: pendingDue,
      monthlyPerShare: db.settings.monthlyPerShare,
      content: db.settings.content || {},
      updatedAt: db.settings.updatedAt
    };
  }

  /* ================================================================
     PUBLIC API (async, both backends)
     ================================================================ */
  var API = {

    /* ---------- public dashboard ---------- */
    getPublicSnapshot: async function () {
      if (Store.mode === 'firebase') return Store._fb.getPublicSnapshot();
      return snapshotFromData(Store._d());
    },

    /* live updates (Firebase mode only; returns null in demo) */
    onPublicData: function (cb) {
      if (Store.mode === 'firebase' && Store._fb && Store._fb.onPublicData) return Store._fb.onPublicData(cb);
      return null;
    },

    onMyData: function (cb) {
      if (Store.mode === 'firebase' && Store._fb && Store._fb.onMyData) return Store._fb.onMyData(cb);
      return null;
    },

    /* ---------- registration ---------- */
    register: async function (data) {
      var mode = Store.mode;
      var settings = mode === 'firebase' ? await Store._fb.getSettings() : Store._d().settings;
      var errs = [];
      if (!data.fullName || data.fullName.trim().length < 3) errs.push('Full name is required.');
      var uname = (data.username || '').trim().toLowerCase();
      if (!U.validUsername(uname)) errs.push('Username must be 4\u201332 characters (letters, numbers, dot, dash).');
      if (!U.validEmail(data.email || '')) errs.push('A valid email is required.');
      if (!data.phone || data.phone.replace(/\D/g, '').length < 10) errs.push('A valid mobile number is required.');
      if (!data.password || data.password.length < 8) errs.push('Password must be at least 8 characters.');
      var shares = parseInt(data.shares, 10);
      if (!(shares >= 1 && shares <= 10)) errs.push('Shares must be between 1 and 10.');
      var reqDocs = settings.docRequirements || [];
      var docs = data.docs || [];
      /* Documents are optional while Firebase Storage is not enabled:
         missing files are collected by the admin directly (registration.docsPending). */
      (data.docs || []).forEach(function (d) {
        var limit = mode === 'firebase' ? DOC_MAX_LIVE : DOC_MAX_DEMO;
        if (d.size > limit) errs.push('File too large (max ' + Math.round(limit / 1048576) + ' MB): ' + d.name);
      });
      if (errs.length) { var e = new Error(errs.join(' ')); e.code = 'invalid'; throw e; }

      if (mode === 'firebase') return Store._fb.register(data, uname);

      var db = Store._d();
      var takenU = db.users.some(function (u) { return u.username.toLowerCase() === uname; }) ||
        db.registrations.some(function (r) { return r.username.toLowerCase() === uname && r.status === 'pending'; });
      if (takenU) { var e2 = new Error('That username is already taken.'); e2.code = 'invalid'; throw e2; }
      if (db.users.some(function (u) { return u.email.toLowerCase() === data.email.toLowerCase(); }) ||
        db.registrations.some(function (r) { return r.email.toLowerCase() === data.email.toLowerCase() && r.status === 'pending'; })) {
        var e3 = new Error('That email is already registered.'); e3.code = 'invalid'; throw e3;
      }
      var reg = {
        id: U.uid('reg'), fullName: data.fullName.trim(), username: uname, email: data.email.trim(),
        phone: data.phone.trim(), address: (data.address || '').trim(), occupation: (data.occupation || '').trim(),
        nominee: (data.nominee || '').trim(), shares: shares,
        passwordHash: U.sha256(data.password),
        docs: docs.map(function (d) { return { kind: d.kind, name: d.name, mime: d.mime, size: d.size, data: d.data }; }),
        status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, note: ''
      };
      db.registrations.unshift(reg);
      Store._audit(reg.fullName, 'registration-submitted', 'username ' + reg.username);
      Store._save();
      return { ok: true, registrationId: reg.id };
    },

    /* ---------- auth ---------- */
    login: async function (identifier, password) {
      if (!identifier || !password) { var e0 = new Error('Enter your username/email and password.'); e0.code = 'invalid'; throw e0; }
      if (Store.mode === 'firebase') return Store._fb.login(identifier, password);
      var db = Store._d();
      var id = identifier.trim().toLowerCase();
      var u = db.users.find(function (x) { return x.username.toLowerCase() === id || x.email.toLowerCase() === id; });
      if (!u) {
        var reg = db.registrations.find(function (x) { return x.username.toLowerCase() === id || x.email.toLowerCase() === id; });
        if (reg && reg.status === 'pending') { var er = new Error('Your registration is still awaiting admin approval.'); er.code = 'pending'; throw er; }
        if (reg && reg.status === 'rejected') { var erj = new Error('Your registration was not approved. Contact the fund admin.'); erj.code = 'rejected'; throw erj; }
        var en = new Error('Wrong username or password.'); en.code = 'wrong-credentials'; throw en;
      }
      if (u.passHash !== U.sha256(password)) {
        var e = new Error('Wrong username or password.'); e.code = 'wrong-credentials'; throw e;
      }
      if (u.status === 'pending') { var e1 = new Error('Your registration is still awaiting admin approval.'); e1.code = 'pending'; throw e1; }
      if (u.status === 'rejected') { var e2 = new Error('Your registration was not approved. Contact the fund admin.'); e2.code = 'rejected'; throw e2; }
      if (u.status === 'suspended') { var e3 = new Error('This account is suspended. Contact the fund admin.'); e3.code = 'suspended'; throw e3; }
      Store._session = { uid: u.id, role: u.role, username: u.username, fullName: u.fullName };
      lsSet(SESSION_KEY, JSON.stringify(Store._session));
      return Store._session;
    },

    logout: async function () {
      if (Store.mode === 'firebase') return Store._fb.logout();
      Store._session = null; lsDel(SESSION_KEY);
    },

    getSession: async function () {
      if (Store.mode === 'firebase') return Store._fb.getSession();
      return Store._session;
    },

    updateMyName: async function (name) {
      if (Store.mode === 'firebase') return Store._fb.updateMyName(name);
      var clean = String(name || '').trim();
      if (clean.length < 2) { var e0 = new Error('Enter your name (min 2 characters).'); e0.code = 'invalid'; throw e0; }
      var db = Store._d();
      var s0 = await Store.getSession();
      if (!s0) { var e1 = new Error('Please log in.'); e1.code = 'forbidden'; throw e1; }
      var u0 = db.users.filter(function (x) { return x.id === s0.uid; })[0];
      if (!u0) throw new Error('Account not found');
      u0.fullName = clean;
      db.audit.unshift({ id: U.uid('a'), at: new Date().toISOString(), actor: u0.username, action: 'profile-updated', detail: 'display name changed' });
      Store._save();
      return { fullName: clean };
    },

    changePassword: async function (currentPw, newPw) {
      if (!newPw || newPw.length < 8) { var e = new Error('New password must be at least 8 characters.'); e.code = 'invalid'; throw e; }
      if (Store.mode === 'firebase') return Store._fb.changePassword(currentPw, newPw);
      var s = Store._requireLogin();
      var db = Store._d();
      var u = db.users.find(function (x) { return x.id === s.uid; });
      if (!u || u.passHash !== U.sha256(currentPw)) { var e2 = new Error('Current password is incorrect.'); e2.code = 'wrong-credentials'; throw e2; }
      u.passHash = U.sha256(newPw);
      Store._audit(u.username, 'password-changed', '');
      Store._save();
      return { ok: true };
    },

    setupAdmin: async function (data) {
      if (Store.mode === 'firebase') return Store._fb.setupAdmin(data);
      var db = Store._d();
      if (db.users.some(function (u) { return u.role === 'admin'; })) {
        var e = new Error('An admin account already exists.'); e.code = 'exists'; throw e;
      }
      var uname = (data.username || 'admin').trim().toLowerCase();
      if (!U.validUsername(uname)) { var e1 = new Error('Invalid username.'); e1.code = 'invalid'; throw e1; }
      if (!data.password || data.password.length < 8) { var e2 = new Error('Password must be at least 8 characters.'); e2.code = 'invalid'; throw e2; }
      db.users.push({
        id: U.uid('m'), username: uname, email: (data.email || uname + '@nextgen.local').trim(),
        fullName: data.fullName || 'Fund Administrator', phone: '', address: '', shares: 0, monthlyDue: 0,
        joinMonth: '', status: 'active', role: 'admin', passHash: U.sha256(data.password), createdAt: new Date().toISOString()
      });
      Store._audit(uname, 'admin-created', 'first admin via setup');
      Store._save();
      return { ok: true };
    },

    adminExists: async function () {
      if (Store.mode === 'firebase') return Store._fb.adminExists();
      return Store._d().users.some(function (u) { return u.role === 'admin'; });
    },

    /* ---------- member portal ---------- */
    getMyAccount: async function () {
      if (Store.mode === 'firebase') return Store._fb.getMyAccount();
      var s = Store._requireLogin();
      var db = Store._d();
      var u = db.users.find(function (x) { return x.id === s.uid; });
      if (!u) { var e = new Error('Account not found'); e.code = 'not-found'; throw e; }
      var payments = db.payments.filter(function (p) { return p.memberId === u.id; })
        .sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
      return {
        profile: {
          id: u.id, username: u.username, email: u.email, fullName: u.fullName, phone: u.phone,
          address: u.address, shares: u.shares, monthlyDue: u.monthlyDue, joinMonth: u.joinMonth,
          status: u.status, role: u.role
        },
        balance: computeBalance(u, payments, U.currentMonth()),
        payments: payments
      };
    },

    getMyPayments: async function () {
      if (Store.mode === 'firebase') return Store._fb.getMyPayments();
      var s = Store._requireLogin();
      return Store._d().payments.filter(function (p) { return p.memberId === s.uid; })
        .sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
    },

    submitPayment: async function (data) {
      if (Store.mode === 'firebase') return Store._fb.submitPayment(data);
      var s = Store._requireLogin();
      var db = Store._d();
      var amount = Number(data.amount);
      if (!(amount > 0)) { var e0 = new Error('Enter an amount greater than 0.'); e0.code = 'invalid'; throw e0; }
      if (amount % 1000 !== 0 || amount < 1000) { var e0b = new Error('Amount must be a multiple of 1,000 tk (1x1000, 2x1000, 3x1000, ...).'); e0b.code = 'invalid'; throw e0b; }
      if (METHODS.indexOf(data.method) < 0) { var e1 = new Error('Choose a payment method.'); e1.code = 'invalid'; throw e1; }
      if (data.type !== 'due' && data.type !== 'advance') { var e2 = new Error('Choose Due payment or Advance payment.'); e2.code = 'invalid'; throw e2; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) { var e3 = new Error('Enter the payment date.'); e3.code = 'invalid'; throw e3; }
      var ref = (data.ref || '').trim();
      if (data.method !== 'cash' && ref.length < 4) { var e4 = new Error('Enter the transaction ID / reference (min 4 characters).'); e4.code = 'invalid'; throw e4; }
      var dup = db.payments.find(function (p) {
        return p.memberId === s.uid && p.method === data.method &&
          p.ref.toLowerCase() === ref.toLowerCase() && p.status !== 'rejected';
      });
      if (dup && ref) { var e5 = new Error('This transaction ID was already submitted.'); e5.code = 'dup-ref'; throw e5; }
      var u = db.users.find(function (x) { return x.id === s.uid; });
      var p = {
        id: U.uid('p'), memberId: s.uid, memberName: u ? u.fullName : s.username,
        type: data.type, method: data.method, amount: amount, date: data.date,
        ref: ref, senderNumber: (data.senderNumber || '').trim(), note: (data.note || '').trim(),
        status: 'pending', submittedAt: new Date().toISOString(), verifiedAt: null, verifiedBy: null, rejectReason: ''
      };
      db.payments.unshift(p);
      Store._audit(s.username, 'payment-submitted', p.method + ' ' + p.type + ' ' + amount + ' ref ' + ref);
      Store._save();
      return { ok: true, paymentId: p.id };
    },

    /* ================= ADMIN ================= */
    listRegistrations: async function (status) {
      if (Store.mode === 'firebase') return Store._fb.listRegistrations(status);
      Store._requireAdmin();
      var list = Store._d().registrations.slice();
      if (status) list = list.filter(function (r) { return r.status === status; });
      return list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    },

    decideRegistration: async function (regId, approve, note) {
      if (Store.mode === 'firebase') return Store._fb.decideRegistration(regId, approve, note);
      Store._requireAdmin();
      var db = Store._d();
      var r = db.registrations.find(function (x) { return x.id === regId; });
      if (!r) { var e = new Error('Registration not found'); e.code = 'not-found'; throw e; }
      if (r.status !== 'pending') { var e1 = new Error('Already decided.'); e1.code = 'invalid'; throw e1; }
      r.status = approve ? 'approved' : 'rejected';
      r.decidedAt = new Date().toISOString();
      r.decidedBy = Store._session.username;
      r.note = note || '';
      if (approve) {
        db.users.push({
          id: U.uid('m'), username: r.username, email: r.email, fullName: r.fullName,
          phone: r.phone, address: r.address, shares: r.shares,
          monthlyDue: r.shares * (db.settings.monthlyPerShare || 1000),
          joinMonth: U.currentMonth(), status: 'active', role: 'member',
          passHash: r.passwordHash, createdAt: new Date().toISOString()
        });
        r.passwordHash = '';
      }
      Store._audit(Store._session.username, approve ? 'registration-approved' : 'registration-rejected', r.username + (note ? ' — ' + note : ''));
      Store._save();
      return { ok: true, status: r.status, decidedAt: r.decidedAt };
    },

    listMembers: async function () {
      if (Store.mode === 'firebase') return Store._fb.listMembers();
      Store._requireAdmin();
      var db = Store._d();
      return db.users.filter(function (u) { return u.role === 'member'; })
        .map(function (u) {
          var pays = db.payments.filter(function (p) { return p.memberId === u.id; });
          var b = computeBalance(u, pays, U.currentMonth());
          return Object.assign({}, u, { balance: b });
        })
        .sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    },

    getMemberDetail: async function (memberId) {
      if (Store.mode === 'firebase') return Store._fb.getMemberDetail(memberId);
      Store._requireAdmin();
      var db = Store._d();
      var u = db.users.find(function (x) { return x.id === memberId && x.role === 'member'; });
      if (!u) { var e = new Error('Member not found'); e.code = 'not-found'; throw e; }
      var payments = db.payments.filter(function (p) { return p.memberId === u.id; })
        .sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
      return { profile: u, balance: computeBalance(u, payments, U.currentMonth()), payments: payments };
    },

    updateMember: async function (memberId, patch) {
      if (Store.mode === 'firebase') return Store._fb.updateMember(memberId, patch);
      Store._requireAdmin();
      var db = Store._d();
      var u = db.users.find(function (x) { return x.id === memberId && x.role === 'member'; });
      if (!u) { var e = new Error('Member not found'); e.code = 'not-found'; throw e; }
      ['fullName', 'phone', 'address', 'joinMonth', 'status'].forEach(function (k) {
        if (patch[k] !== undefined) u[k] = patch[k];
      });
      if (patch.shares !== undefined) {
        var sh = parseInt(patch.shares, 10);
        if (!(sh >= 0 && sh <= 20)) { var e1 = new Error('Shares must be 0\u201320.'); e1.code = 'invalid'; throw e1; }
        u.shares = sh;
        if (patch.monthlyDue === undefined) u.monthlyDue = sh * (db.settings.monthlyPerShare || 1000);
      }
      if (patch.monthlyDue !== undefined) {
        var md = Number(patch.monthlyDue);
        if (!(md >= 0)) { var e2 = new Error('Monthly due must be 0 or more.'); e2.code = 'invalid'; throw e2; }
        u.monthlyDue = md;
      }
      Store._audit(Store._session.username, 'member-updated', u.username);
      Store._save();
      return { ok: true };
    },

    listPayments: async function (filter) {
      if (Store.mode === 'firebase') return Store._fb.listPayments(filter);
      Store._requireAdmin();
      var list = Store._d().payments.slice();
      if (filter && filter.status) list = list.filter(function (p) { return p.status === filter.status; });
      return list.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
    },

    verifyPayment: async function (paymentId) {
      if (Store.mode === 'firebase') return Store._fb.verifyPayment(paymentId);
      Store._requireAdmin();
      var db = Store._d();
      var p = db.payments.find(function (x) { return x.id === paymentId; });
      if (!p) { var e = new Error('Payment not found'); e.code = 'not-found'; throw e; }
      if (p.status !== 'pending') { var e1 = new Error('Only pending payments can be verified.'); e1.code = 'invalid'; throw e1; }
      p.status = 'verified'; p.verifiedAt = new Date().toISOString(); p.verifiedBy = Store._session.username;
      Store._audit(Store._session.username, 'payment-verified', p.memberName + ' ' + p.amount + ' ' + p.method + ' ref ' + p.ref);
      Store._save();
      return { ok: true };
    },

    rejectPayment: async function (paymentId, reason) {
      if (Store.mode === 'firebase') return Store._fb.rejectPayment(paymentId, reason);
      Store._requireAdmin();
      var db = Store._d();
      var p = db.payments.find(function (x) { return x.id === paymentId; });
      if (!p) { var e = new Error('Payment not found'); e.code = 'not-found'; throw e; }
      if (p.status !== 'pending') { var e1 = new Error('Only pending payments can be rejected.'); e1.code = 'invalid'; throw e1; }
      p.status = 'rejected'; p.verifiedAt = new Date().toISOString(); p.verifiedBy = Store._session.username;
      p.rejectReason = reason || '';
      Store._audit(Store._session.username, 'payment-rejected', p.memberName + ' ' + p.amount + ' ' + (reason || ''));
      Store._save();
      return { ok: true };
    },

    addManualPayment: async function (data) {
      if (Store.mode === 'firebase') return Store._fb.addManualPayment(data);
      Store._requireAdmin();
      var db = Store._d();
      var u = db.users.find(function (x) { return x.id === data.memberId && x.role === 'member'; });
      if (!u) { var e = new Error('Member not found'); e.code = 'not-found'; throw e; }
      var amount = Number(data.amount);
      if (!(amount > 0)) { var e1 = new Error('Amount must be > 0.'); e1.code = 'invalid'; throw e1; }
      if (amount % 1000 !== 0 || amount < 1000) { var e1b = new Error('Amount must be a multiple of 1,000 tk (1x1000, 2x1000, 3x1000, ...).'); e1b.code = 'invalid'; throw e1b; }
      var p = {
        id: U.uid('p'), memberId: u.id, memberName: u.fullName,
        type: data.type === 'advance' ? 'advance' : 'due',
        method: METHODS.indexOf(data.method) >= 0 ? data.method : 'cash',
        amount: amount, date: data.date || U.todayISO(), ref: (data.ref || '').trim(),
        senderNumber: '', note: (data.note || '').trim() + ' (recorded by admin)',
        status: 'verified', submittedAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(), verifiedBy: Store._session.username, rejectReason: ''
      };
      db.payments.unshift(p);
      Store._audit(Store._session.username, 'payment-recorded-manually', u.username + ' ' + amount);
      Store._save();
      return { ok: true, paymentId: p.id };
    },

    /* ---------- finance manager ---------- */
    listFinance: async function () {
      if (Store.mode === 'firebase') return Store._fb.listFinance();
      Store._requireAdmin();
      return Store._d().finance.slice().sort(function (a, b) { return a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind); });
    },

    upsertFinanceEntry: async function (entry) {
      if (Store.mode === 'firebase') return Store._fb.upsertFinanceEntry(entry);
      Store._requireAdmin();
      var db = Store._d();
      if (['funding', 'revenue', 'loss'].indexOf(entry.kind) < 0) { var e = new Error('Invalid kind.'); e.code = 'invalid'; throw e; }
      if (!/^\d{4}-\d{2}$/.test(entry.month || '')) { var e1 = new Error('Pick a month.'); e1.code = 'invalid'; throw e1; }
      var amount = Number(entry.amount);
      if (!(amount > 0)) { var e2 = new Error('Amount must be greater than 0.'); e2.code = 'invalid'; throw e2; }
      var existing = entry.id ? db.finance.find(function (f) { return f.id === entry.id; }) : null;
      if (existing) {
        existing.kind = entry.kind; existing.month = entry.month; existing.amount = amount; existing.note = entry.note || '';
        Store._audit(Store._session.username, 'finance-updated', existing.kind + ' ' + existing.month + ' = ' + amount);
      } else {
        db.finance.push({ id: U.uid('f'), kind: entry.kind, month: entry.month, amount: amount, note: entry.note || '' });
        Store._audit(Store._session.username, 'finance-added', entry.kind + ' ' + entry.month + ' = ' + amount);
      }
      db.settings.updatedAt = new Date().toISOString();
      Store._save();
      return { ok: true };
    },

    deleteFinanceEntry: async function (id) {
      if (Store.mode === 'firebase') return Store._fb.deleteFinanceEntry(id);
      Store._requireAdmin();
      var db = Store._d();
      var i = db.finance.findIndex(function (f) { return f.id === id; });
      if (i >= 0) { Store._audit(Store._session.username, 'finance-deleted', db.finance[i].kind + ' ' + db.finance[i].month); db.finance.splice(i, 1); }
      db.settings.updatedAt = new Date().toISOString();
      Store._save();
      return { ok: true };
    },

    /* ---------- settings ---------- */
    getSettings: async function () {
      if (Store.mode === 'firebase') return Store._fb.getSettings();
      return JSON.parse(JSON.stringify(Store._d().settings));
    },

    saveSettings: async function (patch) {
      if (Store.mode === 'firebase') return Store._fb.saveSettings(patch);
      Store._requireAdmin();
      var db = Store._d();
      ['fundName', 'nextMeeting', 'meetingNote', 'paymentNumbers', 'docRequirements', 'monthlyPerShare', 'content'].forEach(function (k) {
        if (patch[k] !== undefined) db.settings[k] = patch[k];
      });
      if (patch.nextMeeting && !/^\d{4}-\d{2}-\d{2}$/.test(patch.nextMeeting)) { var e = new Error('Invalid meeting date.'); e.code = 'invalid'; throw e; }
      db.settings.updatedAt = new Date().toISOString();
      Store._audit(Store._session.username, 'settings-updated', Object.keys(patch).join(', '));
      Store._save();
      return { ok: true };
    },

    /* ---------- audit & exports ---------- */
    listAudit: async function () {
      if (Store.mode === 'firebase') return Store._fb.listAudit();
      Store._requireAdmin();
      return Store._d().audit.slice(0, 200);
    },

    exportMembersCSV: async function () {
      if (Store.mode === 'firebase') return Store._fb.exportMembersCSV();
      Store._requireAdmin();
      var db = Store._d();
      var rows = [['id', 'username', 'fullName', 'email', 'phone', 'address', 'shares', 'monthlyDue', 'joinMonth', 'status', 'totalPaid', 'currentDue', 'advance']];
      db.users.filter(function (u) { return u.role === 'member'; }).forEach(function (u) {
        var b = computeBalance(u, db.payments.filter(function (p) { return p.memberId === u.id; }), U.currentMonth());
        rows.push([u.id, u.username, u.fullName, u.email, u.phone, u.address, u.shares, u.monthlyDue, u.joinMonth, u.status, b.paid, b.due, b.advance]);
      });
      return U.csv(rows);
    },

    exportPaymentsCSV: async function () {
      if (Store.mode === 'firebase') return Store._fb.exportPaymentsCSV();
      Store._requireAdmin();
      var db = Store._d();
      var rows = [['id', 'paymentDate', 'memberName', 'username', 'type', 'method', 'amount', 'transactionRef', 'senderNumber', 'status', 'submittedAt', 'verifiedAt', 'verifiedBy', 'rejectReason', 'note']];
      db.payments.forEach(function (p) {
        var u = db.users.find(function (x) { return x.id === p.memberId; });
        rows.push([p.id, p.date, p.memberName, u ? u.username : '', p.type, p.method, p.amount, p.ref, p.senderNumber, p.status, p.submittedAt, p.verifiedAt || '', p.verifiedBy || '', p.rejectReason || '', p.note]);
      });
      return U.csv(rows);
    },

    exportFinanceCSV: async function () {
      if (Store.mode === 'firebase') return Store._fb.exportFinanceCSV();
      Store._requireAdmin();
      var rows = [['id', 'kind', 'month', 'amount', 'note']];
      Store._d().finance.forEach(function (f) { rows.push([f.id, f.kind, f.month, f.amount, f.note]); });
      return U.csv(rows);
    },

    /* ---------- test/dev helpers ---------- */
    _demoReset: function () { Store._resetDemo(); },
    _computeBalance: computeBalance
  };

  Object.keys(API).forEach(function (k) { Store[k] = API[k]; });
  return Store;
});
