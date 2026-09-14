# ops/db-reset - owner-run database reset (CI)

The deployed Firestore rules make `settings/bootstrap`, `usernames/*` and `audit/*` undeletable
by any client, and no Firebase CLI / gcloud / service-account key exists on the owner's machine.
Admin credentials bypass security rules, and this repository already carries a service-account
secret for deploying to the project - so the reset runs here, with the owner's own credentials,
and **the deployed rules stay exactly as they are**.

## How a run is started

| Trigger | Mode | Effect |
| --- | --- | --- |
| first line of `ops/db-reset/TRIGGER` = `backup-only 2026-09-14` | backup | read-only: counts, a full JSON snapshot, sha256 |
| first line of `ops/db-reset/TRIGGER` = `wipe 2026-09-14` | wipe | backup first, then delete everything |
| "Run workflow" button (manual) | backup / verify | read-only, can never wipe |
| any other push | - | the job does not start (the workflow only watches `ops/db-reset/TRIGGER`) |

## Safety rails

- A wipe needs `CONFIRM_WIPE=yes`, which the workflow only sets when the trigger line matches exactly.
- Every wipe takes its own backup **inside the same run, before the first delete**.
- The wipe checks the counts again afterwards and fails the job (exit 3) if anything survived.
- Any failure is written into `REPORT.txt`, which the workflow commits - a failed run is still inspectable.
- `REPORT.txt` holds counts, hashes and masked ids only. The JSON backup is a private Actions artifact
  (90 days); it never enters the repository.
- The order is: collections -> prove zero -> auth accounts, so an interrupted run still leaves the
  project recoverable from the artifact.

## After the reset

Delete `.github/workflows/db-reset.yml` and this directory in one push: the removal matches no path
filter, so nothing starts, and the destructive capability is gone from the repository.
