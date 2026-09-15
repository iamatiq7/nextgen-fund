# `web.app` ব্যবহার করা কি ঠিক? — সিদ্ধান্ত ডকুমেন্ট

**প্রজেক্ট:** `nextgen-fund-2040` (Firebase Hosting) · **তারিখ:** 2026-09-14 · **উৎস সংগ্রহ:** 2026-09-14
**প্রস্তুতকারী:** ATIQ.V2 · **দর্শক:** প্রজেক্ট মালিক / টিম / ক্লায়েন্ট
**পদ্ধতি:** অফিসিয়াল Firebase/Google Cloud ডকুমেন্ট ও SLA + আমাদের নিজের প্রজেক্টের live পরিমাপ + হাতে-কলমে টেস্ট (emulator test project)। কোনো নিশ্চয়তা বা আইনি ব্যাখ্যা নয় — শুধু যাচাইযোগ্য তথ্য ও ঝুঁকি।
**প্রমাণ ফোল্ডার:** `docs/firebase-webapp-decision/evidence/` — প্রতিটি দাবির পাশে ফাইল/লিংক।

---

## ০. তিন প্রশ্নের সোজা উত্তর

### প্রশ্ন ১ — `web.app` ব্যবহারে চ্যালেঞ্জ আছে কি? → **হ্যাঁ, আছে — কিন্তু এগুলো blocker নয়**
`web.app` একটি **কাজ করা, ফ্রি, অটো-SSL, গ্লোবাল CDN** ডোমেইন। প্রযুক্তিগত কোনো বাধা নেই। চ্যালেঞ্জগুলো মূলত **ব্র্যান্ডিং, SEO, শেয়ারযোগ্যতা এবং ভবিষ্যতের মাইগ্রেশন** সংক্রান্ত (§২-এ ১২টি পয়েন্ট)।
**সুপারিশ:** এখন `web.app`-এ থাকা ঠিক আছে; শেয়ার/টেস্ট/পরীক্ষার জন্য সমস্যা নেই। যখন এটি "পরিচয়" হয়ে যাবে (ক্লায়েন্ট, সদস্যরা নিয়মিত ব্যবহার করবেন), তখন কাস্টম ডোমেইনে যান — §৮-এ ৩০ মিনিটের প্ল্যান আছে, এবং migration-এ পুরোনো লিংক ভাঙবে না।

### প্রশ্ন ২ — এটা কি সবসময় লাইভ থাকবে, ডাউন হওয়ার সুযোগ নেই? → **না। "কখনো ডাউন হবে না" — এই নিশ্চয়তা কেউ দিতে পারে না, Google-ও দেয় না।**
- Firebase-এর SLA **৯৯.৯৫%** (Hosting) — অর্থাৎ মাসে সর্বোচ্চ **~২১.৯ মিনিট** অনুমোদিত downtime [`firebase.google.com/terms/service-level-agreement`, 2026-09-14]
- Firestore multi-region **৯৯.৯৯৯%** (~২৬ সেকেন্ড/মাস), regional **৯৯.৯৯%** [`cloud.google.com/firestore/sla`]
- SLA মানে **credit পাওয়ার প্রতিশ্রুতি**, "ডাউন হবে না" নয়।
- বাস্তব পরিমাপ: গত **৪২৩ দিনে** Firebase-এর প্রকাশিত incident ফিডে ৪৮টি incident — এর মধ্যে **Hosting ৩টি, Firestore ০, Authentication ০** [`status.firebase.google.com/incidents.json`, 2026-09-14] (§৩-এ বিস্তারিত)।
- **সবচেয়ে বড় ঝুঁকি Google নয় — আপনার নিজের ভুল:** ভুল ডিপ্লয়, security rules ভুল, কোটা শেষ (Spark), বিলিং সমস্যা, DNS/ডোমেইন ভুল। §৪-এ ৯টি দৃশ্যপট + প্রশমন আছে।
**সংক্ষেপে:** "প্রায় সবসময় লাইভ, তবে ১০০% নয়" — এবং downtime হলে সেটি বেশিরভাগ ক্ষেত্রে নিজের কাজের কারণে, কয়েক মিনিটের মধ্যে ঠিক করা যায়।

### প্রশ্ন ৩ — আমার ডেটা কি নিরাপদ থাকবে? → **শর্তসহ হ্যাঁ।**
- ট্রানজিটে এনক্রিপশন: আমাদের live সাইটে **TLS 1.3** (`nextgen-fund-2040.web.app`, পরিমাপ 2026-09-14)
- রেস্টে এনক্রিপশন: Firestore **স্বয়ংক্রিয়ভাবে** সব ডেটা এনক্রিপ্ট করে (কনফিগ লাগে না); চাইলে নিজের KMS key (CMEK) [`docs.cloud.google.com/firestore/native/docs/server-side-encryption`; `firebase.google.com/docs/firestore/cmek`]
- অ্যাক্সেস: আপনার rules **ডিফল্ট-ডিনাই** — আমরা ৩১টি টেস্ট চালিয়ে যাচাই করেছি: anonymous কেউ `users/payments/registrations/audit` পড়তে বা লিস্ট করতে পারে না, সদস্য অন্যের ডেটা দেখতে পারে না, নিজেকে অ্যাডমিন বানাতে বা পেমেন্ট approve করতে পারে না। **৩১/৩১ PASS** (`evidence/01-data-safety-rules.txt`)
- live প্রজেক্টেও একই: anonymous অনুরোধে `403 PERMISSION_DENIED` (`evidence/04-live-rules-probe.txt`)
**কিন্তু:** নিরাপত্তা নির্ভর করে আপনি rules ভুল না লেখার, `settings/public` / `usernames/{name}`-এর মতো **ইচ্ছাকৃতভাবে পাবলিক** ফিল্ডে ব্যক্তিগত তথ্য না রাখার, Storage rules আলাদা করে লেখার, আর নিয়মিত backup/restore করার উপর। §৫-এ ৮ পয়েন্টের চেকলিস্ট — কোনটা যাচাই করা হয়েছে এবং কোনটা আপনার করতে হবে, তা লেখা আছে।

