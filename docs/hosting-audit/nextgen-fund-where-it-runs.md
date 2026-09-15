# `https://nextgen-fund-2040.web.app/setup.html` — কোথায় হোস্ট ও রান হচ্ছে?

**প্রমাণসহ হোস্টিং ও রানটাইম রিপোর্ট** · অডিটের সময়: 2026-09-14, 15:57–16:05 (Asia/Dhaka) · অডিটকারী: ATIQ.V2
**পদ্ধতি:** শুধু পাবলিক HTTP/DNS/TLS রিকোয়েস্ট + সার্ভ করা ফাইলের স্ট্যাটিক বিশ্লেষণ + হেডলেস Chromium-এ রিয়েল পেজ লোড। কোনো লগইন নেই, কোনো স্ক্যান নেই, সাইটের কিছু বদলানো হয়নি।
**প্রমাণ ফোল্ডার:** `docs/hosting-audit/evidence/` (প্রতিটি দাবির পাশে ফাইলের নাম দেওয়া আছে)

---

## ০. এক নজরে উত্তর

**পেজটি কোনো নিজস্ব সার্ভারে রান করে না।** এটি একটি **স্ট্যাটিক HTML ফাইল**, যা **Firebase Hosting** (Google-এর ম্যানেজড হোস্টিং, প্রজেক্ট আইডি `nextgen-fund-2040`) থেকে **Google-এর গ্লোবাল এজ ক্যাশ** দিয়ে সার্ভ হয় — আমাদের পরিমাপে ক্যাশ নোডটি ছিল **CCU (কলকাতা)**। পেজে কোনো সার্ভার-সাইড কোড নেই; JavaScript ব্রাউজারে চলে, আর ডেটা যায় Google-এর ম্যানেজড সার্ভিসে — **Firebase Authentication** ও **Cloud Firestore**-এ, একই প্রজেক্টে।

| প্রশ্ন | উত্তর | আস্থা |
| --- | --- | --- |
| হোস্টিং প্ল্যাটফর্ম | Firebase Hosting (Google) — `web.app` ডোমেইন | **নিশ্চিত** |
| কোন সার্ভার/এজ থেকে | Google এজ ক্যাশ নোড, কোড **CCU = Kolkata**; IP `199.36.158.100` (IPv4), `2620:0:890::100` (IPv6) | **নিশ্চিত** (ক্যাশ নোড), **সম্ভাব্য** (CDN লেয়ার = Fastly-ধাঁচের, Firebase Hosting-এর ক্যাশ লেয়ার) |
| Origin রিজিয়ন | পাবলিকভাবে জানা যায় না (Hosting origin রিজিয়ন হেডারে আসে না) | **অনিশ্চিত** |
| সার্ভার-সাইড রানটাইম | নেই — সম্পূর্ণ স্ট্যাটিক; APP-এর "ব্যাকএন্ড" = Firebase Auth + Cloud Firestore | **নিশ্চিত** |
| ডেটা কোথায় যায় | `identitytoolkit.googleapis.com` (Auth) + `firestore.googleapis.com` (Firestore), প্রজেক্ট `nextgen-fund-2040` — অর্থাৎ Google Cloud | **নিশ্চিত** (রিয়েল ব্রাউজার ট্রেসে দেখা গেছে) |
| ডেটাবেসের ভৌগোলিক লোকেশন | পাবলিকভাবে জানা যায় না; Firebase console → Firestore → Location-এ দেখা যাবে | **অজানা** |
| ডিপ্লয় কীভাবে হয় | GitHub repo `iamatiq7/nextgen-fund` → GitHub Actions (`firebase-hosting.yml`) → Firebase Hosting `live` চ্যানেল | **নিশ্চিত** (ফাইল হ্যাশ + `last-modified` + workflow) |
| একই ফাইল কি অন্য জায়গায়ও আছে? | হ্যাঁ — GitHub Pages (`iamatiq7.github.io/nextgen-fund/`) একই bytes সার্ভ করে | **নিশ্চিত** |

---

## ১. হোস্টিং প্রোভাইডার নির্ধারণ (নিশ্চিত)

তিনটি স্বাধীন প্রমাণ একই দিকে ইঙ্গিত করে:

| প্রমাণ | মান | ফাইল |
| --- | --- | --- |
| রেসপন্স হেডার `vary` | `x-fh-requested-host, accept-encoding` — `fh` = **F**irebase **H**osting-এর নিজস্ব সিগনেচার | `04-http-detail-a.txt` |
| ডোমেইন জোনের SOA | `web.app` → `ns1.googledomains.com` (Google-পরিচালিত জোন) | `01-dns-http-headers.txt` |
| TLS ইস্যুয়ার ও SAN | `web.app`, `*.web.app` — **Google Trust Services** (WR4), শুধু `web.app` ডোমেইনের জন্য Google-ই ইস্যু করে | `02-tls-run-a.txt` |
| IP মালিকানা (RDAP) | `199.36.158.100` Google-এর রেঞ্জ; `firestore.googleapis.com` → `172.217.x.4` রেঞ্জ `NET-172-217-0-0-1`, মালিক **GOOGLE** | `01-dns-http-headers.txt` |
| HSTS | `strict-transport-security: max-age=31556926; includeSubDomains; preload` (Firebase Hosting-এর ডিফল্ট) | `04-http-detail-a.txt` |

**Netlify / Vercel / কাস্টম সার্ভার নয়** — ওই প্ল্যাটফর্মগুলোর হেডার সিগনেচার (`server: Netlify`, `x-vercel-*`) কোথাও নেই; `server` হেডারই আসে না, যা Firebase Hosting-এর বৈশিষ্ট্য।

---

## ২. DNS ও ডোমেইন কাঠামো

| রেকর্ড | মান | মন্তব্য |
| --- | --- | --- |
| `nextgen-fund-2040.web.app` **A** | `199.36.158.100` | TTL ~5916s |
| `nextgen-fund-2040.web.app` **AAAA** | `2620:0:890::100` | IPv6 সাপোর্টেড |
| `web.app` **SOA** | `ns1.googledomains.com` | জোন Google-এর; ব্যবহারকারীর নিজের DNS জোন নয় |
| `nextgen-fund-2040.firebaseapp.com` **TXT** | ২টি TXT রেকর্ড আছে (Firebase-এর verification) | ডোমেইন ওনারশিপ মার্কার |
| `iamatiq7.github.io` **SOA** | `dns1.p05.nsone.net` | NS1 (IBM)-পরিচালিত, GitHub Pages-এর DNS |
| `firebaseapp.com` **SOA** | `ns-cloud-c1.googledomains.com` | Google Cloud DNS |

গুরুত্বপূর্ণ: এখানে **কোনো কাস্টম ডোমেইন নেই** — যেমন `nextgenfund.com` টাইপ ডোমেইন DNS-এ যুক্ত নেই। সাইটটি Google-এর দেওয়া দুটি হোস্টনেমে চলে (`web.app` ও `firebaseapp.com`)।

---

## ৩. TLS সার্টিফিকেট

| ফিল্ড | `nextgen-fund-2040.web.app` | `iamatiq7.github.io` |
| --- | --- | --- |
| প্রোটোকল / cipher | TLSv1.3 / `TLS_AES_128_GCM_SHA256` | TLSv1.3 / `TLS_AES_128_GCM_SHA256` |
| Leaf subject | `CN=web.app` | `CN=*.github.io` |
| Issuer | **Google Trust Services** (WR4) | **Let's Encrypt** (YR1) |
| SAN | `DNS:web.app, DNS:*.web.app` | `*.github.com, *.github.io, *.githubusercontent.com, github.com, github.io, githubusercontent.com` |
| মেয়াদ | 2026-07-20 → **2026-10-18** | 2026-08-02 → **2026-10-31** |
| Chain | WR4 → GTS Root R1 → GlobalSign Root CA | YR1 → Root YR → ISRG Root X1 |
| ALPN (ব্রাউজার-সম্মত প্রোটোকল) | `h2` (HTTP/2), `alt-svc`-এ `h3` (HTTP/3) | `h2` |

সার্টিফিকেট Google নিজেই ম্যানেজ করে (auto-renew); আপনার কিছু করতে হবে না। মেয়াদ শেষ হওয়ার তারিখ শুধু রেকর্ডের জন্য — অটো-রিনিউ হয়।

---

## ৪. রিকোয়েস্ট ও রিডাইরেক্ট চেইন

```
https://nextgen-fund-2040.web.app/setup.html      → 200  (hops: 1, কোনো রিডাইরেক্ট নেই)
http://nextgen-fund-2040.web.app/setup.html       → 301 → https://…  → 200   (HSTS force)
https://nextgen-fund-2040.firebaseapp.com/setup.html → 200  (একই কনটেন্ট, একই etag)
https://iamatiq7.github.io/nextgen-fund/setup.html  → 200  (একই bytes, আলাদা হোস্ট)
https://nextgen-fund-2040.web.app/<নেই-এমন-পাথ>   → 200 index.html  (soft-404; SPA rewrite)
```

