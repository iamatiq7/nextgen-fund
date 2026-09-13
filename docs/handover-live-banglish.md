# LIVE HANDOVER — NextGen Fund (Firebase live mode)

Ei document ta apnar jonno — ami (AutoClaw) ja ja korte parini, segulo apni ei
steps follow kore 10-15 minute e shesh korte parben. Tarpor site puropuri live.

---

## Ekhon ki obostha (ami ja korechi / verify korechi)

| Kaj | Status |
|---|---|
| Firebase config site er sathe connected (project `nextgen-fund-2040`) | ✅ Done — live URL e header e **"Live · Firebase"** dekha jay |
| Real-time live update code (onSnapshot) — admin change korle refresh chara site update hobe | ✅ Done + tested (demo regression 22/22 pass) |
| GitHub -> Firebase Hosting auto-deploy files (`firebase.json`, `.github/workflows/firebase-hosting.yml`) | ✅ Done — GitHub Secret add korlei kaj shuru |
| Firestore security rules (`firestore.rules`) | ✅ Ready — console e paste korlei active |
| **Firestore database created?** | ❌ **NAI** — probe kore dekhlam: *"Cloud Firestore API has not been used in project nextgen-fund-2040"* |
| **Authentication (Email/Password) enabled?** | ❌ **NAI** — probe: `CONFIGURATION_NOT_FOUND` |
| **Storage created?** | ❌ **NAI** |

Ei karonei ekhon login/setup kaj kore na — kono bug na, shudhu console setup
baki. Nicher 4 ta kaj korlei site live hoye jabe.

---

## APNAR 4 TA KAJ (exact steps)

### Kaj 1 — Firestore database toiri korun (sobcheye joruri)
1. Jan <https://console.firebase.google.com> -> project **nextgen-fund-2040**
2. Left menu -> **Build -> Firestore Database**
3. **Create database** click korun
4. **Production mode** select korun
5. Location: **asia-south1 (Mumbai)** -> **Enable** (2-3 minute lagbe)
6. Database ready hoye gele upore **Rules** tab e jaan
7. Rules file er **puro content** copy kore editor e paste korun (age jeta ache muche).
   File ta dui jaygay ache - jeta shohoj hoy:
   - Local (recommended): C:\Users\SMART\OneDrive\Documents\Scheme\NextGenFund\firestore.rules
   - GitHub: <https://github.com/iamatiq7/nextgen-fund/blob/main/firestore.rules>
     *(GitHub e notun rules push hote ekbar apnar push lagbe - niche dekhen)*
8. **Publish** click korun

### Kaj 2 — Authentication chalu korun
1. Left menu -> **Build -> Authentication** -> **Get started**
2. **Email/Password** select korun -> **Enable** -> **Save**
3. **Settings** tab -> **Authorized domains** -> **Add domain**
4. Likhun: `iamatiq7.github.io` -> Add
   *(na dile live site theke kono login-i kaj korbe na)*