---

## ১. যা যাচাই করা হয়েছে (এবং কীভাবে)

| যাচাই | পদ্ধতি | ফল | প্রমাণ |
| --- | --- | --- | --- |
| হোস্টিং প্ল্যাটফর্ম/এজ | DNS + HTTP হেডার + TLS + হেডলেস ব্রাউজার | Firebase Hosting, এজ নোড CCU=Kolkata | `evidence/06-hosting-audit-summary.txt` |
| Security rules (কে কী করতে পারে) | emulator test project-এ ৩১টি হাতে-কলমে টেস্ট | **৩১/৩১ PASS** | `evidence/01-data-safety-rules.txt` |
| live rules বাস্তবে কার্যকর | live প্রজেক্টে unauthenticated অনুরোধ | users/payments/registrations/audit/settings → **403** | `evidence/04-live-rules-probe.txt` |
| Backup → wipe → restore | emulator test project-এ বাস্তব drill, সময় মাপা | **৭৭/৭৭ ডকুমেন্ট হুবহু ফিরে এসেছে**; backup ১৭১ms, wipe ৬১৩ms, restore ২৭৯ms | `evidence/02-restore-drill.txt` |
| ঊর্ধ্বমুখী/ডাউনটাইম ইতিহাস | অফিসিয়াল incident ফিড বিশ্লেষণ (৪৮ রেকর্ড, ৪২৩ দিন) | Hosting ৩, Firestore ০, Auth ০ | `evidence/05-firebase-incident-history.txt` |
| SLA সংখ্যা | অফিসিয়াল SLA পেজ | Hosting ৯৯.৯৫%, Firestore multi-region ৯৯.৯৯৯% | `evidence/07-sources.txt` |
| AWS কোটা/সীমা | অফিসিয়াল pricing/quota পেজ | ২ GB/file, ১০ GB storage, Spark: ৩৬০ MB/day transfer, Firestore ৫০k reads/day | `evidence/07-sources.txt` |

---

## ২. `web.app` ডোমেইন: সুবিধা, অসুবিধা ও বাস্তব প্রভাব

### সুবিধা
| # | সুবিধা | বাস্তব প্রভাব |
| --- | --- | --- |
| ১ | সম্পূর্ণ ফ্রি, কোনো ডোমেইন কেনা লাগে না | আগে থেকেই কাজ করছে; ০ টাকা, ০ মিনিট সেটআপ |
| ২ | অটো-ম্যানেজড SSL | নবায়ন ভাবতে হয় না (আমাদের সাইটে Google Trust Services, মেয়াদ ২০২৬-১০-১৮, অটো-রিনিউ) |
| ৩ | গ্লোবাল CDN + এজ ক্যাশ | ঢাকা থেকে কলকাতা এজ (CCU) থেকে সার্ভ, `x-cache: HIT` |
| ৪ | দুটি হোস্টনেম | `nextgen-fund-2040.web.app` ও `nextgen-fund-2040.firebaseapp.com` — দুটোই কাজ করে |
| ৫ | Preview channel | ডিপ্লয় করার আগে টেস্ট লিংক (`channelId`), live লিংক আলাদা |
| ৬ | rollback | এক ক্লিকে আগের release-এ ফেরা (§৭) |

