# Database reset runbook - NextGen Fund

**Target environment:** Firebase project `nextgen-fund-2040` (Firestore + Authentication).
Source of truth: `C:\Users\SMART\OneDrive\Documents\Scheme\NextGenFund` (repo `iamatiq7/nextgen-fund`).
**Requested by:** the fund owner, 2026-09-14: *"remove full database. i want to start from new ... there is no user and admin"*.
**Goal state:** zero members, zero admins, zero payments, zero registrations, zero usernames, zero audit rows, no fund settings - i.e. first-run, so `setup.html` creates the brand-new admin and `register.html` the members.

---

## 1. Why this needs one owner step (the finding that shapes the whole runbook)

An audit of the live project on 2026-09-14 found:

| Fact | Evidence |
| --- | --- |
| The live security rules are deployed (default-deny) | unauthenticated `GET` of `users`, `usernames`, `payments`, `registrations`, `audit` -> `403 PERMISSION_DENIED` |
| The app is **already claimed by an admin**, so `setup.html` refuses to run | `settings/bootstrap` = `{adminUid: BvTyCq264PQ421Ymwo1Sma4QeK83, claimedAt: 2026-09-13T15:41:43.703Z}` |
| The fund holds real rows | `settings/public`: `memberCount 5`, `totalFunding 6000`, `memberDeposits 6000`, `memberAdvance 4000`, `pendingDue 0` |
| The admin handle exists and points at the owner's mailbox | `usernames/admin` -> uid `BvTyCq264PQ421Ymwo1Sma4QeK83` |
| **Three stores could not be deleted by anyone, including the admin** | rules v2: `settings/bootstrap` and `audit/*` had `allow update, delete: if false`; `usernames/*` had `allow update, delete: if false` |

Consequence: with the old rules there was **no way back to a first-run state**.
`settings/bootstrap` kept `adminExists()` true forever (so `setup.html` always answered *"an admin account already exists"*), and a leftover `usernames/{name}` document made that username permanently unusable - `create` on an existing document is an `update`, and `update` was denied.

**Therefore the reset is a two-part operation:** publish rules v3 once, then delete.

---

## 2. Rules v3 - the exact diff to publish

Publish this in the Firebase console: **Firestore Database -> Rules -> paste `firestore.rules` from the repo -> Publish.**
(No CLI, no service account, no JWT needed; the console uses your existing Google sign-in.)

Added (v3 vs v2) - nothing else changed:

| Path | v3 addition | Why |
| --- | --- | --- |
| `/usernames/{name}` | `allow list: if isAdmin();` and `allow delete: if isAdmin();` | a reset must enumerate the handles and free them for reuse |
| `/settings/bootstrap` | `allow delete: if isAdmin();` | releasing the claim is what makes `setup.html` work again |
| `/audit/{id}` | `allow delete: if isAdmin();` | the log is cleared with the data it describes |

Still true after v3: members gain nothing; `update` stays forbidden on identities; the audit log stays append-only in normal operation; `/settings/public` still readable by all; `/finance` unchanged.
NB: `/settings/public` and `/settings/bootstrap` are matched by *document path*, so no rule can grant a collection `list` on `/settings`. The reset therefore reaches those two documents **by id** - the tool and the in-app screen both do.

Risk to understand before publishing: **deleting `settings/bootstrap` returns the app to first-run mode**, where the next person to open `setup.html` becomes admin. Do it deliberately and create the new admin immediately.

---

## 3. Pre-flight backup (already taken once; take a fresh one before the real run)

Taken 2026-09-14: `live-backup-20260914T1452.json` (7,379 bytes, sha256 `951de8876bec7d312dbf3349ee32a1573afea423055165d87bd3ca11ade83eee`), scope: everything readable without admin rights (`settings/public`, `settings/bootstrap`, `finance`, the three known `usernames/*`).
Path: `<agent workspace>\.openclaw\tmp\reset\backups\` (kept outside the public repo on purpose - it contains member emails).

A **complete** dump needs admin credentials (the rules hide `users`, `payments`, `registrations`, `audit` from anonymous reads). With the admin login:

```
node tools/db-reset.mjs --backup --email <admin email> --password <admin password> --out .reset-backups
# prints: per-collection counts, file path, byte size, sha256
```

Restoring is proven, not assumed: see `docs/evidence/reset-proof.txt` (backup -> wipe -> restore -> every collection count matches, `17/17`).

---

## 4. The reset itself - three ways, pick one

### Option A - in-app screen (no terminal, works on a phone)

1. Open `https://iamatiq7.github.io/nextgen-fund/reset.html` (or `https://nextgen-fund-2040.web.app/reset.html`).
2. Sign in as the fund admin when prompted.
3. Read the inventory table (documents per store).
4. Type `RESET` exactly; tick *"Also delete my admin sign-in account"* if you want zero accounts left.
5. Press **Delete everything**. Progress is printed line by line, then the final count.
6. Follow the button to `setup.html` and create the new admin.

### Option B - command line (records the sha256 of the backup in the same session)