### Kaj 3 — Storage toiri korun (registration er ID/photo upload er jonno)
1. Left menu -> **Build -> Storage** -> **Get started**
2. **Production mode** -> same region **asia-south1** -> **Done/Enable**
3. **Rules** tab e ei rules paste korun -> **Publish**:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /registrations/{uid}/{file} {
      allow write: if request.auth != null
        && request.auth.uid == uid
        && request.resource.size < 5 * 1024 * 1024
        && (request.resource.contentType.matches('image/.*')
            || request.resource.contentType == 'application/pdf');
      allow read: if request.auth != null;
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

### Kaj 4 — GitHub Secret (auto-deploy er jonno) — eita optional kintu recommended
1. Firebase console -> gear icon **Project settings** -> **Service accounts** tab
2. **Generate new private key** -> **Generate key** -> ekta `.json` file download hobe
3. GitHub repo -> **Settings** -> **Secrets and variables -> Actions**
4. **New repository secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT_NEXTGEN_FUND_2040`
   - Secret: oi `.json` file er **puro content** paste korun
5. Save — er por theke `main` e prottek push auto Firebase Hosting e deploy hobe

> ⚠️ Oi `.json` file kokhono chat e pathaben na, repo te commit korben na —
> shudhu GitHub Secret e rakhben. (Secret safe rakha amader doiTTa.)

---

## Kaj 4 shesh hole — Ki hobe (ami verify kore dibo)

1. **`setup.html`** kholun -> admin account toiri korun (username `admin`,
   apnar email, shoktishali password 12+ chars) — ekbar e hoye gele ar keu
   nijeke admin banate parbe na
2. **Admin -> Settings**: ashol bKash/Nagad/Rocket/Upay number, bank info,
   porer meeting er date din — ekhon **sobar kache permanently** dekhabe
3. **Admin -> Members**: sob bhai der add korun (share number din — monthly
   due nijei hisheb hobe: share x 1,000 tk)
4. **Admin -> Payments -> Record payment manually**: Jan-Sep er purono joma
   entry korun (moto ৳1,62,000) — verify hoye gele balance update
5. **Amake bolun "kaj sesh"** — ami browser diye verify kore dibo:
   login, data live update (refresh chara), admin change -> member er kache
   instant update, rules test (admin chara write reject) — sob proof soho

---

## Rollback & Troubleshooting

| Somoshya | Somadhan |
|---|---|
| `auth/unauthorized-domain` | Kaj 2, step 3-4 (authorized domain) |
| login e "Cannot reach the database" (20 sec por) | Firestore toiri hoyni (Kaj 1) |
| "Missing or insufficient permissions" | Firestore rules Publish hoyni (Kaj 1, step 6-8) |
| Site abar "Demo mode" dekhay | `assets/js/firebase-config.js` site e push hoyni; Ctrl+F5 |
| Kharap version deploy hoye gele | Firebase Hosting: console -> Hosting -> **Release history** -> ager release e **Rollback** (2 min) |
| GitHub Actions fail | Actions tab -> log dekhen; secret name vul hole ei error; thik kore abar push |
| Data backup | Admin -> Export (3 ta CSV); Firestore console theke-o export kora jay |
| Puro site demo te firte chan | `firebase-config.js` er value gulo khali `""` kore push korun |

## Gurottopurno Note
- Firebase **Spark plan (free)** e sob kaj cholbe — kono taka lagbe na
- Firebase web config (apiKey etc.) **public thakai thik** — security ashe
  Firestore/Storage **rules** theke (Kaj 1 & 3)
- GitHub Pages (iamatiq7.github.io/nextgen-fund) age'r moto cholte thakbe;
  Firebase Hosting ekta extra address dibe (nextgen-fund-2040.web.app)

---

## Review findings & notes (independent reviewer, 2026-09-10)

Ekjon independent reviewer ei changes gulo review korechhe. Tar findings onujayi
ami (AutoClaw) ei issue gulo **fix korechi** (push hoye gechhe):

| Issue | Fix |
|---|---|
| Rules: admin setup / member self-create block hoye jeto (role admin + bootstrap check) | Rules v2: bootstrap claim kora uid-i admin doc banate parbe; member self-create setup er por |
| Rules: member payment status 'pending' force kora chilo na (self-verify kora jeto) | Rules v2: create te status=='pending', type due/advance, verifiedAt/By null force |
| Rules: member nijer shares/monthlyDue/joinMonth bodlate parbe | Rules v2: ei field gulo self-update e locked |
| Member dashboard 'users' list (admin-only) porte parbe na | now: settings/public e memberCount rakha hoy (admin sync kore); list denial hole fallback |
| Username login e onno user er email porto (rules e deny hobe) | now: usernames map ei { uid, email } rakhe; login shudhu ota pore |
| Storage rules e auth check chilo na | Doc update: request.auth.uid == uid baddho kora hoyeche |
| Refresh e session flaky (auth restore race) | getSession e authStateReady await kora hoy |
| Live listener partial fail e leak | Debounce (200ms) + safe attach/cleanup + console warning |
| Adapter e 1000-tk multiple validation chilo na (raw permission error) | Adapter e friendly validation message add |
| Bigger note: registration collision checks Firestore e late hoy | Jatota ja - admin approve korar age check korte hobe (future mejaj) |

**Privacy note:** username login er jonno usernames collection public — tate
shudhu { uid, email } thake (naam/phone/address na). Email public rakhte na chaile
aman ku bolun, ami username login baad diye email-only login kore dibo.

---

## GitHub push (ekbar apnar hate)

Notun code + rules GitHub e tule dite ekbar apnar credential lagche (ami
security-r CARONE apnar password/token charchi na). Dui vabe parben:

**Vabe 1 (shohoj):** Windows Terminal kholun, ei folder e jaan:
`
cd C:\Users\SMART\.openclaw-autoclaw\agents\atiqv2\workspace\.openclaw\tmp\gh-clone
git push origin main
`
Sign-in window ashle GitHub e login korun - tahole push hoye jabe.
(Commit 4b85759 agei toiri - shudhu push baki.)

**Vabe 2:** Amake ekta **fine-grained Personal Access Token** din
(GitHub -> Settings -> Developer settings -> Tokens (fine-grained) ->
only iamatiq7/nextgen-fund repo -> Contents: Read and write). Amitoken
diye push kore debo, tarpor apni token ta **revoke** kore diten.

Push hoye gele GitHub Pages (~1 min) + Firebase Hosting (workflow cholle)
dutoi notun version peye jabe.