### চ্যালেঞ্জ / সীমাবদ্ধতা
| # | চ্যালেঞ্জ | বাস্তব প্রভাব ও করণীয় |
| --- | --- | --- |
| ১ | **ডোমেইনটি Google-এর, আপনার নয়** | `*.web.app` যেকোনো Firebase প্রজেক্ট নিতে পারে; আপনার "ব্র্যান্ড" নয়। ভবিষ্যতে প্রজেক্ট আইডি বদলানো যাবে না → ব্র্যান্ড ঠিক করার সময় কাস্টম ডোমেইন নিন |
| ২ | ব্র্যান্ডিং দুর্বল | ইমেইল/লিফলেট/সাইনবোর্ডে `kazi-savings-farmers.web.app` লেখা অদ্ভুত দেখায়; ফন্টে বলা কঠিন |
| ৩ | SEO | Google নিজের ব্র্যান্ডেড ডোমেইনকে বেশি ওজন দেয়; `web.app` সাবডোমেইন হিসেবে র‍্যাংক করা কঠিন। অভ্যন্তরীণ ফ্যামিলি ফান্ডে SEO গুরুত্বপূর্ণ নয় — পাবলিক প্রোডাক্টে গুরুত্বপূর্ণ |
| ৪ | শেয়ারযোগ্যতা | লিংক লম্বা ও "প্রজেক্ট আইডি" ধাঁচের (`nextgen-fund-2040.web.app`) → SMS/কাগজে বলা কষ্ট |
| ৫ | **Auth domain ≠ আপনার ডোমেইন** | অ্যাপের `authDomain: nextgen-fund-2040.firebaseapp.com`; OAuth/ম্যাজিক-লিংক স্ক্রিনে এই ডোমেইন দেখায় → ব্যবহারকারীর কাছে "ট্রাস্ট" প্রশ্ন ওঠে |
| ৬ | লিংক স্থায়িত্ব | প্রজেক্ট আইডি বদলালে/প্রজেক্ট মুছলে লিংক মরে যায়; কাস্টম ডোমেইন হলে শুধু DNS বদলাতে হয় |
| ৭ | ৩য় পক্ষের লিস্ট/ব্লক | কিছু ফায়ারওয়াল/স্কুল-নেটওয়ার্ক `*.web.app`-কে ব্লক করে বা সন্দেহ করে (আমাদের মাপে ব্লক হয়নি, তবে সম্ভাবনা থাকে) |
| ৮ | কুকি/সেশন স্কোপ | `web.app` ডোমেইনে কুকি শেয়ার হয় না আপনার অন্য সাবডোমেইনের সাথে |
| ৯ | `firebaseapp.com` বিভ্রান্তি | দুটি ভিন্ন লিংক একই সাইট → দুটো ক্যাশ, দুটো URL শেয়ার; build-time-এ canonical ঠিক রাখতে হবে |
| ১০ | **একই কনটেন্ট দুই হোস্টে** (আমাদের ক্ষেত্রে) | Firebase Hosting + GitHub Pages দুটোই সার্ভ করছে → শেয়ার/SEO/মনিটরিংয়ে বিভ্রান্তি; একটি অফিসিয়াল ঠিক করুন |
| ১১ | কোটা প্রজেক্ট-লেভেলে | Spark plan-এ ৩৬০ MB/day egress; TikTok-এ ভাইরাল হলে অথবা বড় ছবি/backup ডাউনলোড হলে কোটা শেষ হয়ে সাইট বন্ধ হতে পারে |
| ১২ | দীর্ঘমেয়াদি নির্ভরতা | Google-এর শর্ত/মূল্য বদলাতে পারে (আপনি নিয়ন্ত্রণ করেন না) — নিয়মিত চোখ রাখা দরকার |

**উপসংহার:** `web.app` একটি **অস্থায়ী/পরীক্ষামূলক বা অভ্যন্তরীণ ব্যবহারের জন্য চমৎকার**; **ক্লায়েন্ট-মুখী ব্র্যান্ডেড অ্যাপের জন্য কাস্টম ডোমেইন নিন**। দুইটাই একসাথে চালানো যায়, তাই মাইগ্রেশন ঝুঁকিহীন।

---

## ৩. আপটাইম: SLA-ভিত্তিক সংখ্যা ও প্রকৃত incident ইতিহাস

### ৩.১ চুক্তিবদ্ধ সংখ্যা (SLA)
| সেবা | SLA | মাসে অনুমোদিত সর্বোচ্চ downtime | উৎস (সংগ্রহ ২০২৬-০৯-১৪) |
| --- | --- | --- | --- |
| Firebase Hosting | **৯৯.৯৫%** | **২১.৯ মিনিট** | `firebase.google.com/terms/service-level-agreement` |
| Realtime Database | ৯৯.৯৫% | ২১.৯ মিনিট | একই SLA পেজ |
| Cloud Firestore (multi-region) | **৯৯.৯৯৯%** | ~২৬ সেকেন্ড | `cloud.google.com/firestore/sla` |
| Cloud Firestore (regional) | ৯৯.৯৯% | ~৪.৩ মিনিট | `cloud.google.com/firestore/sla` |
| Cloud Storage for Firebase | আলাদা SLA | — | `firebase.google.com/terms/service-level-agreement/cloud-storage` |

**SLA-তে কী আছে:** মাসিক uptime কম হলে **বিলিং credit**। এটা "ডাউন হবে না" বলে না; সাইট ডাউন হলে Google দায় নেয় না, শুধু credit দেয়।

### ৩.২ প্রকৃত incident ইতিহাস (৪২৩ দিন)
`status.firebase.google.com/incidents.json` — ৪৮টি প্রকাশিত incident, সময়সীমা **২০২৫-০৭-১৮ → ২০২৬-০৯-১০**।

| সেবা | Published incidents |
| --- | --- |
| Test Lab | ১২ |
| App Hosting | ৬ |
| Cloud Messaging | ৫ |
| Crashlytics | ৪ |
| **Hosting** | **৩** |
| Multiple Products | ৩ |
| Realtime Database | ২ |
| **Firestore** | **০** |
| **Authentication** | **০** |

Hosting-এর ৩টি incident-এর ধরন (নিচে উল্লেখ করা হলো কারণ এগুলোই আপনার সাথে সবচেয়ে বেশি প্রাসঙ্গিক):
- `2026-07-30` — Firebase Hosting **custom domains API** 501 error (৮০০ মিনিট) → *API/ডোমেইন কনফিগ সমস্যা, সাইট সার্ভ করা বন্ধ হয়নি*
- `2026-03-23` — Hosting-এর **Cloud Logging-এ metrics/logs অনুপস্থিত** (১০,৯০৪ মিনিট) → *মনিটরিং অন্ধ, সাইট আপ*
- `2026-03-10` — Firebase **Studio App Hosting** deployment disruption (২৯,৫৮৯ মিনিট) → *App Hosting, স্ট্যাটিক Hosting নয়*

