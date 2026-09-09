# Deploy to GitHub Pages

Goal: a free public URL like `https://<your-username>.github.io/nextgen-fund/`.

## One-time setup

1. Create a GitHub account if needed: <https://github.com/signup>
2. Create a **new repository** (green “New” button):
   - Repository name: `nextgen-fund` (any name works)
   - **Public** (required for the free Pages hosting) — it will contain no secrets; the
     Firebase keys in `firebase-config.js` are public-safe by design.
   - Do NOT tick “Add a README” (we already have one).
3. Upload the project folder:
   - **Easy way:** in the repo page → *uploading an existing file* link →
     drag the whole folder contents (index.html, assets/, docs/, tests/, README.md…).
   - **Git way (recommended):** install <https://git-scm.com>, then in this folder run:
     ```bash
     git init
     git add .
     git commit -m "NextGen Fund website"
     git branch -M main
     git remote add origin https://github.com/<your-username>/nextgen-fund.git
     git push -u origin main
     ```
4. Turn on Pages: repo → **Settings** → **Pages** →
   Source **Deploy from a branch**, branch `main`, folder `/ (root)` → **Save**.
5. Wait ~1 minute. Your site is live at
   `https://<your-username>.github.io/nextgen-fund/`.
   (Optional: set a custom domain in the same Pages settings.)

## Redeploying after a change (routine)

Every time you change a file in the repo, push it:

```bash
git add .
git commit -m "describe the change"
git push
```

Pages rebuilds automatically within about a minute. There is **no build step** — the site
is plain HTML/JS/CSS, so what you push is what goes live.

## Before each push — quick checks

```bash
node tests/store.test.mjs        # all 53 checks must pass
```

Also make sure `firebase-config.js` is filled in *before* the first real members register —
see `FIREBASE_SETUP.md`. (If you deploy first and add Firebase later, clear site data or
use a private window after filling the keys.)
