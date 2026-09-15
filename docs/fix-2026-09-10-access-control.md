# Fix note — access control & credit rule (2026-09-10, v3)

## Requirements implemented
1. **Credits only in multiples of 1,000 tk** (1×1000, 2×1000, 3×1000, …).
2. **Admin never sees the "My Fund" tab**; members/visitors never see the
   Admin link or the admin panel.
3. **Dashboard (index) requires login** — logged-out visitors are sent to the
   login page.

## Changes
| File | Change |
|---|---|
| `assets/js/store.js` | `submitPayment` + `addManualPayment` reject amounts that are not multiples of 1,000 tk (error: "Amount must be a multiple of 1,000 tk (1x1000, 2x1000, 3x1000, ...).") |
| `firestore.rules` | Payment `create` now requires `amount >= 1000 && amount % 1000 == 0` (server-side enforcement for Firebase live mode) |
| `assets/js/common.js` | Role-aware navigation: Dashboard for all; **My Fund only for members**; **Admin only for admins**; Register/Login links only for visitors; footer Admin/Setup links only for admins |
| `assets/js/dashboard.js` | Login guard: logged-out visitors opening the dashboard are redirected to `login.html?next=index.html` |
| `portal.html` | Amount input: `min=1000 step=1000` |
| `tests/store.test.mjs` | Test amounts updated to 1,000-multiples; expectations recomputed (paid 4000 → 7000; CSV total 107000) |
| `tests/access.test.mjs` | New: 12 assertions covering the amount matrix and admin manual-entry rule |

## Verification
- `node tests/store.test.mjs` → **59/59 PASS**
- `node tests/access.test.mjs` → **12/12 PASS** (100/500/999/1500/2500 rejected; 1000/2000/5000 accepted; admin manual 500 rejected, 3000 recorded; ledger persists)
- `node tests/reseed.harness.mjs` → **13/13 PASS**
- Browser E2E (headless Edge): roles suite **22/22 PASS** — logged-out gating,
  nav per role, admin-URL bounce, full amount matrix, ledger visibility,
  admin member-edit persists and is visible to the member after re-login;
  regression suite **22/22 PASS, 0 console errors**.

## Notes
- Admin-manual (cash) entries follow the same 1,000 tk rule for consistency.
- Finance entries (funding/revenue/loss) are fund-level bookkeeping and are
  intentionally NOT restricted to 1,000 multiples.
- In Firebase live mode the rule is also enforced by Firestore security
  rules, so it cannot be bypassed from the browser console.