**সৎ সীমাবদ্ধতা:** (ক) এটি প্রকাশিত incident-এর ফিড — Google যেগুলো প্রকাশযোগ্য মনে করেছে; ছোট/কম-প্রভাবিত degradation বাদ পড়ে। (খ) incident-এর সময়সীমা (start→end) সাধারণত ক্ষতির চেয়ে বড়; তাই ওই মিনিটগুলোকে "এন্ড-ইউজারের downtime" ধরলে uptime কম দেখাবে। (গ) ৪৮টি রেকর্ড পুরো ইতিহাস নয়। এগুলো মিলিয়ে **উপসংহার: এই উইন্ডোতে আপনার সাইটের CDN-সার্ভিং পথ কখনো ব্যাপকভাবে বন্ধ হওয়ার প্রকাশিত প্রমাণ নেই — কিন্তু "হতেই পারে না" বলা যায় না।**

---

## ৪. ডাউনটাইম ঝুঁকি ম্যাট্রিক্স

প্রতিটি সারিতে: **সম্ভাবনা · প্রভাব · আগে থেকে লক্ষণ · ব্যবহারকারী কী দেখবে · করণীয়**।

| # | দৃশ্যপট | সম্ভাবনা | প্রভাব | আগে থেকে লক্ষণ | ব্যবহারকারী কী দেখবে | করণীয় (কেউ ± মিনিট) |
| --- | --- | --- | --- | --- | --- | --- |
| ১ | **নিজের ভুল ডিপ্লয়** (ভাঙা build, ভুল ফাইল) | **উচ্চ** | মাঝারি–উচ্চ | CI লাল; সাইট ওপেন করে পরীক্ষা | সাদা পাতা, ভাঙা UI, পুরোনো/নতুন মিশ্রণ | সাথে সাথে rollback (§৭.৪) — ৫ মিনিটে ঠিক হয় |
| ২ | **Spark কোটা শেষ** (Hosting ৩৬০ MB/day, Firestore ৫০k reads/day) | মাঝারি | **উচ্চ** | Console-এ usage বার, কোটা অ্যালার্ট, `quota exceeded` লগ | পেজ লোড হবে না / ডেটা দেখা যাবে না, পরদিন পর্যন্ত | Blaze-এ যান (§৬), অথবা ট্রাফিক কমিয়ে দিন |
| ৩ | **বিলিং সাসপেনশন** (কোটা/বিলিং সমস্যা, কার্ড ব্যর্থ) | নিম্ন | **উচ্চ** | বাজেট অ্যালার্ট ইমেইল, billing state সতর্কতা | সম্পূর্ণ সাইট/ডেটা বন্ধ | budget alert + programmatic disable (§৬); billing ঠিক করে পুনরায় চালু |
| ৪ | **রিজিওনাল আউটেজ** (Firestore/GCP) | নিম্ন | উচ্চ | status page ইমেইল, aumento HARD, monitor ব্যর্থ | লগইন/ডেটা স্লো বা ব্যর্থ, সাইট খোলে তবে খালি | status page দেখে অপেক্ষা; multi-region ব্যবহার; গুরুত্বপূর্ণ সময়ে backup |
| ৫ | **ডোমেইন/DNS সমস্যা** (কাস্টম ডোমেইনে যাওয়ার পর) | মাঝারি (কাস্টম ডোমেইনে) | উচ্চ | DNS प्रचार, TXT verify ব্যর্থ, SSL pending | "Site not found", সার্টিফিকেট সতর্কতা | DNS রেকর্ড মিলিয়ে නැවත verify; ওয়েব.app চালু রাখুন (fallback) |
| ৬ | **SSL মেয়াদ/error** | **খুব নিম্ন** | উচ্চ | console-এ SSL স্টেটাস, ব্রাউজার সতর্কতা | "Not secure" warning | অটো-রিনিউ হয়; console-এ status চেক |
| ৭ | **Security rules ভুল** (ডেটা দেখা যাচ্ছে/লিখা যাচ্ছে না) | মাঝারি | উচ্চ | emulator টেস্টে ধরা পড়ে; ব্যবহারকারী রিপোর্ট | "Permission denied" / ডেটা দেখা যাচ্ছে না | rules rollback (git revert + redeploy); emulator টেস্ট বাধ্যতামূলক |
| ৮ | **প্রজেক্ট মুছে ফেলা/suspend** | খুব নিম্ন | **সর্বোচ্চ** | — | সবকিছু 404, ডেটা নেই | মালিক অ্যাকাউন্টে 2FA; প্রজেক্ট delete করতে ২টি ধাপ লাগে; backup থাকলে restore (§৫.৭) |
| ৯ | **নিজের কোডে বাগ (ডেটা নষ্ট/ভুল হিসাব)** | মাঝারি | মাঝারি | ব্যবহারকারীর অভিযোগ, audit লগ অসঙ্গতি | ভুল ব্যালান্স/তালিকা | daily backup থাকা বাধ্যতামূলক; restore drill (§৫.৭) |

> **সিদ্ধান্ত:** সবচেয়ে বড় ঝুঁকি #১, #২, #৩ — এবং এগুলো **সম্পূর্ণ আপনার নিয়ন্ত্রণে**। তাই "সাইট ডাউন হবে কি না" প্রশ্নের প্রকৃত উত্তর: *Google-এর পক্ষ থেকে প্রায় কখনো নয়; নিজের প্রক্রিয়া খারাপ থাকলে হ্যাঁ।*

