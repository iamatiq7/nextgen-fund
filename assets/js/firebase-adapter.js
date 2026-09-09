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
    var U = window.NGFUtil;
    var S = window.NGFStore;

    /* ---- helpers ---- */
    function col(name) { return fsMod.collection(db, name); }
    function docIn(name, id) { return fsMod.doc(db, name, id); }
    async function getDoc(path, id) { var s = await fsMod.getDoc(docIn(path, id)); return s.exists() ? s.data() : null; }
    async function getAll(path, q) {
      var snap = q ? await fsMod.getDocs(q) : await fsMod.getDocs(col(path));
      var out = []; snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      return out;
    }
    function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

    async function userDoc(uid) { return getDoc('users', uid); }
    async function myUid() {
      var cu = authMod.getCurrentUser(auth);
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

    /* ---- balance calc (shared formula) ---- */
    function computeBalance(user, payments) {
      var nowMonth = U.currentMonth();
      var expected = U.monthsInclusive(user.joinMonth, nowMonth) * (Number(user.monthlyDue) || 0);
      var paidDue = 0, advance = 0;
      (payments || []).forEach(function (p) {
        if (p.status !== 'verified') return;
        if (p.type === 'due') paidDue += Number(p.amount) || 0;
        if (p.type === 'advance') advance += Number(p.amount) || 0;
      });
      return { expected: expected, paid: paidDue + advance, paidDue: paidDue, advance: advance, due: Math.max(0, expected - paidDue) };
    }

    async function myPaymentsFor(uid) {
      return getAll('payments', fsMod.query(col('payments'), fsMod.where('memberId', '==', uid)));
    }

    var fb = {

      /* ---------- public ---------- */
      getPublicSnapshot: async function () {
        var settings = await getDoc('settings', 'public');
        var finance = await getAll('finance');
        var usersPub = await getAll('users', fsMod.query(col('users'), fsMod.where('role', '==', 'member')));
        var dbLike = { settings: settings || {}, finance: finance, users: usersPub };
        var months = {};
        finance.forEach(function (f) {
          var m = months[f.month] || (months[f.month] = { month: f.month, funding: 0, revenue: 0, loss: 0 });
          m[f.kind] += Number(f.amount) || 0;
        });
        var tF = 0, tR = 0, tL = 0;
        Object.keys(months).sort().forEach(function (k) { tF += months[k].funding; tR += months[k].revenue; tL += months[k].loss; });
        return {
          fundName: (settings && settings.fundName) || 'NextGen Fund', currency: 'BDT',
          nextMeeting: settings && settings.nextMeeting, meetingNote: settings && settings.meetingNote,
          totalFunding: tF, totalRevenue: tR, totalLoss: tL, net: tF + tR - tL,
          months: Object.keys(months).sort().map(function (k) { return months[k]; }),
          memberCount: usersPub.filter(function (u) { return u.status === 'active'; }).length,
          monthlyPerShare: settings && settings.monthlyPerShare,
          content: (settings && settings.content) || {},
          updatedAt: settings && settings.updatedAt
        };
      },

      getSettings: async function () {
        var s = await getDoc('settings', 'public');
        return s || { docRequirements: ['Photo ID (NID / Birth Certificate)', 'Passport-size Photograph'] };
      },

      /* ---------- registration (creates Auth account immediately) ---------- */
      register: async function (data, uname) {
        var cred;
        try {
          cred = await authMod.createUserWithEmailAndPassword(auth, data.email, data.password);
        } catch (e) {
          if (e.code === 'auth/email-already-in-use') throw err('invalid', 'That email is already registered.');
          if (e.code === 'auth/weak-password') throw err('invalid', 'Password must be at least 8 characters.');
          throw err('invalid', e.message);
        }
        var uid = cred.user.uid;
        var docs = [];
        for (var i = 0; i < (data.docs || []).length; i++) {
          var d = data.docs[i];
          var path = 'registrations/' + uid + '/' + Date.now() + '-' + d.name;
          var ref = stMod.ref(storage, path);
          await stMod.uploadBytes(ref, d.file, { contentType: d.mime });
          docs.push({ kind: d.kind, name: d.name, mime: d.mime, size: d.size, path: path });
        }
        var reg = {
          fullName: data.fullName.trim(), username: uname, email: data.email.trim(),
          phone: data.phone.trim(), address: (data.address || '').trim(), occupation: (data.occupation || '').trim(),
          nominee: (data.nominee || '').trim(), shares: parseInt(data.shares, 10),
          docs: docs, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null, note: ''
        };
        await fsMod.setDoc(docIn('registrations', uid), reg);
        await fsMod.setDoc(docIn('users', uid), {
          role: 'member', status: 'pending', username: uname, email: data.email.trim(),
          fullName: data.fullName.trim(), phone: data.phone.trim(), address: reg.address,
          shares: reg.shares, monthlyDue: reg.shares * ((await fb.getSettings()).monthlyPerShare || 1000),
          joinMonth: '', createdAt: new Date().toISOString()
        });
        await fsMod.setDoc(docIn('usernames', uname), { uid: uid });
        await authMod.signOut(auth);
        await audit(reg.fullName, 'registration-submitted', 'username ' + uname);
        return { ok: true, registrationId: uid };
      },

      /* ---------- auth ---------- */
      login: async function (identifier, password) {
        var email = identifier.trim().toLowerCase();
        if (email.indexOf('@') < 0) {
          var map = await getDoc('usernames', email);
          if (!map || !map.uid) throw err('wrong-credentials', 'Wrong username or password.');
          var u0 = await userDoc(map.uid);
          if (!u0) throw err('wrong-credentials', 'Wrong username or password.');
          email = u0.email;
        }
        try { await authMod.signInWithEmailAndPassword(auth, email, password); }
        catch (e) { throw err('wrong-credentials', 'Wrong username or password.'); }
        var cu = authMod.getCurrentUser(auth);
        var u = await userDoc(cu.uid);
        if (!u) { await authMod.signOut(auth); throw err('wrong-credentials', 'Account not found.'); }
        if (u.status === 'pending') { await authMod.signOut(auth); throw err('pending', 'Your registration is still awaiting admin approval.'); }
        if (u.status === 'rejected') { await authMod.signOut(auth); throw err('rejected', 'Your registration was not approved. Contact the fund admin.'); }
        if (u.status === 'suspended') { await authMod.signOut(auth); throw err('suspended', 'This account is suspended. Contact the fund admin.'); }
        return { uid: cu.uid, role: u.role, username: u.username, fullName: u.fullName };
      },

      logout: async function () { await authMod.signOut(auth); },

      getSession: async function () {
        var cu = authMod.getCurrentUser(auth);
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

      changePassword: async function (currentPw, newPw) {
        var cu = authMod.getCurrentUser(auth);
        if (!cu) throw err('unauthenticated', 'Please log in');
        var cred = authMod.EmailAuthProvider.credential(cu.email, currentPw);
        await authMod.reauthenticateWithCredential(cu, cred);
        await authMod.updatePassword(cu, newPw);
        return { ok: true };
      },

      setupAdmin: async function (data) {
        if (await fb.adminExists()) throw err('exists', 'An admin account already exists.');
        // Claim bootstrap: sign in/up, then write settings/bootstrap with own uid.
        var cu = authMod.getCurrentUser(auth);
        if (!cu) {
          if (!data.email || !data.password) throw err('invalid', 'Enter email and password (min 8 characters).');
          try { await authMod.signInWithEmailAndPassword(auth, data.email, data.password); }
          catch (e) {
            try { await authMod.createUserWithEmailAndPassword(auth, data.email, data.password); }
            catch (e2) { throw err('invalid', e2.message); }
          }
          cu = authMod.getCurrentUser(auth);
        }
        var uname = (data.username || 'admin').trim().toLowerCase();
        await fsMod.setDoc(docIn('settings', 'bootstrap'), { adminUid: cu.uid, claimedAt: new Date().toISOString() });
        await fsMod.setDoc(docIn('users', cu.uid), {
          role: 'admin', status: 'active', username: uname, email: cu.email || (uname + '@nextgen.local'),
          fullName: data.fullName || 'Fund Administrator', phone: '', address: '', shares: 0,
          monthlyDue: 0, joinMonth: '', createdAt: new Date().toISOString()
        }, { merge: true });
        await fsMod.setDoc(docIn('usernames', uname), { uid: cu.uid });
        if (!(await getDoc('settings', 'public'))) {
          await fsMod.setDoc(docIn('settings', 'public'), {
            fundName: 'NextGen Fund', currency: 'BDT', monthlyPerShare: 1000,
            nextMeeting: '', meetingNote: '', paymentNumbers: {}, 
            docRequirements: ['Photo ID (NID / Birth Certificate)', 'Passport-size Photograph'],
            updatedAt: new Date().toISOString()
          });
        }
        await audit(uname, 'admin-created', 'bootstrap claim');
        return { ok: true };
      },

      adminExists: async function () {
        var b = await getDoc('settings', 'bootstrap');
        return !!(b && b.adminUid);
      },

      /* ---------- member ---------- */
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

      submitPayment: async function (data) {
        var uid = await myUid();
        var u = await userDoc(uid);
        var amount = Number(data.amount);
        if (!(amount > 0)) throw err('invalid', 'Enter an amount greater than 0.');
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
        await fsMod.updateDoc(docIn('users', regId), {
          status: approve ? 'active' : 'rejected',
          joinMonth: approve ? U.currentMonth() : '',
          monthlyDue: approve ? (r.shares * ((await fb.getSettings()).monthlyPerShare || 1000)) : 0
        });
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
        ['fullName', 'phone', 'address', 'joinMonth', 'status'].forEach(function (k) { if (patch[k] !== undefined) allowed[k] = patch[k]; });
        if (patch.shares !== undefined) {
          var sh = parseInt(patch.shares, 10);
          if (!(sh >= 0 && sh <= 20)) throw err('invalid', 'Shares must be 0\u201320.');
          allowed.shares = sh;
          if (patch.monthlyDue === undefined) allowed.monthlyDue = sh * ((await fb.getSettings()).monthlyPerShare || 1000);
        }
        if (patch.monthlyDue !== undefined) allowed.monthlyDue = Number(patch.monthlyDue) || 0;
        await fsMod.updateDoc(docIn('users', memberId), allowed);
        await audit(me.user.username, 'member-updated', memberId);
        return { ok: true };
      },

      listPayments: async function (filter) {
        await requireAdminUid();
        var list = await getAll('payments');
        if (filter && filter.status) list = list.filter(function (p) { return p.status === filter.status; });
        return list.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
      },

      verifyPayment: async function (paymentId) {
        var me = await requireAdminUid();
        await fsMod.updateDoc(docIn('payments', paymentId), {
          status: 'verified', verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin'
        });
        await audit(me.user.username, 'payment-verified', paymentId);
        return { ok: true };
      },

      rejectPayment: async function (paymentId, reason) {
        var me = await requireAdminUid();
        await fsMod.updateDoc(docIn('payments', paymentId), {
          status: 'rejected', verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin', rejectReason: reason || ''
        });
        await audit(me.user.username, 'payment-rejected', paymentId + ' ' + (reason || ''));
        return { ok: true };
      },

      addManualPayment: async function (data) {
        var me = await requireAdminUid();
        var u = await userDoc(data.memberId);
        if (!u) throw err('not-found', 'Member not found');
        var amount = Number(data.amount);
        if (!(amount > 0)) throw err('invalid', 'Amount must be > 0.');
        var p = {
          memberId: data.memberId, memberName: u.fullName, type: data.type === 'advance' ? 'advance' : 'due',
          method: S.METHODS.indexOf(data.method) >= 0 ? data.method : 'cash', amount: amount,
          date: data.date || U.todayISO(), ref: (data.ref || '').trim(), senderNumber: '',
          note: ((data.note || '').trim() + ' (recorded by admin)').trim(),
          status: 'verified', submittedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(), verifiedBy: me.user.username || 'admin', rejectReason: ''
        };
        var created = await fsMod.addDoc(col('payments'), p);
        await audit(me.user.username, 'payment-recorded-manually', u.username + ' ' + amount);
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
        if (!/^\d{4}-\d{2}$/.test(entry.month || '')) throw err('invalid', 'Pick a month.');
        if (!(Number(entry.amount) > 0)) throw err('invalid', 'Amount must be greater than 0.');
        var body = { kind: entry.kind, month: entry.month, amount: Number(entry.amount), note: entry.note || '' };
        if (entry.id) await fsMod.setDoc(docIn('finance', entry.id), body, { merge: true });
        else await fsMod.addDoc(col('finance'), body);
        await audit(me.user.username, entry.id ? 'finance-updated' : 'finance-added', entry.kind + ' ' + entry.month);
        return { ok: true };
      },

      deleteFinanceEntry: async function (id) {
        var me = await requireAdminUid();
        await fsMod.deleteDoc(docIn('finance', id));
        await audit(me.user.username, 'finance-deleted', id);
        return { ok: true };
      },

      saveSettings: async function (patch) {
        var me = await requireAdminUid();
        patch.updatedAt = new Date().toISOString();
        await fsMod.setDoc(docIn('settings', 'public'), patch, { merge: true });
        await audit(me.user.username, 'settings-updated', Object.keys(patch).join(', '));
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
