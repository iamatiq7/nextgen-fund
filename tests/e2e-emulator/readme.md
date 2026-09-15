# Real-adapter E2E (Firestore + Auth emulator)

These tests run the **actual production code** (`assets/js/firebase-adapter.js`) against a
local Firestore/Auth emulator that enforces the **real `firestore.rules`** of this repo.

Nothing about the app logic is mocked: only the four SDK import URLs inside the adapter are
rewritten to local shims (`build-harness.mjs` does this). The shims re-export the official
modular SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`, `firebase/storage`) and
attach the emulator endpoints, so every rule check and every write goes through the same code
path a browser would use.

## What it proves (29 checks)

| Area | Checks |
| --- | --- |
| First admin claims the fund | setup + sign-in + role |
| Member registers, admin approves | registration visible, approval works |
| Due calculation | 1 month × ৳1,000 = ৳1,000 due |
| **Pending payment reduces the displayed due immediately** | due 1,000 → 0 on submit |
| **Pending is exposed separately** (`pendingDue`) for the UI note | pendingDue = 1,000 |
| **Pending is NOT counted as fund income** | totalFunding stays 0 |
| **Admin approval auto-feeds the fund totals** | totalFunding 1,000, memberDeposits 1,000, pendingDue 0, September row funding 1,000 |
| Member view agrees with admin view | paid 1,000 / due 0 |
| Admin can rename self | persisted, survives re-login |
| Admin can change own password | wrong current → friendly error; new password logs in; old rejected |
| Edge cases | 0 / negative / 1,500 / duplicate reference all rejected, no broken balances |
| Security rules | member cannot verify payments, cannot write settings, cannot add finance, cannot approve accounts |

## Run it

```bash
# 1) once: install tooling in a scratch dir that has node_modules
npm install firebase-tools@15 firebase

# 2) build the harness (rewrites only the 4 SDK URLs)
node build-harness.mjs

# 3) start the emulators (Java 21+ required by the Firestore emulator jar).
#    If `java` is not on your PATH you can launch the jar directly:
#    java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar \
#         --host 127.0.0.1 --port 8080 --rules firestore.rules
#    and the auth emulator with:
#    firebase emulators:start --only auth --project demo-nextgen-fund

# 4) run the suite (wipes emulator state first)
node reset_emulators.mjs
node fixes-live-e2e.mjs
```

Expected tail: `REAL-ADAPTER E2E: ALL PASS`.

## Notes

- The Firestore emulator needs Java 21+. `firebase emulators:exec` shells out to `java`, so Java
  must be on `PATH`; running the jar with an absolute JRE path avoids that requirement.
- Emulator state persists between runs — always run `reset_emulators.mjs` (or restart the
  emulator) before the suite, otherwise the "admin already exists" guard triggers.
- A `PERMISSION_DENIED ... audit` line in the emulator log is expected: the adapter tries to
  append an audit entry while signed out and swallows the denial by design (`try/catch`).