**সতর্কতা:** `firebase.json`-এ `rewrites: ** → /index.html` থাকায় ভুল URL-ও 404 দেয় না, বদলে হোমপেজ ফেরত দেয় (HTTP 200)। SEO/মনিটরিংয়ের জন্য এটা বিভ্রান্তিকর হতে পারে — এটা একটি প্রকৃত পর্যবেক্ষণ, বাগ নয় (ডিজাইন-সিদ্ধান্ত)।

**রেসপন্স হেডার (setup.html, Firebase Hosting):**

| হেডার | মান | ব্যাখ্যা |
| --- | --- | --- |
| `x-served-by` | `cache-ccu830031-CCU` → পরে `cache-ccu830067-CCU` | ক্যাশ নোড **CCU = কলকাতা** (দুই রানে দুই নোড, একই এজ) |
| `x-cache` / `x-cache-hits` | `HIT` / `0–2` | এজ ক্যাশ থেকে সার্ভ হয়েছে |
| `x-timer` | `S…,VS0,VE1` | ক্যাশ-লেয়ারের টাইমিং হেডার (Fastly-ধাঁচের পরিবার) |
| `cache-control` | HTML: `max-age=3600`; assets: `public, max-age=600` | assets-এর 600s মান `firebase.json` থেকে |
| `etag` | `"7e4f56ca…-br"` | Brotli-ভেরিয়েন্টের কনটেন্ট হ্যাশ |
| `last-modified` | `Mon, 14 Sep 2026 09:46:47 GMT` | সর্বশেষ ডিপ্লয়ের সময় (UTC) |
| `content-encoding` | `br` | Brotli কমপ্রেশন |
| `vary` | `x-fh-requested-host, accept-encoding` | একাধিক হোস্ট-নাম একই সাইটে ম্যাপ করা |

---

## ৫. আর্কিটেকচার ডায়াগ্রাম (যতটুকু পাবলিকভাবে প্রমাণিত)

```
  ব্রাউজার (ব্যবহারকারী, ঢাকা)
      │
      │  1. DNS: nextgen-fund-2040.web.app → A 199.36.158.100 / AAAA 2620:0:890::100
      ▼
  Google এজ ক্যাশ নোড  ← পরিমাপে: cache-ccu8300xx-CCU (কলকাতা)
      │  2. TLS 1.3 (Google Trust Services, CN=web.app) · ALPN h2 · alt-svc h3
      │  3. স্ট্যাটিক ফাইল: setup.html + assets/js/*.js + assets/css/style.css (Brotli)
      ▼
  Firebase Hosting (প্রজেক্ট nextgen-fund-2040)  ── কোনো সার্ভার-সাইড কোড নেই
      │
      │  4. পেজের JS ব্রাউজারেই চলে; Firebase JS SDK v10.12.2 ডাউনলোড হয়
      │     www.gstatic.com/firebasejs/10.12.2/firebase-{app,auth,firestore,storage}.js (142.251.222.195)
      ▼
  Google ম্যানেজড ব্যাকএন্ড (একই প্রজেক্ট)
      ├── Firebase Authentication  identitytoolkit.googleapis.com   (লগইন/অ্যাকাউন্ট তৈরি)
      ├── Cloud Firestore          firestore.googleapis.com         (তথ্য পড়া/লেখা; পেজ লোডেই Listen/channel)
      └── Cloud Storage            storageBucket = nextgen-fund-2040.firebasestorage.app (ছবি/ডকুমেন্ট, ব্যবহৃত হলে)

  সোর্স → ডিপ্লয়:
  GitHub repo iamatiq7/nextgen-fund ──push(main)──▶ GitHub Actions "Deploy to Firebase Hosting"
                                                   (service-account secret) ──▶ Hosting live চ্যানেল
  একই repo ──▶ GitHub Pages (iamatiq7.github.io/nextgen-fund)  [দ্বিতীয় পাবলিক origin]
```

---

## ৬. `setup.html` পেজ বিশ্লেষণ

