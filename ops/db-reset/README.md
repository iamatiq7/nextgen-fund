# ops/db-reset - owner-run database reset (CI)

The deployed Firestore rules make `settings/bootstrap`, `usernames/*` and `audit/*` undeletable by any
client, and no Firebase CLI / gcloud / service-account key exists on the owner's machine. Admin
credentials bypass security rules, and this repository already carries a service-account secret used
for Hosting deploys - so the reset runs in GitHub Actions with the owner's own credentials, and
**the deployed rules stay exactly as they are**.

This directory was used on 2026-09-14 to empty the live database and return the app to first run.
The one-shot workflow that could delete data has been **removed**; the entries below describe how it
worked and how to restore it if a reset is ever needed again.

## What remains here

| File | Purpose |
| --- | --- |
| `ci-reset.mjs` | the job body: `backup` / `wipe` / `verify`, refuses a wipe unless `CONFIRM_WIPE=yes` |
| `README.md` | this file |
| `REPORT.txt` | the last run's report (counts, hashes, masked ids - no member data) |

## How it was started (restore these two steps to re-arm it)

1. Recreate `.github/workflows/db-reset.yml` (its content is in git history) - it watches
   `ops/db-reset/TRIGGER` on `main` plus a manual "Run workflow" button.
2. Add `ops/db-reset/TRIGGER` whose **first line** is exactly one of:
   - `backup-only 2026-09-14` - read-only: counts + a full JSON backup
   - `wipe 2026-09-14` - backup first, then delete every collection and every auth account

Any other first line (including a file written with a byte-order mark) makes the job read-only - that
fallback was exercised on 2026-09-14 and did exactly that.

## Safety rails (unchanged in the script)

- A wipe needs `CONFIRM_WIPE=yes`, which only the matching trigger line sets.
- Every wipe takes its own backup **inside the same run, before the first delete**.
- Counts are checked again afterwards; the job fails (exit 3) if anything survived.
- `REPORT.txt` holds counts, hashes and masked ids; the JSON backup is a private Actions artifact.
- Order: collections -> prove zero -> auth accounts, so an interrupted run stays recoverable.
