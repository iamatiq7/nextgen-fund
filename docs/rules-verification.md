# Firestore Rules Verification (reproducible)

Ei folder e `firestore-rules-test.mjs` ache - eta Firestore emulator er
birudhdhe amader security rules gulo test kore. **Result: 44/44 PASS** (2026-09-13).

## Ki ki verify hoy

| Test group | Assertions | Ki proman hoy |
|---|---|---|
| Public read scope | 6 | anon shudhu settings/public + usernames porte pare; users/finance noy |
| Bootstrap + admin claim | 4 | prothom signed-in uid bootstrap claim korte pare; duto bar noy; admin doc shudhu claim-kora uid |
| Member self-registration | 3 | member nijer doc shudhu `status:'pending'` diye banate pare; 'active' ba onner doc noy |
| Locked fields | 6 | nijer phone badlate pare; shares/monthlyDue/status/identity noy; onner doc noy |
| Payments | 10 | 1000/2000/3000 multiple accept; 500/1500 reject; pre-verified reject; onner nam e reject; nijer ta verify korte pare na; admin pare |
| Usernames map | 3 | nijer {uid,email} banate pare; onner ta noy; update kora jay na |
| Admin powers + finance | 5 | admin finance/settings/member edit korte pare; member pare na |
| Audit log | 4 | member append korte pare, porte pare na; admin porte pare; update kora jay na |

## Kivabe cholaben (nijer PC te)

```bash
# 1. Java 21+ thakte hobe (emulator er jonno)
# 2. Ei folder e:
npm init -y
npm install firebase-tools @firebase/rules-unit-testing firebase --no-fund
# 3. firebase.json likhun:
#    { "firestore": { "rules": "../../firestore.rules" },
#      "emulators": { "firestore": { "host": "127.0.0.1", "port": 8080 }, "ui": { "enabled": false } } }
# 4. Emulator + test ek shathe:
npx firebase emulators:exec --only firestore --project demo-nextgen-fund "node firestore-rules-test.mjs"
```

Shesh line e `RULES TEST RESULT: 44 passed, 0 failed` ashbe.

## Gurottopurno

- Ei test emulator e chole - apnar ashol Firebase project e kono kichu chhoy na.
- Rules change korle abar ei test chalan - jeno kono futo na thake.
- Live project e rules publish korar por ami browser diye real test o kore debo.
