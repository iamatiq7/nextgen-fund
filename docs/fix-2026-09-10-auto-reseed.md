# Fix note — empty fields after login (2026-09-10)

## Symptom
After logging in, several fields looked empty or stale in the member portal:
member phone/address showed "—", and on browsers that had visited an older
build the balance cards and payment history were empty (৳0 / no rows) even
though the seed data contains full payment records for every member.

## Root causes
1. **Stale demo database in the browser.** `store.js` only seeded localStorage
   when the key was *missing*. Any browser that had opened the site before the
   2026-09-09 seed update kept its old copy forever — no payments, old
   members — and the new seed was never loaded.
2. **Member contact data genuinely absent from every source.** All 14 members
   in the seed (and in the source workbook `NextGen Fund.xlsx`) have empty
   `phone` / `address`. The workbook contains deposit rows only. These values
   were never collected — they must be entered by the admin (or supplied to be
   baked into the seed).

## Fix applied
- `assets/js/seed-data.js` — `seedVersion` bumped **1 → 2**.
- `assets/js/store.js` — `init()` now compares the stored demo DB's
  `seedVersion` with the bundled seed and **auto-reseeds on mismatch** (also
  covers corrupt JSON and versionless old DBs). Current-version DBs are never
  touched, so admin-entered data survives re-visits.
- Added `tests/reseed.harness.mjs` (13 assertions) covering: fresh seed,
  stale v1 → reseeded, versionless → reseeded, corrupt → rebuilt,
  current-version preserved, member login + balance after reseed.

## Verification
- `node tests/store.test.mjs` → **59/59 PASS**
- `node tests/reseed.harness.mjs` → **13/13 PASS**
- Real-browser E2E (headless Edge, Selenium): **22/22 PASS**, 0 console
  errors — including "simulate stale v1 DB → reload portal → history and
  balances restored". See `docs/qa-2026-09-10.md`.

## What still needs real data (admin-entered, no code change needed)
- bKash / Nagad / Rocket / Upay numbers + bank details: **Admin → Settings**.
- Member phone / address: **Admin → Members → Edit** per member.
- Next meeting date if 2026-10-02 is not correct: **Admin → Settings**.

In live (Firebase) mode nothing changes: the reseed logic only runs in demo mode.
