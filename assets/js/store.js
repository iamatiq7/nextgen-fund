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
      /* funding is never typed by hand now: legacy 'funding' rows are ignored so they cannot
         double count against the member deposits below. */
      if (f.kind === 'funding') return;
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
      /* funding = verified member money + revenue - loss, all automatic */
      months[k].funding = (months[k].deposits || 0) + (months[k].revenue || 0) - (months[k].loss || 0);
      months[k].net = months[k].funding;
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
      net: totalFunding, /* funding already nets revenue and loss */
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
      var phoneDigits = U.normPhone ? U.normPhone(data.phone) : String(data.phone || '').replace(/\D/g, '');
      if (!/^01[0-9]{9}$/.test(phoneDigits)) errs.push('Wrong mobile number - it must be exactly 11 digits and start with 01.');
      if (!data.nominee || !String(data.nominee).trim()) errs.push('Nominee name is required.');
      if (!data.nomineeAddress || !String(data.nomineeAddress).trim()) errs.push('Nominee address is required.');
      if (!data.nomineeRelation || !String(data.nomineeRelation).trim()) errs.push('Relation with the nominee is required.');
      if (!data.fatherName || !String(data.fatherName).trim()) errs.push("Father's name is required.");
      if (!data.motherName || !String(data.motherName).trim()) errs.push("Mother's name is required.");
      if (data.nomineePhone && !/^01[0-9]{9}$/.test(U.normPhone ? U.normPhone(data.nomineePhone) : String(data.nomineePhone))) errs.push('Wrong nominee mobile number - it must be 11 digits and start with 01.');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(data.joinMonth || ''))) errs.push('Join month is required - pick the month the accounting starts.');
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
      var needDocs = ['nid-front', 'nid-back', 'profile-picture', 'nominee-passport-photo'];
      var haveKinds = (data.docs || []).map(function (d) { return d && d.kind; });
      var missingDocs = needDocs.filter(function (k) { return haveKinds.indexOf(k) === -1; });
      if (missingDocs.length) errs.push('Required documents are missing: ' + missingDocs.join(', '));
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
        phone: (U.normPhone ? U.normPhone(data.phone) : data.phone).trim(), address: (data.address || '').trim(), occupation: (data.occupation || '').trim(),
        nominee: (data.nominee || '').trim(), nomineeAddress: (data.nomineeAddress || '').trim(),
        nomineePhone: (data.nomineePhone || '').trim(), nomineeRelation: (data.nomineeRelation || '').trim(),
        fatherName: (data.fatherName || '').trim(), motherName: (data.motherName || '').trim(),
        joinMonth: String(data.joinMonth || '').trim(), shares: shares,
        passwordHash: U.sha256(data.password),
        docs: docs.map(function (d) { return { kind: d.kind, name: d.name, mime: d.mime, size: d.size, data: d.data }; }),
        photo: (function () { var pd = (docs || []).filter(function (x) { return x && x.kind === 'profile-picture'; })[0]; return pd ? (pd.driveFileId || pd.driveUrl || pd.data || '') : ''; })(),
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
          nominee: u.nominee || '', nomineeRelation: u.nomineeRelation || '', nomineePhone: u.nomineePhone || '', nomineeAddress: u.nomineeAddress || '',
          fatherName: u.fatherName || '', motherName: u.motherName || '', status: u.status || '', role: u.role || '', joinMonth: u.joinMonth || '',
          address: u.address, shares: u.shares, monthlyDue: u.monthlyDue, joinMonth: u.joinMonth,
          status: u.status, role: u.role
        },
        balance: computeBalance(u, payments, U.currentMonth()),
        payments: payments
      };
    },

  /* account change requests — demo mode (browser storage) + facade to the Firebase adapter */
  createAccountRequest: async function (data) {
    if (Store.mode === 'firebase') return Store._fb.createAccountRequest(data);
    var s2 = Store._requireLogin();
    var db = Store._d();
    db.nomineeRequests = db.nomineeRequests || [];
    var fields = ['fullName', 'username', 'email', 'phone', 'shares'];
    var changes = [];
    fields.forEach(function (f) {
      var to = (data && data[f] !== undefined) ? String(data[f]).trim() : '';
      var from = (data && data['from_' + f] !== undefined) ? String(data['from_' + f]).trim() : '';
      if (to !== '' && to !== from) changes.push({ field: f, from: from, to: to });
    });
    if (!changes.length) { var e0 = new Error('nothing-to-request'); throw e0; }
    for (var i = 0; i < changes.length; i++) {
      if (changes[i].field === 'username') {
        var un = changes[i].to.toLowerCase();
        var me = db.users.filter(function (x) { return x.id === s2.uid; })[0] || {};
        if (String(me.username || '').toLowerCase() === un) continue;
        var taken = db.users.some(function (x) { return String(x.username || '').toLowerCase() === un; });
        if (taken) { var e1 = new Error('same username existed, try with another.'); e1.code = 'username-taken'; throw e1; }
      }
    }
    /* one pending account request at a time: the older one is superseded */
    db.nomineeRequests.forEach(function (r) {
      if (r.kind === 'account' && r.memberId === s2.uid && r.status === 'pending') { r.status = 'cancelled'; r.decidedAt = new Date().toISOString(); }
    });
    var me2 = db.users.filter(function (x) { return x.id === s2.uid; })[0] || {};
    var row = {
      id: U.uid ? U.uid('r') : 'r-' + Date.now(), kind: 'account', memberId: s2.uid,
      memberName: data.memberName || me2.fullName || '', username: data.from_username || me2.username || '',
      changes: changes, reason: (data.reason || ''), status: 'pending', requestedAt: new Date().toISOString()
    };
    db.nomineeRequests.push(row); Store._save(); return row;
  },
  listAccountRequests: async function (status) {
    if (Store.mode === 'firebase') return Store._fb.listAccountRequests(status);
    var rows = (Store._d().nomineeRequests || []).filter(function (r) { return r.kind === 'account'; });
    return status ? rows.filter(function (r) { return r.status === status; }) : rows;
  },
  decideNomineeRequest: async function (id, approve, byName) {
    if (Store.mode === 'firebase') return Store._fb.decideNomineeRequest(id, approve, byName);
    var db = Store._d();
    var row = (db.nomineeRequests || []).filter(function (r) { return r.id === id; })[0];
    if (!row) { var e = new Error('not-found'); throw e; }
    if (approve) {
      (db.users || []).forEach(function (u) {
        if (u.id !== row.memberId) return;
        u.nominee = row.requestedNominee;
        if (row.relation) u.nomineeRelation = row.relation;
        if (row.requestedPhone) u.nomineePhone = row.requestedPhone;
        if (row.requestedAddress) u.nomineeAddress = row.requestedAddress;
        u.nomineeUpdatedAt = new Date().toISOString();
      });
      Store._audit(row.username || 'member', 'nominee-approve', row.requestedNominee || '');
    } else {
      Store._audit(row.username || 'member', 'nominee-reject', row.reason || '');
    }
    row.status = approve ? 'approved' : 'rejected';
    row.decidedAt = new Date().toISOString();
    row.decidedBy = byName || 'admin';
    Store._save();
    return true;
  },
  decideAccountRequest: async function (id, approve, byName) {
    if (Store.mode === 'firebase') return Store._fb.decideAccountRequest(id, approve, byName);
    var db = Store._d();
    var row = (db.nomineeRequests || []).filter(function (r) { return r.id === id; })[0];
    if (!row) { var e = new Error('not-found'); throw e; }
    var u = db.users.filter(function (x) { return x.id === row.memberId; })[0];
    if (approve && u) {
      for (var i = 0; i < (row.changes || []).length; i++) {
        var ch = row.changes[i];
        if (ch.field === 'username') {
          var un = ch.to.toLowerCase();
          var clash = db.users.some(function (x) { return x.id !== u.id && String(x.username || '').toLowerCase() === un; });
          if (clash) {
            row.status = 'rejected'; row.decidedAt = new Date().toISOString(); row.note = 'username-taken';
            Store._audit(u.username || 'member', 'account-reject', 'username already taken: ' + ch.to);
            Store._save();
            return 'username-taken';
          }
          u.username = ch.to;
          db.usernames = db.usernames || {};
          db.usernames[un] = { uid: u.id, email: u.email || '' };
        } else if (ch.field === 'shares') {
          u.shares = parseInt(ch.to, 10) || 0;
        } else {
          u[ch.field] = ch.to;
        }
      }
      Store._audit(u.username || 'member', 'account-approve', JSON.stringify(row.changes || []).slice(0, 200));
    } else {
      Store._audit((u && u.username) || 'member', 'account-reject', (row.reason || ''));
    }
    row.status = approve ? 'approved' : 'rejected';
    row.decidedAt = new Date().toISOString();
    row.decidedBy = byName || '';
    Store._save();
    return true;
  },

    createNomineeRequest: async function (data) {
      if (Store.mode === 'firebase') return Store._fb.createNomineeRequest(data);
      var db = Store._d();
      db.nomineeRequests = db.nomineeRequests || [];
      var row = {
        id: 'nr-' + Date.now().toString(36), kind: 'nominee',
        memberId: data.memberId || (Store._requireLogin && Store._requireLogin().uid) || 'demo',
        memberName: (data.memberName || '').trim(), username: (data.username || '').trim(),
        currentNominee: (data.currentNominee || '').trim(),
        requestedNominee: (data.requestedNominee || '').trim(),
        relation: (data.relation || '').trim(),
        requestedPhone: (data.requestedPhone || '').trim(),
        requestedAddress: (data.requestedAddress || '').trim(),
        reason: (data.reason || '').trim(),
        status: 'pending', requestedAt: new Date().toISOString()
      };
      db.nomineeRequests.push(row); Store._save(); return row;
    },
    listNomineeRequests: async function (status) {
    if (Store.mode === 'firebase') return Store._fb.listNomineeRequests(status);
    var rows = (Store._d().nomineeRequests || []).filter(function (r) { return (r.kind || 'nominee') === 'nominee'; });
    return status ? rows.filter(function (r) { return r.status === status; }) : rows;
  },

  resetDatabase: async function (opts) {
    if (Store.mode === 'firebase') return Store._fb.resetDatabase(opts || {});
    /* demo mode: clearing the local book is the equivalent, and it keeps the screen usable */
    Store._requireAdmin();
    Store._resetDemo();
    return { deleted: 0, errors: [], accountDeleted: false, demo: true };
  },
    _computeBalance: computeBalance
  };

  Object.keys(API).forEach(function (k) { Store[k] = API[k]; });
  return Store;
});
