# Firebase setup (going live)

The website itself is static (GitHub Pages). Firebase provides the free backend so all
brothers share one database: real logins, registrations, documents and the ledger.

Create everything with a personal Google account at <https://console.firebase.google.com> —
the free **Spark plan** is enough for a family fund.

## 1 · Create the project

1. **Add project** → name `nextgen-fund` → continue (Analytics optional, off is fine).
2. Project overview → the **`</>`** (Web) icon → register app `NextGen Fund` →
   copy the `firebaseConfig` object it shows you.

## 2 · Paste the keys

Open `assets/js/firebase-config.js` and fill in every `""` with the values from step 1:

```js
window.NGF_FIREBASE_CONFIG = {
  apiKey: "AIza…",
  authDomain: "nextgen-fund.firebaseapp.com",
  projectId: "nextgen-fund",
  storageBucket: "nextgen-fund.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

These values are **not secrets** (they identify the project); security comes from the
rules in step 3 + 4. Commit the file and push (see DEPLOY_GITHUB.md).

## 3 · Firestore database

1. Build → **Firestore Database** → Create database → **Production mode** → region
   `asia-south1` (Mumbai — closest to Bangladesh) → Enable.
2. Tab **Rules** → replace everything with the contents of `firestore.rules` from this
   project → **Publish**.

## 4 · Storage (registration documents)

1. Build → **Storage** → Get started → Production mode → same region.
2. Tab **Rules** → paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /registrations/{uid}/{file} {
      allow write: if request.resource.size < 5 * 1024 * 1024
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

3. Publish.

## 5 · Authentication

1. Build → **Authentication** → Get started.
2. Enable the **Email/Password** provider (leave “Email link” off). Save.
3. Settings → **Authorized domains** → add
   `<your-username>.github.io` (and any custom domain), otherwise logins from the live
   site are blocked.

## 6 · Create the admin account

1. Open your live site → `setup.html`.
2. Enter username `admin`, your name, email and a strong password (12+ characters).
   The page signs you up and claims the one-time bootstrap slot — after this, nobody
   else can become admin through the site.
3. You land in the admin panel. Do the first-run config in **Admin → Settings**:
   real bKash/Nagad/Rocket/Upay numbers, bank account, next meeting date.

> Notes
> - In Firebase mode the site **never seeds demo data** — you start with a clean ledger.
>   Enter the opening figures in Admin → Finance: one *Funding* entry per month
>   (Jan 21,000 … Sep 7,000 from the xlsx) — or a single entry for the total ৳162,000 if
>   you prefer; members and their payment history are added in Admin → Members /
>   Payments (“Record payment manually” is how past cash deposits are entered).
> - Want the seeded history inside Firebase instead? Register each brother once with
>   their share count, then record their past payments as admin. It takes ~15 minutes
>   for 14 members and keeps everything in one ledger.
> - `setup.html` also exists in demo mode (browser-only admin account).

## 7 · Verify the live site

- Register a test member, check it appears in Admin → Registrations with its documents.
- Accept it, log in as the member, submit a payment, verify it as admin, confirm balances.
- Check the public dashboard shows the figures you entered.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login says “auth/unauthorized-domain” | Add the site domain in Authentication → Settings → Authorized domains |
| Registrations save but no documents | Storage rules not published, or bucket not created |
| “Missing or insufficient permissions” | Firestore rules not published, or admin never claimed via setup.html |
| Site still shows “Demo mode” | `firebase-config.js` values not filled/pushed, or viewing old cache (Ctrl+F5) |