| বিষয় | ফলাফল | প্রমাণ |
| --- | --- | --- |
| ফ্রেমওয়ার্ক / বিল্ড | **কোনোটিই নেই** — প্লেইন HTML + ভ্যানিলা JS (IIFE), কোনো bundler/React/Vue নয়, `.js` ফাইলগুলো সরাসরি `<script src>`-এ লোড হয় | `setup.html`, `05-code-analysis.txt` |
| ফাইল সাইজ | `setup.html` = **1461 bytes**, sha256 `6221c6e22192b1…` — **repo-র HEAD-এর সাথে হুবহু মিল** | `03-live-files-a.txt` |
| লোড হওয়া লোকাল অ্যাসেট | ১১টি (style.css, util.js, i18n.js, seed-data.js, firebase-config.js, store.js, firebase-adapter.js, common.js, setup.js, favicon, apple-touch-icon) — **সবই repo-র সাথে হুবহু মিল, বাইট-লেভেলে** | `03-live-files-a.txt` |
| বাহ্যিক স্ক্রিপ্ট | `www.gstatic.com/firebasejs/10.12.2/firebase-app.js`, `-auth.js`, `-firestore.js`, `-storage.js` (Google CDN) | `06-browser-network-trace-a.txt` |
| i18n | নিজস্ব ব্যবস্থা — `data-i18n` অ্যাট্রিবিউট + `assets/js/i18n.js` (EN + BN অভিধান) | `05-code-analysis.txt` |
| পেজের ভাষা | `<html lang="en">`, বডি-টেক্সট ইংরেজি (রানটাইমে ভাষা বদলানো যায়) | `setup.html` |
| ফর্ম আছে কি? | **শর্তসাপেক্ষ** — পেজ নিজে ফর্ম বানায় **শুধু** যদি `settings/bootstrap` না থাকে | `setup.js`, `08-page-state-*.txt` |
| ফর্মের ফিল্ড (তৈরি হলে) | `#su-user` (text, ডিফল্ট `admin`) · `#su-name` (text) · `#su-email` (email) · `#su-pass` (password) · submit বাটন | `08-page-state-a.txt`, `setup.js` |
| সাবমিট কোথায় যায় | সার্ভারে **নয়** — `S.setupAdmin()` → Firebase **Auth**-এ অ্যাকাউন্ট (`createUserWithEmailAndPassword`) → তারপর Firestore-এ `settings/bootstrap`, `users/{uid}`, `usernames/{name}`, `settings/public` | `05-code-analysis.txt` |
| অডিট সময়ে প্রকৃত অবস্থা | `settings/bootstrap` **আছে** (`adminUid = SxCwc5…`), তাই পেজ লেখে *"An admin account already exists — setup is complete."* এবং পেজে **০টি form, ০টি input** রেন্ডার হয় | `08-page-state-b.txt`, `06-browser-network-trace-a.txt` |
| Firestore কালেকশন (কোডে) | `users`, `usernames`, `payments`, `registrations`, `settings` (+ `finance`, `audit` ব্যবহৃত) | `05-code-analysis.txt` |

**নেটওয়ার্ক ট্রেস (রিয়েল ব্রাউজার, মোট ১৯টি রিকোয়েস্ট):**

| হোস্ট | কতটি | IP | কী |
| --- | --- | --- | --- |
| `nextgen-fund-2040.web.app` | ১২ | `199.36.158.100` | HTML + CSS + ৮টি JS + ২টি PNG (সব HTTP/2 বা h3) |
| `www.gstatic.com` | ৪ | `142.251.222.195` | Firebase JS SDK v10.12.2 |
| `firestore.googleapis.com` | ৩ | `172.217.24.10` | `Listen/channel?database=projects/nextgen-fund-2040/databases/(default)` — পেজ লোডেই Firestore লাইভ-লিস্টেন শুরু হয় |

**ডেটা জমা হয় কোথায় — সংক্ষেপে:** ব্যবহারকারী যা-ই টাইপ করুন (নাম, ইমেইল, পাসওয়ার্ড, অ্যাডমিন তথ্য), তা আপনার সার্ভারে যায় না; যায় Google-এর Firebase Authentication (পাসওয়ার্ড) এবং Cloud Firestore (নাম/ইউজারনেম/হিসাব) — প্রজেক্ট `nextgen-fund-2040`-এর ভেতরে। কোনো থার্ড-পার্টি অ্যানালিটিক্স বা ট্র্যাকিং স্ক্রিপ্ট ট্রেসে পাওয়া যায়নি।

**একটি বাস্তব পর্যবেক্ষণ:** ওয়েব কনফিগে থাকা `apiKey` (`firebase-config.js`, পাবলিকলি সার্ভ হয়) একটি **পাবলিক ক্লায়েন্ট আইডেন্টিফায়ার** — এটি গোপন কিছু নয়; নিরাপত্তা আসে Firestore/Storage Security Rules ও Auth থেকে। তবে Firestore rules-এ ডিফল্ট-ডিনাই থাকা জরুরি (বর্তমানে আছে — আমরা যাচাই করেছি: anonymous পড়ার চেষ্টায় `403` ফেরে)।