---

## ৫. ডেটা সেফটি চেকলিস্ট

| # | প্রশ্ন | অবস্থা | প্রমাণ / করণীয় |
| --- | --- | --- | --- |
| ১ | ডেটা কোথায় সংরক্ষিত? | Firestore (Native) + Auth + Storage, একই GCP প্রজেক্ট `nextgen-fund-2040`, Google-এর ডেটাসেন্টারে | `evidence/06-hosting-audit-summary.txt`; লোকেশন console-এ দেখুন |
| ২ | ট্রানজিটে এনক্রিপশন? | **হ্যাঁ** — TLS 1.3 (আমাদের পরিমাপে `TLS_AES_128_GCM_SHA256`, HSTS preload) | `evidence/06-...` (TLS রান) |
| ৩ | রেস্টে এনক্রিপশন? | **হ্যাঁ, ডিফল্টে** — Firestore সব ডেটা লেখার আগে এনক্রিপ্ট করে, কনফিগ লাগে না; extra control চাইলে CMEK | `docs.cloud.google.com/firestore/native/docs/server-side-encryption`; `firebase.google.com/docs/firestore/cmek` |
| ৪ | কে কোন ডেটা পড়তে/লিখতে পারে? | **যাচাই করা (৩১/৩১ PASS)** — নিচের ম্যাট্রিক্স | `evidence/01-data-safety-rules.txt` |
| ৫ | পাবলিক ডেটার সীমা? | `settings/public`, `usernames/{name}`, `finance` **ইচ্ছাকৃতভাবে পাবলিক**; এখানে ফোন/ঠিকানা/বেতন-জাতীয় তথ্য রাখবেন না | `evidence/01-...` (শেষ অংশ) |
| ৬ | ভুল কনফিগে ফাঁসের ঝুঁকি? | rules `allow read: if true` হলে সব ফাঁস; apiKey পাবলিক হওয়া স্বাভাবিক (সেটা ফাঁস নয়); Storage-এর rules আলাদা — সেটিও ডিফল্ট-ডিনাই রাখুন; দরকার হলে App Check | যাচাই: live-এ anonymous পড়া **403** |
| ৭ | Backup/restore প্রস্তুত? | **ড্রিল করা হয়েছে** — ৭৭/৭৭ ডকুমেন্ট হুবহু ফিরেছে; সময়: backup ১৭১ms, wipe ৬১৩ms, restore ২৭৯ms (test data) | `evidence/02-restore-drill.txt` |
| ৮ | লগ/অডিট ট্রেইল? | `audit` কালেকশনে প্রতিটি গুরুত্বপূর্ণ কাজ লেখা হয় (admin-only পড়া) | `evidence/01-...` |

### ৫.১ কে কী করতে পারে — যাচাইকৃত অ্যাক্সেস ম্যাট্রিক্স
| কাজ | anonymous | সদস্য (লগইন) | অ্যাডমিন |
| --- | --- | --- | --- |
| পাবলিক ড্যাশবোর্ড (`settings/public`) পড়া | ✅ | ✅ | ✅ |
| নিজের প্রোফাইল পড়া | ❌ | ✅ | ✅ |
| অন্য সদস্যের প্রোফাইল পড়া | ❌ | ❌ | ✅ |
| পুরো `users` লিস্ট | ❌ | ❌ | ✅ |
| নিজের পেমেন্ট দেখা | ❌ | ✅ | ✅ |
| অন্যের পেমেন্ট দেখা | ❌ | ❌ | ✅ |
| পেমেন্ট submit করা (নিজের, pending) | ❌ | ✅ (শর্তসহ) | ✅ |
| নিজের পেমেন্ট নিজে approve | ❌ | ❌ | শুধু অ্যাডমিন |
| নিজেকে অ্যাডমিন বানানো | ❌ | ❌ | — |
| নিজের shares/ঋণ বদলানো | ❌ | ❌ | ✅ |
| audit লগ পড়া | ❌ | ❌ | ✅ |
| `usernames/{name}` পড়া (লগইনের জন্য) | ✅ | ✅ | ✅ |

> পেমেন্ট create-এর শর্ত (rules থেকে পড়া): নিজের uid, amount ১০০০-এর গুণিতক, `status: 'pending'`, `type: 'due'|'advance'`, `verifiedAt/verifiedBy: null` — নইলে 403। **এটি ইচ্ছাকৃত কড়াকড়ি**, যা self-approval ও ভুয়া এন্ট্রি ঠেকায়। (আমাদের প্রথম টেস্ট ঠিক এই কারণেই ব্যর্থ হয়েছিল — তারপর payload সংশোধন করে ৩১/৩১ PASS।)

### ৫.২ ব্যাকআপ কৌশল (পরামর্শ)
| প্রশ্ন | উত্তর |
| --- | --- |
| কত ঘন ঘন | দৈনিক (ভলিউম ছোট হলে সাপ্তাহিকও চলে); বড় পরিবর্তনের ঠিক আগে অতিরিক্ত |
| কোথায় | (১) Firestore managed scheduled backups অথবা Export→Cloud Storage bucket; (২) **নিজের ডিভাইসে মাসিক JSON কপি** (`tools/db-reset.mjs --backup`), রিপো-এর বাইরে |
| কে করতে পারবে | অ্যাডমিন অ্যাকাউন্ট (client) সব ডেটা কালেকশন; **`settings` ও Auth অ্যাকাউন্টের জন্য admin/service-account credentials লাগে** (নিচের নোট) |
| যাচাই | প্রতি ড্রাইভে sha256 মিলিয়ে দেখা; ত্রৈমাসিক restore drill |
| রিটেনশন | ৩০–৯০ দিন casual, ১টি দীর্ঘমেয়াদি (বছর) |

