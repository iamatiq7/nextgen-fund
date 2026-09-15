# Address migration runbook — `nextgen-fund-2040.web.app` → `nextgenfund.web.app`

**What you asked:** keep every bit of the existing site and simply serve it at `https://nextgenfund.web.app`
instead of `https://nextgen-fund-2040.web.app`. **Status: done and verified.** Date: 2026-09-15.

---

## 1. The short version

A Firebase project can own **more than one Hosting site**. The project `nextgen-fund-2040` already owned the site
`nextgen-fund-2040`; a second site named **`nextgenfund`** was created inside the same project and the very same
content was published to it. So:

| What | Before | After |
| --- | --- | --- |
| Address | `nextgen-fund-2040.web.app` | **`nextgenfund.web.app`** (both live) |
| Content / design / text / language | — | **unchanged** |
| Code, forms, login, records | Firebase project `nextgen-fund-2040` | **the same project** — nothing moved |
| Old address | live | **still live and identical** (kept as the fallback) |

Nothing was deleted, renamed or redesigned. The only source edits are three SEO metadata items (§5).

---

## 2. What actually changed (and what did not)

Changed, in the repository only:

1. `.github/workflows/ngf-host.yml` — a new job that creates the second site, deploys the same content to it, and
   clones the live release so the two addresses are byte-identical. It runs on every push to `main`, next to the
   existing Hosting job.
2. `<link rel="canonical">` and `<meta property="og:url">` on each page, pointing at `nextgenfund.web.app`.
3. `robots.txt` → `Sitemap: https://nextgenfund.web.app/sitemap.xml` (it pointed at the GitHub Pages copy before).
4. `sitemap.xml` → the six public pages, listed under `nextgenfund.web.app` (it listed GitHub Pages URLs before).

Not changed: every word of visible copy, all images, CSS, JavaScript behaviour, the menu, the footer, the language
switcher, the fund numbers, the Firebase configuration, the security rules, and the database.

---

## 3. Verification (all measured against the live hosts, 2026-09-15)

| Check | Result | Evidence |
| --- | --- | --- |
| 11 routes on the old host vs the new host | **byte-identical** (0 mismatches), every one 200 | `evidence/01-parity-check.txt`, `evidence/02-parity-after-seo.txt` |
| 9 referenced assets (CSS, 6 JS, 2 images) on the new host | all 200 | same files |
| `firebase-config.js` on both hosts | **identical** → same Auth + Firestore project, so every record, login and admin view keeps working | same files |
| TLS on the new host | valid, trusted, `TLSv1.3`, `web.app`, Google Trust Services, expires 2026-10-18 | same file |
| Mixed content / third-party hosts | none | same file |
| Real browser run on the new host (home, login, setup, portal, admin) | **no console error, no failed request**, Firebase SDK loaded, `setup.html` reaches `firestore.googleapis.com` | `evidence/03-newhost-check.txt` |
| Sign-in surface | login form renders; a wrong username returns the app's own answer, no crash | same file |
| Sign-in method | email + password only — **no Google sign-in**, so no Auth "authorized domains" change is needed | same file |
| Old host after the migration | still 200, still byte-identical (the fallback) | parity checks |

Automated runs: `Publish to nextgenfund.web.app` **success**, `Deploy to Firebase Hosting` **success**,
`pages build and deployment` **success**.

---

## 4. Day-to-day: how the two addresses stay in step

Every push to `main` now does this twice over — once for each address — and then clones the live release from the
old site to the new one, so they cannot drift. If you edit a page and push, both addresses update together. No
extra step is needed from you.

---

## 5. Search engines

All three public copies of this site (GitHub Pages, `nextgen-fund-2040.web.app`, `nextgenfund.web.app`) were
serving the same text with no canonical hints, which search engines read as duplicate content. Now every page
declares `nextgenfund.web.app` as the canonical address, and `robots.txt` + `sitemap.xml` point there too. Search
engines will consolidate on the new address over the coming days; nothing is lost in the meantime.

---

## 6. The 301 redirect — why it is not on, and the exact steps if you want it

**Why not:** Firebase Hosting serves both sites from the **same** `firebase.json`. A catch-all redirect
(old → new) placed there would also be applied to the new site, which would then redirect to itself — a loop.
Firebase Hosting redirect rules take a *path* on the same site; a cross-domain target is not part of the
documented configuration. Doing it safely needs per-site configuration, which is a larger change than this
migration.

