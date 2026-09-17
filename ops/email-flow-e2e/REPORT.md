# যাচাই প্রতিবেদন — সদস্যের ইমেইল পরিবর্তনের সম্পূর্ণ ফ্লো

- শেষ ধাপ: finished
- সময়: 2026-09-17T06:24:18.469Z
- প্রকল্প: nextgen-fund-2040
- পরীক্ষিত কোড: assets/js/firebase-adapter.js
- ফলাফল: **6টি পরীক্ষা ব্যর্থ**

| পরীক্ষা | ফল | বিবরণ |
|---|---|---|
| settings/bootstrap gives the admin account | PASS | pvMeMRnI… |
| account rocky: record e-mail ↔ login e-mail agree | PASS | record vea***@gmail.com · auth vea***@gmail.com |
| account admin: record e-mail ↔ login e-mail agree | PASS | record iam***@gmail.com · auth iam***@gmail.com |
| account rafiul: record e-mail ↔ login e-mail agree | PASS | record tem***@gmail.com · auth tem***@gmail.com |
| e-mail alias documents exist for sign-in by address | PASS | 0 alias document(s) |
| the browser SDK imports were redirected for Node (4/4) | PASS | assets/js/firebase-adapter.js |
| the site configuration was readable (apiKey + projectId) | PASS | nextgen-fund-2040 |
| the adapter registered its backend | PASS |  |
| the adapter exposes resolveLogin() | PASS |  |
| the adapter exposes signInByIdentifier() | PASS |  |
| the adapter exposes sendPendingEmailVerification() | PASS |  |
| the adapter exposes createAccountRequest() | PASS |  |
| the adapter exposes decideAccountRequest() | PASS |  |
| the adapter exposes applyEmailChange() | PASS |  |
| malformed address refused (email-bad) | PASS | email-bad |
| member request stored on the record, status pending | PASS | id u-uRPbBv0MLNg5 · fields ["email"] |
| the request keeps old and new address (durable audit data) | PASS |  |
| APPROVAL CHANGES THE RECORD: users/{uid}.email is the new address | PASS | ngf***@mailinator.com |
| the member record no longer shows the old address | PASS |  |
| confirmation state written for the member session | PASS | ngf***@mailinator.com |
| decision kept in the permanent history | FAIL | {} |
| in-app notice written for the member | FAIL |  |
| pending slot cleared (the decision cannot run twice) | PASS |  |
| username registry keeps both candidate addresses (immutable document rules) | PASS | email ngf***@mailinator.com · emailAlt ngf***@mailinator.com |
| alias document created for the new address (login before the link is opened) | PASS | {"uid":"uRPbBv0MLNg5CsrM0fEVDkcaoW83","type":"email","login":"ngf-e2e-mu5596iq@mailinator. |
| old address marked retired | PASS | {"uid":"uRPbBv0MLNg5CsrM0fEVDkcaoW83","type":"email","retired":true,"movedTo":"ngf-e2e-mu5 |
| a second approval is refused (not-found) | PASS | not-found |
| login with the NEW address works | FAIL | error wrong-credentials |
| login with the USERNAME still works (no lock-out) | FAIL | error wrong-credentials |
| the OLD address is refused with a clear message (NO-ERROR) | FAIL | NO-ERROR |
| confirmation mail requested from the member session ({"status":"sent","to":"ngf-e2e-mu5596iq.new@mailinator.com"}) | PASS | {"status":"sent","to":"ngf-e2e-mu5596iq.new@mailinator.com"} |
| the send is recorded on the record for the status banner | PASS | {"to":"ngf-e2e-mu5596iq.new@mailinator.com","status":"sent","sentAt":"2026-09-17T06:24:09.156Z","requestedBy":"member-session"} |
| reconcile keeps the approved address while the link is pending | PASS | returned {"from":"ngf-e2e-mu5596iq.new@mailinator.com","to":"ngf-e2e-mu5596iq@mailinator.com","pending":"ngf-e2e-mu5596iq.new@mailinator.com","applied":false} · record ngf***@mailinator.com |
| applyEmailChange either confirms the address or asks for a password (verify-sent) | PASS | verify-sent |
| a rejection leaves the account address untouched | PASS | ngf***@mailinator.com |
| the rejection is recorded with its status | FAIL | {} |
| the member can ask again after a rejection | PASS |  |