```
node tools/db-reset.mjs --backup  --email <email> --password <pw> --out .reset-backups
node tools/db-reset.mjs --wipe    --email <email> --password <pw> --dry-run     # preview only
node tools/db-reset.mjs --wipe    --email <email> --password <pw> --yes
node tools/db-reset.mjs --verify  --email <email> --password <pw>
```

### Option C - Firebase console (owner, no code at all)

Firestore Database -> Data: delete the collections `users`, `usernames`, `payments`, `registrations`, `audit`, `finance`; then delete the two documents `settings/public` and `settings/bootstrap`.
Authentication -> Users: delete every account (this is the step only the console or a service account can do).

---

## 5. Verification gate (run this before declaring success)

```
node tools/db-reset.mjs --verify --email <email> --password <pw>
```

Expected shape (this is the actual output of the emulator proof, `ALL PASS`):

```
counts   : {"payments":0,"registrations":0,"audit":0,"usernames":0,"users":0,"finance":0,"settings":"by-id(403)"}
singletons: settings/public=absent settings/bootstrap=absent
roles    : {}
bootstrap: absent (first-run state)
```

* `settings` reads `by-id(403)`: expected by design (see §2) - the truth comes from the singleton probe.
* With no admin left, `--verify` reports the public facts only; that is the correct end state.
* App-level checks: `index.html` shows an empty fund, `setup.html` offers the create-admin form (instead of *"an admin already exists"*), `login.html` says *wrong username or password* for an old handle.

## 6. What the reset does **not** delete

Firebase **Authentication accounts** live outside Firestore and cannot be removed by any client, no matter how privileged. Two ways to clear them:

* tick the checkbox in the in-app screen - it deletes the signed-in admin's own account (a client may always delete itself);
* for the rest (old members that were seeded, stale admins): Firebase console -> Authentication -> Users -> delete.

Skips this step and a re-registration can fail with *"That email is already registered."* - a ghost account that no UI can show you.

## 7. Order of operations, and failure behaviour

```
1. publish rules v3            (console)
2. backup, record sha256       (tools/db-reset.mjs --backup)
3. wipe                        (in-app screen, or --wipe --yes)
   -> listable collections first, then settings/public + settings/bootstrap by id
   -> emptiness is checked BEFORE the bootstrap is released: releasing it ends
      the admin's own rights, so anything read afterwards is PERMISSION_DENIED
4. verify                      (--verify: counts + singleton probe)
5. clear Authentication        (console, or the in-app self-delete)
6. create the new admin        (setup.html) then members (register.html)
```

**If a step fails midway:** never leave a half state. The wipe is idempotent - re-run it, it deletes what is left and answers `deleted : 0 documents` when there is nothing to do (proof: `docs/evidence/reset-proof.txt`). If the end state is wrong in any other way, restore:

```
node tools/db-reset.mjs --restore --from .reset-backups/<file>.json --yes
```

The restore writes every dumped document back exactly (delete + create per id), so collections return to their backed-up counts. It cannot bring back Authentication accounts or Cloud Storage files.

## 8. Monitoring for the first 48 hours

* `index.html` - the public dashboard must show zeros with no errors in the console.
* `admin.html` -> Overview - *Payment numbers check* card green; every payment card at zero.
* Audit tab - starts empty and shows only the new admin's first actions.
* Browser console on `portal.html` - no `permission-denied` for a freshly registered member.
* Keep the pre-reset backup until you sign off on the fresh start.

## 9. Follow-ups (not done, on purpose)

* Cloud Storage: registration documents were uploaded under `registrations/{uid}/...` (only when Storage is enabled). They are orphaned after a wipe; delete them in the console (Storage -> browse) or re-enable uploads and prune.
* `settings/public` is recreated by `setup.html`; fund copy (notice, how-to, payment numbers) will need re-entering.
* If you want the reset to be repeatable from the UI later, keep the v3 rules; if you want the old "immutable once claimed" strictness back, revert the three delete grants.

## 10. Evidence index

| Artefact | What it proves |
| --- | --- |
| `docs/evidence/reset-proof.txt` | 35 checks, ALL PASS: backup, wipe, restore parity, idempotency, seed-admin, and the rules proofs (admin may delete what v2 forbade; members still cannot) |
| `docs/evidence/live-before-20260914.txt` | the live state before the reset (project, bootstrap claim, public totals, which stores are protected) |
| `<workspace>\.openclaw\tmp\reset\backups\live-backup-20260914T1452.json(.sha256)` | pre-reset backup + checksum |
| `tools/db-reset.mjs` | the reset tool itself (backup / wipe / restore / verify / seed-admin / list) |
| `firestore.rules` | rules v3, with the diff documented inline |
| `reset.html`, `assets/js/reset.js` | the in-app reset screen (EN + BN, same i18n as the rest of the site) |

## 11. Approval

Destructive step authorised in writing by the fund owner in this session (2026-09-14) - *"now remove full database"*. The reset targets `nextgen-fund-2040` only; the tool refuses any other project unless `--allow-project` is passed explicitly, and prints the target host before doing anything.
