# Advance ফিক্স — হ্যান্ডঅভার, ডিপ্লয় ও রোলব্যাক নোট

> ২০২৬-০৯-১৪ · commit `63d5b3f` · প্রযোজ্য সাইট: `iamatiq7.github.io/nextgen-fund` এবং `nextgen-fund-2040.web.app`

## ১. কী বদলেছে (ফাইল ধরে)

| ফাইল | পরিবর্তন |
|---|---|
| `assets/js/store.js` | `computeBalance()` — অগ্রিম = `max(0, paid − expected)`; `advanceMonths` যুক্ত; demo snapshot-এ `memberDeposits`/`memberAdvance`/`pendingDue` |
| `assets/js/firebase-adapter.js` | একই `computeBalance()`; `syncPublicTotals()`-এ verified advance-ও deposit হিসেবে গণনা + `memberAdvance` পুল; `getPublicSnapshot()`-এ `memberAdvance` |
| `assets/js/portal.js`, `portal.html` | অগ্রিম কার্ডের নিচে "covers N month(s) ahead" সাব-লাইন; due breakdown-এ received টাকা |
| `assets/js/admin.js` | Members ট্যাবে **Advance audit** কার্ড — কতজন সদস্যের কত অগ্রিম, কারা বিলের বেশি পরিশোধ করেছে |
| `assets/js/i18n.js` | নতুন কি: `por.advanceMonths`, `adm.advAudit`, `adm.advAuditLine`, `adm.advAuditNone` (EN + BN) |
| `tests/advance.test.mjs` | নতুন: পুনরুৎপাদন + ১২টি কিনারা-পরিস্থিতির টেস্ট (২১ চেক) |
| `tests/e2e-emulator/` | আসল অ্যাডাপ্টার কোড দিয়ে emulator E2E — অগ্রিম ধাপসহ |

## ২. ডিপ্লয় ধাপ (ক্রম গুরুত্বপূর্ণ)

1. **ডেটা ব্যাকআপ:** অ্যাডমিন → Settings → Export (members/payments/finance CSV) নামিয়ে রাখুন। চাইলে Firebase console → Firestore → Import/Export দিয়ে পূর্ণ ব্যাকআপ।
2. **কোড প্রকাশ:** `git push` → GitHub Pages ও Firebase Hosting স্বয়ংক্রিয়ভাবে ~১–২ মিনিটে আপডেট হয় (কোনো ম্যানুয়াল কমান্ড নেই)।
3. **কোনো ডেটা মাইগ্রেশন লাগে না** — অগ্রিম কোনো ফিল্ডে সংরক্ষিত নয়; এটা প্রতিবার পেমেন্ট লেজার থেকে হিসাব হয়। তাই পুরোনো অ্যাকাউন্টগুলো **নিজে থেকেই** ঠিক দেখায় (প্রমাণ: নিচের আগে/পরে টেবিল)।
4. **যাচাই:** অ্যাডমিন → Members → "Advance audit" কার্ডে সংখ্যা মিলিয়ে নিন; একজন সদস্যের বিস্তারিত খুলে paid/due/advance মিলান।
5. **অ্যাডমিন UI পরিবর্তনের পর অ্যাডমিন পেজ Ctrl+F5 দিয়ে রিফ্রেশ করুন** (পুরোনো ট্যাবে পুরোনো কোড থাকে)।

## ৩. রোলব্যাক (কিছু ভুল হলে)

| পরিস্থিতি | কী করবেন | ফল |
|---|---|---|
| কোড সমস্যা | `git revert 63d5b3f && git push` (বা Firebase Hosting → Release history → আগের release-এ Rollback) | ~১–২ মিনিটে আগের হিসাব ফিরে আসে (অ্যাডভান্স আবার ৳০ দেখাবে) — **ডেটা হারায় না**, কারণ কোনো ডেটা বদলানো হয়নি |
| ডেটা সমস্যা | Firestore export থেকে restore, বা অ্যাডমিন → Payments থেকে ভুল এন্ট্রি reject/delete | লেজার আগের অবস্থায় ফিরে আসে; ব্যালেন্স নিজেই পুনর্গণনা হয় |
| পুরো সাইট ডাউন | GitHub Pages: আগের commit-এ revert; Firebase: Hosting rollback | দুটি হোস্ট স্বাধীন, একটি চালু থাকলেও সাইট চলে |

## ৪. অপারেটর ছেকলিস্ট (মাসে একবার)

- [ ] Admin → Members → Advance audit: মোট অগ্রিম ও সদস্য সংখ্যা দেখা
- [ ] Export → members/payments CSV: ব্যাকআপ রাখা
- [ ] সন্দেহজনক কেস: paid > expected কিন্তু advance 0 দেখাচ্ছে কি? (না — ফিক্সের পর এমন হওয়া উচিত নয়; হলে রিপোর্ট করুন)
- [ ] নিয়ম মনে রাখুন: পেমেন্ট সবসময় ১,০০০ টাকার গুণিতক (১০০/৫০০/১,৫০০ সিস্টেম আটকে দেবে)

## ৫. ঝুঁকি ও সীমাবদ্ধতা

- অগ্রিম খরচ হয় মাস পেরোলে (`expected` বাড়লে) — তাই অক্টোবরে "৳০" দেখানো ভুল নয়, টাকা ওই মাসের বিলে লেগে গেছে।
- ফান্ড টোটালে অগ্রিমও "deposit" হিসেবে ধরা হয় (টাকা ফান্ডে এসেছে); আলাদা `memberAdvance` পুলে অগ্রিমের পরিমাণ দেখা যায়।
- পুরোনো মাসের ভুল ডেটা (ম্যানুয়াল অডিট) এই কাজের বাইরে।
- অ্যাডমিন যদি **ভবিষ্যতের মাস** join month হিসেবে দেন (বা ফাঁকা রাখেন), সিস্টেম এখনো পুরোনো নিয়মেই কমপক্ষে ১ মাসের বিল ধরে। সদস্য যোগ দেওয়ার আগে বিল না ধরা নিয়ম চাইলে বলুন — বদলে দেওয়া যাবে (Members → Edit থেকে join month ঠিক করাই এখনকার সমাধান)।
- ভাঙা join month (যেমন টেক্সট) দিলে ব্যালেন্স NaN না হয়ে নিরাপদ মান দেখায় (গার্ড যোগ করা হয়েছে), তবে ডেটা ঠিক করা উচিত।