---

## ৭. বর্তমান প্রকৃত অবস্থা (অডিটের মুহূর্তে) — একটি গুরুত্বপূর্ণ আবিষ্কার

| সময় (UTC) | ঘটনা | প্রমাণ |
| --- | --- | --- |
| 09:34 ও 09:41 | ডেটাবেস সম্পূর্ণ খালি করা হয় (৫৪ → ০ ডকুমেন্ট), সব Auth অ্যাকাউন্ট মুছে | `docs/evidence/reset-executed.txt` |
| 09:47 | `settings/bootstrap` → `404` (প্রজেক্ট প্রথম-রান অবস্থায়) | আগের সেশন প্রমাণ |
| 09:47–10:00 | **`settings/bootstrap` আবার তৈরি হয়েছে** — নতুন `adminUid = SxCwc5…` (আমার টেস্ট আইডি `wS5gF6…` ছিল, যা মুছে গেছে) | `08-page-state-*.txt` |
| 10:02–10:04 | পেজ এখন দেখায় *"setup is complete"*; `usernames/admin` নতুন একটি ইমেইলের দিকে পয়েন্ট করে (masked: `ad***@…`) | `08-page-state-b.txt` |
| 10:04 | পূর্বে দেওয়া অ্যাডমিন পাসওয়ার্ড আর কাজ করে না (`400 INVALID_LOGIN_CREDENTIALS`) | `08-page-state.console.txt` |

**সিদ্ধান্ত (আস্থা: সম্ভাব্য / high):** অডিটের ফাঁকে কেউ (সম্ভবত আপনি নিজেই) `setup.html` থেকে নতুন অ্যাডমিন অ্যাকাউন্ট তৈরি করেছেন — অর্থাৎ প্রথম-রান সেটআপ **সফলভাবে কাজ করেছে**। প্রতিষ্ঠান-বাহ্যিকভাবে *কে করেছেন* তা প্রমাণ করা যায় না (Audit কালেকশন অ্যাডমিন-সুরক্ষিত), তাই এটি "সম্ভাব্য" লেবেলে রাখা হলো। **এটি একটি positivo ফলাফল**: ফ্রেশ স্টার্ট কার্যকর হয়েছে এবং পেজ এখন সঠিকভাবে "সম্পূর্ণ" অবস্থা দেখাচ্ছে।

---

## ৮. ডিপ্লয়মেন্ট পাইপলাইন (ম্যাপড)

| ধাপ | প্রমাণ |
| --- | --- |
| সোর্স = GitHub repo `iamatiq7/nextgen-fund` (পাবলিক, branch `main`) | `git log`, `git remote -v` |
| CI = `.github/workflows/firebase-hosting.yml` — `push`/`workflow_dispatch`-এ চলে, `FirebaseExtended/action-hosting-deploy@v0`, `channelId: live` | workflow ফাইল |
| ক্রেডেনশিয়াল = GitHub Secret `FIREBASE_SERVICE_ACCOUNT_NEXTGEN_FUND_2040` (রিপোতে কমিট করা নেই) | workflow ফাইল |
| প্রকৃত রান | GitHub Actions API-তে `Deploy to Firebase Hosting` — `success`, head_sha = সর্বশেষ কমিট | Actions runs API |
| হোস্টিং ফাইলের সেট | `firebase.json`: `public: "."`, `ignore: [firebase.json, .firebaserc, **/.*, **/node_modules/**, docs/**, tests/**, *.md, ops/**]`, `rewrites: ** → /index.html` | `05-code-analysis.txt` |
| কনটেন্ট যাচাই | সার্ভ করা `setup.html` ও ১১টি অ্যাসেটের sha256 = repo-র HEAD-এর sha256 | `03-live-files-a.txt` |
| ডিপ্লয়ের টাইমস্ট্যাম্প | `last-modified: 2026-09-14 09:46:47 UTC` (সর্বশেষ push-এর সাথে সঙ্গতিপূর্ণ) | `04-http-detail-a.txt` |
| দ্বিতীয় হোস্ট | GitHub Pages — একই repo থেকে, টেক্সট হুবহু একই (sha256 match), কিন্তু আলাদা সার্ভিং স্ট্যাক (`server: GitHub.com`, `etag: W/"6aa7c284-5b5"`, `cache-control: max-age=600`, `access-control-allow-origin: *`) | `03-live-files-a.txt`, `04-http-detail-a.txt` |

