# NextGen Fund — Family Fund Website

A self-contained website for the **NextGen Fund** family fund (run by the Kazi brothers). It
publishes the fund's public figures and gives members an online portal for registrations,
dues and payments — completely free to host on GitHub Pages.

**Seeded with the real ledger** from `D:\NextGen Fund\NextGen Fund.xlsx` (as of 2026-09):
14 members, 21 shares, ৳1,000 per share per month, total deposits **৳162,000** across
Jan–Sep 2026.

## What's inside

| Page | What it does |
|---|---|
| `index.html` | Public dashboard: next meeting date, total funding/revenue/loss, month-by-month bar chart + table |
| `register.html` | New member registration with required document uploads → pending approval |
| `login.html` | Login for members and admins (username or email + password) |
| `portal.html` | Member portal: total paid, current due, advance balance, payment history, record a payment |
| `admin.html` | Admin panel: approve/reject registrations, verify payments, manage members, finance manager, settings, CSV export, audit log |
| `setup.html` | First-run: create the admin account |

## Two modes — demo and live

The site ships with a **demo mode** (no setup): data lives in the browser's `localStorage`
and is pre-seeded with the real fund ledger, sample documents and demo accounts. Every flow
can be tested immediately — useful for the AutoClaw preview or a quick look on your laptop.

To run the fund for real (shared accounts, documents, verified by admin from any device)
you connect a free **Firebase** project — see `docs/FIREBASE_SETUP.md` — and publish the
site to **GitHub Pages** (see `docs/DEPLOY_GITHUB.md`). No server to rent, no database to
administer, ৳0/month.

## Quick start (demo mode)

Open `index.html` in a browser — that's it. Demo accounts:

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `nextgen2026` |
| Member example | `kazi.hamidul` | `nextgen123` |
| Member in arrears | `kazi.sujon` | `nextgen123` (due ৳6,000) |

> Demo data is stored in *your* browser only. Change these passwords once you go live
> (each member changes their own from **My Fund → Account settings**; the admin changes the
> admin password from the admin panel after creating it in `setup.html`).

## Data flow (how it works)

```
Member deposits money outside the site (bKash / Nagad / Rocket / Upay / bank / cash)
   → member records it in My Fund → Pay  (amount, method, date, TrxID)
   → admin checks the real statement → verifies or rejects in Admin → Payments
   → verified amounts update the member's paid / due / advance balances instantly
Admin → Finance  adds monthly revenue/loss and funding entries + the meeting date
   → the public dashboard chart/table/stat cards update instantly (no redeploy)
```

**How "due" is calculated** (shown on every member card):
`months from join month to this month × monthly due − verified due payments`.
Members may hold several **shares** (× monthly per-share amount). Payments of type
*advance* build an advance balance and never reduce the due figure — useful when members
pay ahead.

## Project layout

```
├── index.html · login.html · register.html · portal.html · admin.html · setup.html · 404.html
├── assets/
│   ├── css/style.css        design system (Fathom-style: navy/grey, journal tables)
│   ├── js/
│   │   ├── util.js          money/date/sha256/CSV helpers
│   │   ├── seed-data.js     generated from NextGen Fund.xlsx
│   │   ├── store.js         data layer: demo (localStorage) + Firebase adapter API
│   │   ├── firebase-adapter.js  live backend (Auth + Firestore + Storage)
│   │   ├── firebase-config.js   ← paste your Firebase keys here to go live
│   │   ├── common.js · dashboard.js · register.js · login.js
│   │   └── portal.js · admin.js · setup.js
│   └── img/favicon.svg
├── firestore.rules          Firestore security rules (paste into Firebase)
├── tests/store.test.mjs     end-to-end test suite — `node tests/store.test.mjs` (53 checks)
└── docs/                    HANDOVER.md · FIREBASE_SETUP.md · DEPLOY_GITHUB.md
```

## Where to change things (common edits)

- **Payment numbers / meeting date / fund name / per-share amount** → Admin → Settings (no code).
- **Monthly revenue / loss / funding figures** → Admin → Finance (no code; dashboard updates at once).
- **Required registration documents** → Admin → Settings → “Required registration documents” (pipe-separated).
- **Colours / typography** → `assets/css/style.css` (`:root` variables at the top).
- **Landing copy** → the pages listed above (each HTML file).
- **Seed ledger** (new members, historical payments) → re-run the importer, or use Admin →
  Members / Payments which is the supported way once live. Regenerate `seed-data.js` from
  the spreadsheet with `.openclaw/tmp/make_seed.py` + `gen_seed_js.py` if needed.

## Testing

```bash
node tests/store.test.mjs
```

Covers: registration with documents → admin accept/reject → login rules → due/advance
payments via 5+ methods → verification → balance maths → access isolation → password
change → CSV exports → audit trail (53 assertions).

---

*Made for the NextGen Fund. Data source: NextGen Fund.xlsx (family records). Currency: BDT.*