**ড্রিলের দুটি গুরুত্বপূর্ণ আবিষ্কার (এগুলো না জানলে ডেটা হারানোর আশঙ্কা ছিল):**
1. **wipe করার পরপর restore করলে কাজ করবে না** — wipe অ্যাডমিনের নিজের `users/{uid}` মুছে দেয়, ফলে restoring client `isAdmin()` হারায় এবং অ্যাডমিন-only সব লেখা 403 হয়। → **প্রথমে একটি অ্যাডমিন re-claim করুন, তারপর restore।**
2. **client অ্যাডমিন কারোই অন্য কারো `users/{uid}` বানানোর অধিকার নেই** (rules L68: শুধু নিজের doc, pending member হিসেবে বা bootstrap claim হিসেবে)। → **সম্পূর্ণ restore-এর জন্য admin/service-account credentials (CI job বা Admin SDK) লাগবে; শুধু ওয়েব লগইন যথেষ্ট নয়।**

---

## ৬. কোটা ও বিলিং: ডাউনটাইম প্রতিরোধের গার্ডরেল

### ৬.১ Spark (ফ্রি) — যেখানে "কোটা শেষ = সাইট বন্ধ" বাস্তব
| রিসোর্স | ফ্রি সীমা | অতিক্রম করলে |
| --- | --- | --- |
| Hosting storage | ১০ GB | ডিপ্লয় ব্লক |
| Hosting data transfer | ৩৬০ MB/day (Spark) | সেই দিনের ট্রাফিক ব্যর্থ/সীমিত |
| Firestore reads/writes/deletes | ৫০,০০০ / ২০,০০০ / ২০,০০০ **প্রতিদিন** | দৈনিক কোটা শেষ, পরদিন পর্যন্ত ব্যর্থ |
| per-file size | ২ GB | বড় ফাইল ডিপ্লয় হবে না |
উৎস: `firebase.google.com/pricing`, `firebase.google.com/docs/hosting/usage-quotas-pricing`, `firebase.google.com/docs/firestore/quotas` (সংগ্রহ ২০২৬-০৯-১৪)

### ৬.২ গার্ডরেল প্ল্যান (অবশ্যই করণীয়)
| # | ধাপ | কোথায় | কে | কখন যাচাই |
| --- | --- | --- | --- | --- |
| ১ | **Budget alert** (যেমন $৫ / $২০ / $৫০ ধাপে) | Cloud Console → Billing → Budgets & alerts | মালিক | মাসিক |
| ২ | Alert ইমেইল ২টি অ্যাকাউন্টে (প্রাইমারি + ফলব্যাক) | একই | মালিক | সেটআপের দিন |
| ৩ | **প্রোগ্রাম্যাটিক brake**: budget → Pub/Sub → Cloud Function যা billing disable করে | official: `firebase.google.com/docs/projects/billing/avoid-surprise-bills`, `docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications` | মালিক/ডেভ | ত্রৈমাসিক (সত্যিই কাজ করে কি না টেস্ট) |
| ৪ | Quota ড্যাশবোর্ডে সাপ্তাহিক চোখ (Hosting transfer, Firestore reads) | Firebase Console → Usage | অপারেটর | সাপ্তাহিক |
| ৫ | ছবি/ফাইল অপ্টিমাইজ (WebP, ৩০০KB-এর নিচে), বড় ডাউনলোড লিংক এড়ানো | কোড | ডেভ | প্রতি রিলিজে |
| ৬ | কোটা বাড়লে Blaze-এ যাওয়া (pay-as-you-go) | Console | মালিক | যখন usage ৫০%-এ পৌঁছায় |

> **যা করা হয়নি (সৎভাবে):** বাজেট অ্যালার্ট/স্পেন্ড-ক্যাপ **আমরা সেট করতে পারিনি** — এতে আপনার billing অ্যাকাউন্টে প্রবেশ ও অনুমতি লাগে, যা এই কাজের আওতার বাইরে (এবং নিয়ম অনুযায়ী নিষিদ্ধ)। উপরের ধাপগুলো আপনার ২ মিনিটের কাজ। **এই একটি আইটেমই "অসম্পূর্ণ" অবস্থায় আছে।**

### ৬.৩ Blaze-এ গেলে যা বদলায়
- কোনো হার্ড-ক্যাপ **ডিফল্টে নেই** → ভুল/হঠাৎ ট্রাফিকে খরচ বাড়তে পারে; তাই ৬.২-এর অ্যালার্ট + brake জরুরি
- Cloud Functions, বড় export, scheduled backup, App Check ইত্যাদি চালু করা যায় (Firestore export/backup-এর জন্যও Blaze দরকার)

---

## ৭. অপারেশন রানবুক (হস্তান্তরযোগ্য)