**সতর্কতা:** একই কনটেন্ট দুই জায়গায় (Firebase Hosting + GitHub Pages) সার্ভ হচ্ছে। একটি বদলালে অন্যটি আলাদাভাবে আপডেট হয় — দুই URL-এর ক্যাশ/হেডার পার্থক্য তাই। কোনটি "অফিসিয়াল" ঠিক করুন এবং অন্যটি বন্ধ করা বা রিডাইরেক্ট করার কথা ভাবুন।

---

## ৯. যা যাচাই করা গেছে বনাম যা অনিশ্চিত

**যাচাই করা গেছে (নিশ্চিত):**
1. হোস্টিং = Firebase Hosting, প্রজেক্ট `nextgen-fund-2040` (হেডার + DNS + TLS + IP ownership)
2. `setup.html` HTTPS-এ সরাসরি `200`, কোনো রিডাইরেক্ট চেইন নেই; `http://` → `301` → `https://`
3. TLS = Google Trust Services, SAN `web.app`, TLSv1.3, ALPN `h2`, `h3` উপলব্ধ
4. এজ ক্যাশ থেকে সার্ভ হয়েছে, ক্যাশ নোড কোড **CCU (Kolkata)**, ক্যাশ `HIT`
5. সার্ভ করা ফাইলগুলো repo-র HEAD-এর সাথে বাইট-লেভেলে হুবহু (১২টি ফাইলের sha256)
6. পেজ স্ট্যাটিক; Firebase JS SDK v10.12.2 `www.gstatic.com` থেকে; Firestore `Listen/channel` পেজ লোডেই চালু
7. ফর্ম (তৈরি হলে) কোথায় সাবমিট হয়: Firebase Auth + Firestore — কোনো নিজস্ব API নয়
8. ভুল URL-এও `200` (SPA rewrite) — soft-404
9. ডিপ্লয় পাইপলাইন: repo → GitHub Actions → Hosting `live`
10. দ্বিতীয় origin (GitHub Pages) একই bytes সার্ভ করে

**অনিশ্চিত / পাওয়া যায়নি (স্পষ্ট লেবেলসহ):**
| বিষয় | অবস্থা | কেন |
| --- | --- | --- |
| Hosting origin-এর রিজিয়ন | **অনিশ্চিত** | Firebase Hosting হেডারে origin রিজিয়ন দেয় না। Firebase-এর ডিফল্ট সাধারণত `us-central1`, কিন্তু এটা যাচাই করা যায় না → অনুমান করব না |
| Firestore ডেটাবেসের লোকেশন (nam5/us-central1/asia-south1) | **অজানা** | শুধু console/Admin API-তে দেখা যায়; পাবলিক অনুরোধে মেলে না |
| CDN লেয়ার কে (Fastly বনাম Google-এর নিজস্ব) | **সম্ভাব্য** | `x-served-by`/`x-cache`/`x-timer` হেডার-পরিবার Fastly-ধাঁচের, এবং ঐতিহাসিকভাবে Firebase Hosting-এর ক্যাশ লেয়ার Fastly হিসেবে পরিচিত — কিন্তু Firebase/Google কখনো হেডারে সেটি নিশ্চিত করে না |
| কে, কখন নতুন অ্যাডমিন তৈরি করেছেন | **সম্ভাব্য** | Audit কালেকশন অ্যাডমিন-only; সেশন-প্রমাণ নেই |
| Storage ব্যবহৃত হচ্ছে কি না | **অজানা** | `storageBucket` কনফিগে আছে; ট্রেসে কোনো Storage অনুরোধ আসেনি (ডকুমেন্ট আপলোড না হওয়া পর্যন্ত হবে না) |
| `iamatiq7.github.io` কোথা থেকে সার্ভ হয় (edge) | **অংশত** | NS1 DNS + `185.199.109.153` (GitHub Pages), কিন্তু edge নোড-কোড প্রকাশ পায় না |

---

## ১০. পুনরুৎপাদনের ধাপ (যে কেউ মিলিয়ে দেখতে পারবে)