**Option A — leave it as it is (recommended for now).** Both addresses serve the identical site, the canonical
tag tells search engines which is authoritative, and people with an old link still land on the real content.

**Option B — make the old address forward to the new one.** This needs the two sites to have separate rules:

1. Turn `firebase.json` into a multi-site configuration:
   ```json
   { "hosting": [
       { "target": "legacy", "public": ".", "redirects": [ { "source": "/**", "destination": "https://nextgenfund.web.app/:splat", "type": 301 } ] },
       { "target": "current", "public": "." }
   ] }
   ```
2. Add the targets map to `.firebaserc`:
   ```json
   { "projects": { "default": "nextgen-fund-2040",
       "targets": { "nextgen-fund-2040": { "hosting": { "legacy": "nextgen-fund-2040", "current": "nextgenfund" } } } } }
   ```
3. Deploy with `firebase deploy --only hosting:legacy,hosting:current --project nextgen-fund-2040`.
4. Verify: `curl -I https://nextgen-fund-2040.web.app/` must answer `301` with
   `location: https://nextgenfund.web.app/`, and the new address must still answer `200` (never a loop).
5. Roll back: remove the `redirects` block, redeploy, and the old address serves the site again.

This is left to you because it changes how the old address behaves for every visitor — say the word and it can be
applied and verified in one pass.

---

## 7. Rollback

| Situation | What to do | Effect |
| --- | --- | --- |
| You want to stop publishing to the new address | delete `.github/workflows/ngf-host.yml` and push | the new address keeps serving its last release; the old address is untouched |
| A bad release reaches the new address | Firebase console → Hosting → **`nextgenfund`** → Release history → Rollback | the new address returns to the previous release |
| The new address misbehaves entirely | Firebase console → Hosting → `nextgenfund` → **Delete site** | the new address disappears; `nextgen-fund-2040.web.app` keeps working exactly as before |
| You want to undo the SEO metadata | `git revert` the commit `seo(migration): canonical + og:url + sitemap + robots…` and push | metadata returns to the previous state |

Nothing here can damage the old address: the migration is additive. The old host was measured again after every
step and stayed byte-identical throughout — which is itself the tested rollback target.

---

## 8. Access, ownership and cost

| Item | Who | Note |
| --- | --- | --- |
| Firebase project `nextgen-fund-2040` (owns both sites) | you | no new project, no new billing |
| Hosting sites: `nextgen-fund-2040`, `nextgenfund` | you | free tier: 10 GB storage, 360 MB/day transfer per project |
| GitHub repository + the two deploy workflows | you | the service-account secret is unchanged and stays in GitHub Secrets |
| GitHub Pages copy | you | still live; the canonical tag now points away from it — say the word if you want it switched off |

---

## 9. If you hit a blocker — your checklist

1. **Check it yourself (30 seconds).** Open <https://nextgenfund.web.app/> — you should see your site, HTTPS padlock,
   the same pages as before.
2. **If the page does not load:** open <https://nextgen-fund-2040.web.app/> — that copy is untouched and its
   content is the same, so nothing is lost while we look into it.
3. **If a page looks wrong:** tell me the address and what you expected. Both copies are deployed from one
   command, so a wrong page means the source, not the move.
4. **What I need from you for further work (only if you want it):**
   - nothing at all for the site to stay as it is now;
   - your decision on the 301 redirect (§6);
   - your decision on the GitHub Pages copy (keep, or redirect, or switch off);
   - your Firebase console access only if you want me to change Hosting settings that the deploy token cannot touch.
5. **Where things live:** source → `github.com/iamatiq7/nextgen-fund`; hosting → Firebase project
   `nextgen-fund-2040`, site `nextgenfund`; deploy → GitHub Actions workflow `ngf-host.yml`; evidence for this
   migration → `docs/address-migration/evidence/` in the workspace and in the cluster folder.

---

## 10. Evidence index

| File | What it shows |
| --- | --- |
| `evidence/01-parity-check.txt` | page-by-page status and content hash on both hosts, assets, backend config, TLS, redirect chain |
| `evidence/02-parity-after-seo.txt` | the same suite re-run after the SEO metadata deploy |
| `evidence/03-newhost-check.txt` | real browser session on the new address: console, SDK, backend calls, login surface |
| `docs/address-migration-runbook.md` | this document |
