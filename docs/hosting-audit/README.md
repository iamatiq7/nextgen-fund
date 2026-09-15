# hosting-audit — `nextgen-fund-2040.web.app/setup.html` কোথায় রান করে?

**প্রশ্ন:** `https://nextgen-fund-2040.web.app/setup.html` আসলে কোথায় হোস্ট ও রান হচ্ছে?
**সংক্ষিপ্ত উত্তর:** Firebase Hosting (Google), প্রজেক্ট `nextgen-fund-2040`; পেজটি সম্পূর্ণ **স্ট্যাটিক**, Google-এর এজ ক্যাশ (আমাদের পরিমাপে নোড **CCU = Kolkata**) থেকে সার্ভ হয়; কোনো সার্ভার-সাইড রানটাইম নেই — ব্যাকএন্ড হলো Firebase **Authentication** ও **Cloud Firestore**।

## এই ফোল্ডারে কী আছে

| ফাইল | কী |
| --- | --- |
| [`nextgen-fund-where-it-runs.md`](nextgen-fund-where-it-runs.md) | পূর্ণ রিপোর্ট (Markdown) — সব প্রমাণ, সিদ্ধান্তের আস্থার মাত্রা, পুনরুৎপাদনের ধাপ, ঝুঁকি ও হস্তান্তর চেকলিস্ট |
| [`nextgen-fund-where-it-runs.html`](nextgen-fund-where-it-runs.html) | একই রিপোর্টের ডিজাইন করা সংস্করণ (প্রিসেট **11 Build**: warm-white ground, একটি copper accent, soft shadow, inline SVG আর্কিটেকচার ডায়াগ্রাম) |
| [`evidence/`](evidence/) | কাঁচা প্রমাণ — DNS, HTTP হেডার, TLS চেইন, ফাইল হ্যাশ, ব্রাউজার নেটওয়ার্ক ট্রেস, পেজ স্টেট |
| [`tools/`](tools/) | যাচাইয়ের স্ক্রিপ্ট — যে কেউ চালিয়ে ফল মিলিয়ে দেখতে পারবে |

## দ্রুত উত্তর (৫ সেকেন্ডে)

- **হোস্টিং:** Firebase Hosting (Google) — প্রমাণ: `vary: x-fh-requested-host`, `web.app` জোনের SOA `ns1.googledomains.com`, TLS ইস্যুয়ার Google Trust Services, IP `199.36.158.100` RDAP-এ GOOGLE
- **এজ:** `x-served-by: cache-ccu830031-CCU` → কলকাতা ক্যাশ নোড, `x-cache: HIT`
- **স্ট্যাটিক কি না:** হ্যাঁ — সার্ভ করা `setup.html` ও ১১টি অ্যাসেট repo-র HEAD-এর সাথে বাইট-লেবেলে হুবহু (sha256)
- **ডেটা কোথায়:** Firebase Auth (`identitytoolkit.googleapis.com`) + Cloud Firestore (`firestore.googleapis.com`), প্রজেক্ট `nextgen-fund-2040` — রিয়েল ব্রাউজার ট্রেসে দেখা গেছে
- **ডিপ্লয়:** GitHub repo → GitHub Actions (`firebase-hosting.yml`) → Hosting `live`; একই কনটেন্ট GitHub Pages-ও সার্ভ করে
- **যা জানা যায়নি:** Hosting origin রিজিয়ন, Firestore ডেটাবেসের লোকেশন (দুটোই পাবলিক অনুরোধে মেলে না — রিপোর্টে "অনিশ্চিত/অজানা" লেবেল দেওয়া)

## যাচাই কীভাবে করবেন

```powershell
# DNS + মালিকানা
Resolve-DnsName nextgen-fund-2040.web.app -Type A          # 199.36.158.100
Invoke-RestMethod "https://rdap.arin.net/registry/ip/199.36.158.100"   # name: GOOGLE

# হেডার
curl.exe -sS -D - -o NUL https://nextgen-fund-2040.web.app/setup.html

# স্ক্রিপ্ট (এই ফোল্ডারের tools/ থেকে)
node tools/tls-dump.mjs manual nextgen-fund-2040.web.app iamatiq7.github.io
node tools/fetch-live.mjs manual          # সার্ভ করা ফাইল বনাম repo (বাইট-লেবেলে)
node tools/http-detail.mjs manual         # রিডাইরেক্ট চেইন, soft-404, ALPN
node tools/cdp-trace.mjs manual           # হেডলেস Chrome-এ প্রকৃত রিয়েল নেটওয়ার্ক ট্রেস
node tools/cdp-eval.mjs manual            # পেজের ভিতরে অ্যাপের নিজের অবস্থা যাচাই
node tools/analyze-code.mjs               # পেজ/JS স্ট্যাটিক বিশ্লেষণ
```

স্ক্রিপ্টগুলোর কিছু আউটপুট পাথ নিজে ঠিক করতে হয় (`EVIDENCE_DIR`, `REPO_DIR` env দিয়ে)। প্রতিটি আউটপুট টাইমস্ট্যাম্পসহ ফাইল করে রাখা হয়, যাতে অন্য কেউ হুবহু মিলিয়ে দেখতে পারে।

## সীমাবদ্ধতা (সৎভাবে)

- শুধু **পাবলিক** তথ্য দেখা হয়েছে: HTTP হেডার, DNS রেকর্ড, TLS সার্টিফিকেট, সার্ভ করা স্ট্যাটিক ফাইল, এবং একটি হেডলেস ব্রাউজারে পেজ লোড।
- **কোনো লগইন ব্রুট-ফোর্স, স্ক্যানিং, অনুপ্রবেশের চেষ্টা বা সুরক্ষিত অংশে প্রবেশ করা হয়নি**; সাইটের কোড/DNS/হোস্টিং কনফিগে হাত দেওয়া হয়নি।
- যা পাবলিকভাবে পাওয়া যায় না (origin রিজিয়ন, DB লোকেশন, ব্যক্তিগত কনফিগ) তা অনুমান করে বলা হয়নি — শুধু "অজানা/অনিশ্চিত" লেবেল।
- এটি কোনো ফরেনসিক অ্যাট্রিবিউশন বা আইনি প্রমাণ-তৈরি নয়; এটি একটি প্রযুক্তিগত "কোথায় চলছে" অনুসন্ধান।