```powershell
# ১) DNS + IP মালিকানা
Resolve-DnsName nextgen-fund-2040.web.app -Type A     # 199.36.158.100
Resolve-DnsName nextgen-fund-2040.web.app -Type AAAA  # 2620:0:890::100
Resolve-DnsName web.app -Type SOA                     # ns1.googledomains.com
Invoke-RestMethod "https://rdap.arin.net/registry/ip/199.36.158.100"   # name: GOOGLE

# ২) হেডার + রিডাইরেক্ট চেইন (curl -L -w)  [এই মেশিনে curl.exe পুরোনো; -I/-D ব্যবহার করুন]
curl.exe -sS -D - -o NUL https://nextgen-fund-2040.web.app/setup.html
curl.exe -sS -o NUL -L -w "final=%{url_effective} code=%{http_code} redirects=%{num_redirects} ip=%{remote_ip}" https://nextgen-fund-2040.web.app/setup.html

# ৩) TLS সার্টিফিকেট
node .openclaw/tmp/hosting/tls-dump.mjs manual nextgen-fund-2040.web.app iamatiq7.github.io

# ৪) সার্ভ করা ফাইল বনাম repo (বাইট-লেভেল)
node .openclaw/tmp/hosting/fetch-live.mjs manual

# ৫) রিয়েল ব্রাউজার নেটওয়ার্ক ট্রেস + পেজ অবস্থা (হেডলেস Chromium + CDP)
node .openclaw/tmp/hosting/cdp-trace.mjs manual
node .openclaw/tmp/hosting/cdp-eval.mjs manual
```

উপরের স্ক্রিপ্টগুলো `docs/hosting-audit/`-এর সাথে দেওয়া আছে (`tools` ফোল্ডার), অথবা রিপো ফোল্ডারে রাখা স্ক্রিপ্ট ব্যবহার করুন। প্রতিটি স্ক্রিপ্টের আউটপুট যুক্তি অনুসারে `evidence/`-এ ফাইল করে সেভ হয়।

---

## ১১. ঝুঁকি, সীমাবদ্ধতা ও হস্তান্তর চেকলিস্ট

### ঝুঁকি ও পরামর্শ
| # | পর্যবেক্ষণ | ঝুঁকি | সুপারিশ |
| --- | --- | --- | --- |
| 1 | একই কনটেন্ট দুই হোস্টে (Firebase + GitHub Pages) | বিভ্রান্তি, দুটো ক্যাশ, SEO বিভ্রান্তি, ভুল URL শেয়ার | একটি অফিসিয়াল হোস্ট ঠিক করুন; অন্যটি বন্ধ বা রিডাইরেক্ট করুন |
| 2 | Soft-404 (সব পাথে `200`) | মনিটরিং/SEO-তে ভুল সিগন্যাল; ভাঙা লিংক ধরা পড়ে না | `firebase.json`-এ ৪০৪ কনফিগ অথবা rewrite সীমিত করুন |
| 3 | GitHub Secret `FIREBASE_SERVICE_ACCOUNT_NEXTGEN_FUND_2040` একটি প্রশাসনিক কী | ফাঁস হলে পুরো প্রজেক্টে অ্যাডমিন প্রবেশ | কখনো শেয়ার না করলে ঠিক আছে; সন্দেহ হলে console → Service accounts-এ key rotate করুন |
| 4 | repo পাবলিক | সোর্স ও পাবলিক কনফিগ সবাই দেখতে পারে | গোপন তথ্য কখনো কমিট করবেন না (এখন নেই) |
| 5 | Firestore rules ডিফল্ট-ডিনাই | — (ভালো) | anonymous পড়া `403` — এটাই কাঙ্ক্ষিত; ঢিলা করবেন না |
| 6 | Firestore লোকেশন অজানা | কমপ্লায়েন্স/লেটেন্সি সিদ্ধান্তের জন্য দরকার হতে পারে | console → Firestore → Location দেখে নোট করুন |
| 7 | ডেটা Google-এর ম্যানেজড সার্ভিসে | তৃতীয় পক্ষ নির্ভরতা (Google Cloud) | ব্যাকআপ/এক্সপোর্ট নীতি রাখুন (আগের সেশনে ব্যাকআপ টুলিং আছে) |

### হস্তান্তর চেকলিস্ট (কে কী করবে)
- [ ] **মালিক:** Firebase console-এ Firestore-এর Location নোট করুন (রিপোর্টে "অজানা" অংশটি পূরণ হবে)
- [ ] **মালিক:** কোন হোস্টটি অফিসিয়াল (Firebase `web.app` নাকি GitHub Pages) সিদ্ধান্ত নিন
- [ ] **মালিক:** service-account key rotate করবেন কি না ঠিক করুন
- [ ] **অপারেটর:** ডিপ্লয়ের পর যাচাই করুন — `last-modified` বদলেছে কি, `x-served-by` নোড কোনটি
- [ ] **যে কেউ:** নিচের "পুনরুৎপাদনের ধাপ" চালিয়ে ফল মিলিয়ে নিন; না মিললে প্রমাণ ফাইলসহ জানান