### ৭.১ মনিটরিং ও অ্যালার্ট
| কী | কোথায় সেট করবেন | কে পাবে | মিনিট/সময় |
| --- | --- | --- | --- |
| Uptime check: `https://nextgen-fund-2040.web.app/` প্রতি ৫ মিনিট | Cloud Monitoring → Uptime checks | ইমেইল (২ জন) | সেটআপ ১০ মিনিট |
| Firebase status page-এর ইমেইল সাবস্ক্রিপশন | `status.firebase.google.com` | সবাই | ২ মিনিট |
| GitHub Actions ব্যর্থ হলে ইমেইল | GitHub → Settings → Notifications | ডেভ | ২ মিনিট |
| Budget alert (৬.২) | Cloud Console | মালিক | ৫ মিনিট |
| Browser console-এ ত্রুটি (সাপ্তাহিক হাতে) | — | অপারেটর | ৫ মিনিট/সপ্তাহ |

### ৭.২ অ্যালার্ট পেলে কে কী করবে (escalation)
| ধাপ | কে | কী | সময়সীমা |
| --- | --- | --- | --- |
| ১ | **অপারেটর** (নাম: ____) | সাইট খুলে দেখুন; status page দেখুন; rollback লাগবে কি না ঠিক করুন | ১৫ মিনিট |
| ২ | **মালিক** (নাম: ____) | billing/console অ্যাক্সেস লাগলে হস্তক্ষেপ; সদস্যদের জানানো | ১ ঘণ্টা |
| ৩ | **ডেভ** (নাম: ____) | কোড/CI/rules সমস্যা ঠিক করা | ৪ ঘণ্টা |
| ৪ | **টিম** | সদস্যদের সবচেয়ে দ্রুত বার্তা (যদি ডেটা/লগইন সমস্যা) | যত দ্রুত সম্ভব |
> নামের জায়গা ইচ্ছাকৃতভাবে খালি — কে দায়িত্ব নেবে সেটি আপনার সিদ্ধান্ত; জায়গা পূরণ করে PDF-টি টিমের সাথে শেয়ার করুন।

### ৭.৩ ব্যাকআপ রুটিন
- দৈনিক: স্ক্রিপ্ট/CI job → Cloud Storage export + sha256 রেকর্ড
- মাসিক: মালিকের ডিভাইসে `node tools/db-reset.mjs --backup --email <admin> --password ***` (ফাইল রিপো-র বাইরে রাখুন)
- ত্রৈমাসিক: **restore drill** (test project) — প্রত্যাশিত ফল: সব ডকুমেন্ট ফিরে আসে; সময় রেকর্ড

### ৭.৪ রোলব্যাক ট্রিগার ও কমান্ড
| ট্রিগার | কমান্ড/কাজ | প্রভাব |
| --- | --- | --- |
| ডিপ্লয়ের পর সাইট ভাঙা / ভুল কনটেন্ট | `firebase hosting:rollback --project nextgen-fund-2040` অথবা console → Hosting → Release history → Rollback, অথবা `git revert <commit> && git push` (CI আবার ডিপ্লয় করবে) | ২–৫ মিনিটে আগের ভার্সন |
| rules ভুল (ডেটা আটকে যাচ্ছে/খুলে যাচ্ছে) | `git revert` করে rules আবার ডিপ্লয়; আগে `firebase emulators:exec` টেস্ট | ৫–১০ মিনিট |
| ডেটা নষ্ট/ভুল | wipe নয় — **আগে backup**, তারপর নির্বাচিত কালেকশন restore (`tools/db-reset.mjs --restore --from <file>`) | ৫–৩০ মিনিট (আকার অনুসারে) |
| কোটা শেষ (Spark) | Blaze-এ যাওয়া, অথবা ট্রাফিক কমানো | ১০ মিনিট |
| সন্দেহজনক/অননুমোদিত অ্যাক্সেস | rules ডিফল্ট-ডিনাই করুন, Auth-এ ২FA, service key rotate | ১৫ মিনিট |

---

## ৮. কাস্টম ডোমেইনে মাইগ্রেশন প্ল্যান (ও রোলব্যাক)

**সিদ্ধান্ত:** কাস্টম ডোমেইনে যাওয়া **ঐচ্ছিক এবং ঝুঁকিহীন** — `web.app` চালু রেখেই দ্বিতীয় ডোমেইন যোগ করা যায়, তাই কিছু ভুল হলে আগের অবস্থায় ফিরে আসা সহজ।
উৎস: `firebase.google.com/docs/hosting/custom-domain` (সংগ্রহ ২০২৬-০৯-১৪)

| ধাপ | কাজ | সময় | যাচাই |
| --- | --- | --- | --- |
| ১ | ডোমেইন কেনা (Namecheap/Cloudflare/BD প্রোভাইডার) | ১০ মিনিট | ডোমেইন প্যানেলে মালিকানা ✓ |
| ২ | Firebase console → Hosting → **Add custom domain** → ডোমেইন লিখুন | ২ মিনিট | কনসোলে ধাপ দেখা |
| ৩ | **TXT রেকর্ড** যোগ করুন (মালিকানা যাচাই) → Verify | ১০ মিনিট–**২৪ ঘণ্টা propagation** | console-এ "Verified" |
| ৪ | বাকি DNS রেকর্ড (A / AAAA / CNAME) — **কনসোলে যেগুলো দেখাবে হুবহু সেগুলোই দিন, অনুমান করবেন না** | ১০ মিনিট + propagation | `nslookup`/`Resolve-DnsName` দিয়ে মিলিয়ে দেখুন |
| ৫ | SSL অটো-provision হয় (Google-managed), অপেক্ষা করুন | ১৫ মিনিট–২৪ ঘণ্টা | ব্রাউজারে তালা 🔒 + মেয়াদ |
| ৬ | দুই ডোমেইনেই সাইট পরীক্ষা করুন (পুরোনো `web.app` সহ) | ১০ মিনিট | দুটোই 200 |
| ৭ | পুরোনো লিংক রিডাইরেক্ট (ঐচ্ছিক) — `firebase.json`-এ redirect নিয়ম বা অ্যাপে canonical | ২০ মিনিট | পুরোনো লিংক খোলে |
| ৮ | `authDomain`/OAuth সেটিংসে নতুন ডোমেইন যোগ করুন (যদি দরকার) | ১৫ মিনিট | লগইন টেস্ট |
| **রোলব্যাক** | console → custom domain → **Remove** (web.app আগে থেকেই কাজ করছে) | ২ মিনিট | web.app আবার প্রাইমারি |

