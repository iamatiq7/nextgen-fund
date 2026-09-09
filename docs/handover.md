# NextGen Fund — Admin Handover

Everything the fund admin needs for day-to-day operation. Keep a copy in
`D:\NextGen Fund`.

## 1 · Accounts & passwords

**Demo mode** (this browser only): admin `admin / nextgen2026`, members
`kazi.<name> / nextgen123` (e.g. `kazi.sujon`).

**Live mode (Firebase, after setup):** you create the admin yourself at `setup.html`
with a strong password. Write it here and store this file safely:

```
Admin username: ____________
Admin email:    ____________
Admin password: ____________   (do NOT share this file)
```

- Members choose their own username/password at registration; they change passwords in
  **My Fund → Account settings**.
- Forgot the admin password? Firebase console → Authentication → Users → select the
  admin → **Reset password** (sends an email). In demo mode, clear the browser's site
  data and re-run `setup.html`.
- Never share the admin login. All admin actions are recorded in **Admin → Audit log**.

## 2 · Routine weekly/monthly workflow

1. **Registrations** (as they come): Admin → Registrations → open *Documents* → check
   the ID photo and personal photo → **Accept** (member can log in immediately) or
   **Reject** with a short reason.
2. **Payments** (before each meeting): Admin → Payments → filter `pending` → for each
   one, search the TrxID in your bKash/Nagad/Rocket/Upay app or bank statement →
   amount and sender match → **Verify**. Not found / wrong amount → **Reject** with a
   reason (the member sees it in their history).
   - Cash collected at the meeting: **+ Record payment manually** (verified instantly).
3. **Finance** (once a month): Admin → Finance → add the month's **Revenue** and
   **Loss** entries (and Funding if the opening balance changes). The public dashboard
   updates immediately.
4. **Meeting date**: Admin → Settings → *Next meeting date* + note. Also update the
   bKash/Nagad/Rocket/Upay/bank numbers here whenever they change.
5. **Backup** (after each meeting): Admin → Export → download *Members CSV*,
   *Payment ledger CSV* and *Finance entries CSV* → save to
   `D:\NextGen Fund\backups\`. Files open in Excel.

## 3 · Balances — how they are computed

- **Expected** = months since the member's join month (inclusive) × their monthly due
  (shares × per-share amount).
- **Current due** = expected − verified *due* payments (never below 0).
- **Advance** = verified *advance* payments (money paid ahead; not auto-applied to due).
- **Total paid** = all verified payments.
- Shares and monthly dues are editable per member in **Admin → Members → Edit**
  (e.g. a brother holding 2 shares pays ৳2,000/month).

## 4 · Payment channels

Members pay outside the site, then record it. The numbers you set in
**Admin → Settings** appear inside the member portal when they choose a method:

| Channel | What the member needs | What you verify |
|---|---|---|
| bKash / Nagad / Rocket / Upay | Your number, amount, TrxID from the confirmation SMS | TrxID + amount + sender number |
| Bank transfer | Account name/number/branch | Reference no. + amount |
| Cash (at meeting) | — | Record manually as admin |

## 5 · Data safety & privacy

- The public dashboard shows **aggregates only** — no member names, no balances.
- Member balances and documents are visible only after login; each member sees only
  their own record; only the admin sees everything.
- Registration documents are images/PDFs ≤ 5 MB, stored privately (Firebase Storage).
- Backups: CSV exports (above). In Firebase mode the Firestore console also holds the
  full data; a full JSON backup can be added later if wanted.

## 6 · Redeploying / maintenance

- **Content changes** (payment numbers, meeting date, figures): done in the admin panel
  — no redeploy needed.
- **Code changes**: edit files → `node tests/store.test.mjs` → push to GitHub
  (see `DEPLOY_GITHUB.md`). Pages rebuilds in ~1 minute.
- **Nothing else to maintain**: no server, no renewals. Firebase free tier is far above
  a family fund's usage.

## 7 · Where things came from

- Seed data generated from `D:\NextGen Fund\NextGen Fund.xlsx` (as of 2026-09):
  14 members / 21 shares, ৳162,000 total deposits, monthly per-share ৳1,000.
- Next meeting date and payment numbers in demo mode are **placeholders** — set the
  real ones in Admin → Settings.