### কখন আবার যাচাই করতে হবে (তথ্য পুরোনো হওয়ার নিয়ম)
- ডিপ্লয়ের পর (`last-modified` বদলালে) — ফাইল হ্যাশ মিলিয়ে নিন
- TLS মেয়াদ শেষ হওয়ার ~৭ দিন আগে (২০২৬-১০-১৮ Firebase / ২০২৬-১০-৩১ Pages) — অটো-রিনিউ হয় কি না দেখুন
- হোস্টিং প্রোভাইডার/Billing বা GitHub Secrets বদলালে
- নতুন কাস্টম ডোমেইন যুক্ত হলে (DNS A/CNAME/TXT সব নতুন করে যাচাই করতে হবে)

### রোলব্যাক (এই অডিট কিছু বদলায়নি — তাই রোলব্যাক = কিছু করার নেই)
অডিট চলাকালে কোনো কনফিগ, DNS, কোড বা ডেটা বদলানো হয়নি; শুধু পড়া হয়েছে। তবু ভবিষ্যতের জন্য:
```powershell
# হোস্টিং কনটেন্ট আগের ভার্সনে ফিরিয়ে নেওয়া (ডিপ্লয় রোলব্যাক)
firebase hosting:rollback --project nextgen-fund-2040      # CLI থাকলে
# অথবা: Firebase console → Hosting → Release history → একটি পুরোনো ভার্সনে "Rollback"
# অথবা: GitHub-এ আগের কমিটে revert করে push → CI আবার ডিপ্লয় করবে
git revert <commit> ; git push origin main
# Firestore ডেটা ফেরানো (ব্যাকআপ থাকলে)
node tools/db-reset.mjs --restore --from <backup>.json
```

---

## ১২. প্রমাণ ফাইল সূচি

| ফাইল | কী আছে |
| --- | --- |
| `evidence/01-dns-http-headers.txt` | DNS (A/AAAA/CNAME/NS/TXT/SOA) প্রতিটি হোস্টের, RDAP মালিকানা, curl হেডার ডাম্প, ৪০৪-প্রোব |
| `evidence/02-tls-run-a.txt`, `02-tls-run-b.txt` | TLS হ্যান্ডশেক, সার্টিফিকেট চেইন, মেয়াদ, ALPN (দুইবার মাপা) |
| `evidence/03-live-files-a.txt`, `03-live-files-b.txt` | সার্ভ করা ১২টি ফাইলের স্ট্যাটাস/হেডার/sha256 বনাম repo |
| `evidence/04-http-detail-a.txt`, `04-http-detail-b.txt` | রিকোয়েস্ট/রিডাইরেক্ট চেইন, হেডার সেট, soft-404, ALPN |
| `evidence/05-code-analysis.txt` | পেজ ও JS-এর স্ট্যাটিক বিশ্লেষণ: হোস্ট, কালেকশন, ফর্ম ফিল্ড, `setupAdmin` কোড, ডিপ্লয় কনফিগ |
| `evidence/06-browser-network-trace-a.txt` | রিয়েল ব্রাউজারের ১৯টি নেটওয়ার্ক রিকোয়েস্ট + IP + পেজের রেন্ডারড টেক্সট |
| `evidence/07-rendered-dom.txt` | হেডলেস Chromium-এর DOM ডাম্প (প্রাথমিক) |
| `evidence/08-page-state-a.txt`, `08-page-state-b.txt` | পেজের ভেতরে অ্যাপের নিজের ফাংশন চালিয়ে 상태 যাচাই (mode, `adminExists()`, form সংখ্যা, IndexedDB) |
| `evidence/admin-scope/` | অ্যাডমিন ক্রেডেনশিয়ালে পড়া স্ন্যাপশট (PII আছে — এই ফোল্ডার পাবলিক রিপোতে **রাখা হয়নি**) |

> **Reproducibility নোট:** প্রতিটি ফাইলে টাইমস্ট্যাম্প আছে। রিপোর্টের প্রতিটি সংখ্যা সংশ্লিষ্ট ফাইল থেকে নেওয়া; কোনো দাবি প্রমাণ ছাড়া নেই। দুইবার চালিয়ে (run `a` ও `b`) হোস্ট, IP, TLS চেইন, ক্যাশ নোড কোড একই এসেছে — অর্থাৎ ফল পুনরুৎপাদনযোগ্য।