---

## ৯. উৎস তালিকা (সবই ২০২৬-০৯-১৪ তারিখে দেখা/সংগৃহীত)

| দাবি | অফিসিয়াল সোর্স |
| --- | --- |
| Firebase SLA — Hosting ও Realtime DB **৯৯.৯৫%** | https://firebase.google.com/terms/service-level-agreement |
| Cloud Storage for Firebase SLA | https://firebase.google.com/terms/service-level-agreement/cloud-storage |
| Firestore SLA — multi-region ≥৯৯.৯৯৯%, regional ৯৯.৯৯% | https://cloud.google.com/firestore/sla |
| Hosting storage/file/transfer সীমা (১০ GB, ২ GB/file) | https://firebase.google.com/docs/hosting/usage-quotas-pricing |
| Firebase মূল্য ও Spark কোটা (৩৬০ MB/day) | https://firebase.google.com/pricing |
| Firestore দৈনিক কোটা (৫০k reads/২০k writes) | https://firebase.google.com/docs/firestore/quotas |
| অপ্রত্যাশিত বিল এড়ানো (budget alert, spend cap, বিলিং বন্ধ) | https://firebase.google.com/docs/projects/billing/avoid-surprise-bills |
| প্রোগ্রাম্যাটিক বাজেট নোটিফিকেশন | https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications |
| Firestore server-side encryption (এনক্রিপশন ডিফল্টে) | https://docs.cloud.google.com/firestore/native/docs/server-side-encryption |
| Firestore CMEK (নিজের key) | https://firebase.google.com/docs/firestore/cmek |
| Firestore export/import | https://firebase.google.com/docs/firestore/manage-data/export-import |
| Firestore scheduled backups | https://docs.cloud.google.com/firestore/native/docs/backups |
| Firestore locations (multi-region vs regional) | https://firebase.google.com/docs/firestore/locations |
| কাস্টম ডোমেইন যুক্ত করা (TXT verify, DNS, SSL) | https://firebase.google.com/docs/hosting/custom-domain |
| Firebase incident feed (৪৮ রেকর্ড) | https://status.firebase.google.com/incidents.json |
| Google Cloud incident feed | https://status.cloud.google.com/incidents.json |
| আমাদের live সাইটের পরিমাপ (DNS/TLS/হেডার) | `docs/hosting-audit/nextgen-fund-where-it-runs.md` |

---

## ১০. হস্তান্তর চেকলিস্ট

- [ ] বাজেট অ্যালার্ট + (ঐচ্ছিক) programmatic brake সেট করুন — **একমাত্র অসম্পূর্ণ আইটেম**
- [ ] Firestore ডেটাবেসের Location নোট করুন (console → Firestore)
- [ ] Uptime check চালু করুন (§৭.১)
- [ ] দৈনিক backup schedule ঠিক করুন; মাসিক কপি নিজের ডিভাইসে
- [ ] ত্রৈমাসিক restore drill ক্যালেন্ডারে ভরুন (প্রথমটি আমরা করে দিয়েছি, ফল PASS)
- [ ] রানবুকে দায়িত্বপ্রাপ্ত ব্যক্তির নাম বসান (অপারেটর/মালিক/ডেভ)
- [ ] সিদ্ধান্ত: `web.app`-এ থাকবেন নাকি কাস্টম ডোমেইনে যাবেন (সুপারিশ: ব্র্যান্ডেড হলে যান)
- [ ] `settings/public`, `usernames`, `finance`-এ কখনো ব্যক্তিগত তথ্য (ফোন/ঠিকানা/এনআইডি) রাখবেন না
- [ ] রিপো-তে (পাবলিক) কখনো আসল সদস্য-তথ্য বা backup ফাইল কমিট করবেন না

**খোলা প্রশ্ন (আপনার সিদ্ধান্ত দরকার):** কে অপারেটর/মালিক/ডেভ? বাজেট সীমা কত? কাস্টম ডোমেইন কেনার সিদ্ধান্ত কখন?

---

*এই ডকুমেন্ট কোনো আইনি পরামর্শ বা ১০০% নিরাপত্তা/আপটাইমের নিশ্চয়তা নয়। প্রতিটি প্রযুক্তিগত দাবির সোর্স §৯-এ এবং প্রমাণ ফাইল `evidence/`-এ দেওয়া আছে; যেখানে প্রমাণ নেই সেখানে স্পষ্টভাবে উল্লেখ করা হয়েছে।*
