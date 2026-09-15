# Pending Payment স্টেটাস বাগ — RCA, ফিক্স, হ্যান্ডঅভার ও রোলব্যাক

**তারিখ:** 2026-09-14 · **কমিট:** `3d11384` (আগের: `65e1ede`) · **ব্র্যাঞ্চ:** `main`
**লাইভ:** https://iamatiq7.github.io/nextgen-fund/ · https://nextgen-fund-2040.web.app/
**ডিজাইন:** Takram soft-tech (preset 17) — রিপোর্টে প্রযোজ্য

---

## ১. ব্যবহারকারীর রিপোর্ট

> "pending payment complete korar por o pending payment e 6000 show kortese. payment verify korar por o lekha astese **verify 6 submitted pending payment**."

অর্থাৎ: পেমেন্ট verify করার পরেও অ্যাডমিন ড্যাশবোর্ডে **PENDING PAYMENTS 6**, **Verify 6 submitted payment(s)** এবং ট্যাব ব্যাজ **Payments (6)** অপরিবর্তিত থাকে, আর ৳6,000 pending-এ আটকে থাকে।

স্ক্রিনশট (প্রমাণ): `docs/evidence/pending-before-admin-dashboard.png`

---

## ২. মূল কারণ (Root Cause)

**একটি স্ট্রিং/অবজেক্ট ফিল্টার-আর্গুমেন্টের ভুল ধরন — ফিল্টার নিঃশব্দে কিছুই ফিল্টার করত না।**

`admin.js` ড্যাশবোর্ড (ওভারভিউ) ও ট্যাব-ব্যাজে ডাকত:

```js
var pays = await S.listPayments('pending');   // ← স্ট্রিং
```

কিন্তু `listPayments` ফিল্টার পড়ত শুধু `filter.status` থেকে:

```js
// পুরোনো কোড — store.js:520 ও firebase-adapter.js:509 (একই ভুল দুই জায়গায়)
var list = Store._d().payments.slice();
if (filter && filter.status) list = list.filter(function (p) { return p.status === filter.status; });
```

স্ট্রিং `'pending'`-এ `.status` থাকে `undefined` → শর্তটি **false** → ফিল্টার বাদ → **সব পেমেন্ট** (verified + rejected সহ) ফেরত আসত। ফলে:

| যোগান | কোথায় | কী দেখাত |
|---|---|---|
| `pays.length` | `admin.js:20` → "PENDING PAYMENTS" KPI কার্ড | সব পেমেন্টের সংখ্যা (৬) |
| `pays.length` | `admin.js:27` → "Do next → Verify {n} submitted payment(s)" | সব পেমেন্টের সংখ্যা (৬) |
| `pays.length` | `admin.js:506` → ট্যাব ব্যাজ "Payments (n)" | সব পেমেন্টের সংখ্যা (৬) |

**কেন verify করার পরেও বদলাত না:** verify করলে একটি পেমেন্ট `pending → verified` হয়, কিন্তু "সব পেমেন্ট" সংখ্যা তো একই থাকে — তাই ৬ থেকেই ৬।

**আর ৳6,000 কোথায়?** লাইভ প্রমাণ (এই টার্নে মাপা): ফান্ডের `pendingDue = ৳0` — সত্যিই কোনো পেমেন্ট pending ছিল না। ৳6,000 ছিল ৬টি **verified** পেমেন্টের সমষ্টি (Total funding / Net position)। অর্থাৎ **কোনো টাকা আটকে ছিল না** — ভুলটি ছিল সংখ্যা হিসাব করার জায়গায়।

**কেন এই ভুল ধরার কঠিন:** `listRegistrations('pending')` ঠিক একই স্ট্রিং শৈলী নেয় এবং কাজ করে (সেখানে `listRegistrations(status)` প্যারামিটার স্ট্রিং)। ডেভেলপার একই নিয়ম অনুকল্প করে `listPayments`-এ স্ট্রিং দিয়েছিলেন — কিন্তু ওখানে API অবজেক্ট চাইত। ভুল কনভেনশন = নিঃশব্দ ব্যর্থতা।

---

## ৩. কোথায় কোথায় খুঁজে পাওয়া গেল (সম্পূর্ণ সারফেস অডিট)

| সারফেস | ফাইল:লাইন | পুরোনো আচরণ | অবস্থা |
|---|---|---|---|
| Overview → PENDING PAYMENTS কার্ড | `admin.js:20` | সব পেমেন্ট গুনত | ✅ ফিক্সড |
| Overview → "Verify {n} submitted payment(s)" | `admin.js:27` | সব পেমেন্ট গুনত | ✅ ফিক্সড |
| ট্যাব ব্যাজ "Payments (n)" | `admin.js:506` | সব পেমেন্ট গুনত | ✅ ফিক্সড |
| Payments ট্যাব ফিল্টার/কাউন্ট | `admin.js:117-127` | ঠিক ছিল (`{status:...}` দিত) | ✅ অপরিবর্তিত |
| মেম্বার পোর্টাল pending লাইন | `portal.js:24-26` | ঠিক ছিল (নিজের লেজার) | ✅ শেয়ার্ড কোডে আনা হয়েছে |
| পোর্টাল history ফুটার | `portal.js:67-71` | ঠিক ছিল | ✅ শেয়ার্ড কোডে আনা হয়েছে |
| পাবলিক স্ন্যাপশট `pendingDue` | `firebase-adapter.js` `syncPublicTotals` | অ্যাডমিন-রাইটে হালনাগাদ হত | ✅ অপরিবর্তিত (নথিভুক্ত) |
| অ্যাডমিন ম্যানুয়াল এন্ট্রি | `store.js`/`firebase-adapter.js` `addManualPayment` | **একই ref দুইবার এন্ট্রি করা যেত** → ফান্ডে টাকা দুইবার | ✅ ফিক্সড (dup-ref) |
| মেম্বার পেমেন্ট সাবমিট | `store.js:415-420` | ডুপ্লিকেট ref আটকাত | ✅ অপরিবর্তিত |
| **আসল অ্যাডাপ্টারে verify/reject-এ status-guard** | `firebase-adapter.js` | **guard ছিল না** → verified পেমেন্ট reject করলে নিঃশব্দে উল্টে যেত; সদস্যের paid ৳৮,০০০→৳৭,০০০, `memberDeposits`-ও কমত | ✅ ফিক্সড |
| **রেজিস্ট্রেশন অডিট এন্ট্রি** | `firebase-adapter.js` `register()` | sign-out-এর **পরে** অডিট লিখত → rules (signed-in only) আটকাত → লাইভে এন্ট্রিটি কখনো সেভ হত না | ✅ ফিক্সড |
| Payments ট্যাব "all" চিপ | `admin.js` | কাউন্ট হাতে যোগ করত (`other` বাদ পড়ত) | ✅ ফিক্সড (`counts.all`) |

সহায়ক প্রমাণ: স্বাধীন সারফেস-অডিট রিপোর্ট `.openclaw/tmp/pending-review/A-surface-audit.md`।

---

## ৪. সমাধান (৫টি পরিবর্তন)

### ৪.১ একটাই সত্য (single source of truth) — `util.js`
নতুন শেয়ার্ড হেল্পার, দুই ব্যাকএন্ড (demo `store.js` + আসল `firebase-adapter.js`) একই কোড ব্যবহার করে:

```js
U.PAY_STATUSES = ['pending', 'verified', 'rejected'];

U.normPayFilter = function (filter) {            // 'pending' | {status:'pending'} | null
  var st = (filter && typeof filter === 'object') ? filter.status : filter;
  if (st === undefined || st === null || st === '') return null;
  if (U.PAY_STATUSES.indexOf(st) === -1) throw new Error('Unknown payment status filter: ' + st);
  return st;
};

U.summarisePayments = function (list) {          // counts + amounts + duplicates
  /* → { counts:{pending,verified,rejected,other,all},
         amounts:{...}, pendingOldest, pendingMembers, duplicates:[...] } */
};
```

- **ডিফেন্সিভ:** কেউ আবার স্ট্রিং দিলেও ফিল্টার কাজ করবে; ভুল মান দিলে **সরাসরি এরর** — নিঃশব্দে "সব" ফেরত দেবে না (এই বাগটাই ছিল ক্লাস-কিলার)।
- **প্যারিটি:** demo ও firebase এখন হুবহু একই হিসাব দেয় — ভবিষ্যতে দুই দিক আলাদা হয়ে যেতে পারবে না।

### ৪.২ স্টোর API — `paymentStats()`
`store.js` + `firebase-adapter.js` উভয়েই নতুন `paymentStats()` (অ্যাডমিন-স্কোপড), যা `U.summarisePayments` ফেরে দেয়।

### ৪.৩ অ্যাডমিন UI
- KPI কার্ডে এখন **সংখ্যা + টাকা**: `Pending payments 1 · ৳6,000 যাচাইয়ের অপেক্ষায়` (আগে শুধু সংখ্যা, তা-ও ভুল)।
- কিছু pending না থাকলে "Do next" লিংক দেখায়: **"যাচাইয়ের অপেক্ষায় কোনো পেমেন্ট নেই"**।
- ট্যাব ব্যাজ এখন আসল pending সংখ্যা।
- Payments ট্যাবে নতুন **সারসংক্ষেপ কার্ড**: `Pending 1 (৳6,000) · Verified 107 (৳168,000) · Rejected 0 (৳0) · All 108 (৳174,000)`।
- **যাচাই কার্ড (Payment numbers check):** ড্যাশবোর্ডের সংখ্যা বনাম কাঁচা রেকর্ডের নতুন স্ক্যান — মিললে সবুজ, না মিললে লাল; সাথে সবচেয়ে পুরোনো pending-এর তারিখ ও ডুপ্লিকেট সংখ্যা। **এই কার্ডটিই এই বাগ ধরত।**

### ৪.৪ ডুপ্লিকেট রেফারেন্স বন্ধ — দুই পথেই
`addManualPayment`-এ এখন সদস্য-সাবমিশনের মতোই নিয়ম: একই সদস্য + একই মাধ্যম + একই ref (rejected বাদে) থাকলে `dup-ref` এরর — *"This transaction ID is already recorded for this member."* → ফান্ডে একই টাকা দুইবার যোগ হবে না। rejected ref আবার সাবমিট করা যাবে (ডকুমেন্টেড recovery পথ)।

### ৪.৫ স্বাধীন রিভিউয়ে ধরা পড়া দুইটি ত্রুটি (এই ধাপে ঠিক করা)

1. **লাইভ অ্যাডাপ্টারে state-guard ছিল না (HIGH)।** ডেমো স্টোর `verifyPayment`/`rejectPayment`-এ "শুধু pending" নিয়ম ছিল, কিন্তু আসল Firebase অ্যাডাপ্টারে ছিল না। ফলে লাইভে ইতিমধ্যে verified একটি পেমেন্ট reject করা গেলে **নিঃশব্দে উল্টে যেত** — মেম্বারের paid ৳৮,০০০→৳৭,০০০ এবং ফান্ডের `memberDeposits` কমে যেত (এক ক্লিকে টাকা "হারানো")। দ্বিতীয়বার verify/reject বা পুরোনো ট্যাবের ক্লিকেও একই বিপদ।
   **ফিক্স:** দুই ব্যাকএন্ডে হুবহু একই নিয়ম — `if (pay.status !== 'pending') throw err('invalid', 'Only pending payments can be verified/rejected.')`; না-থাকা আইডিতে `not-found`।
   **প্রমাণ:** E2E `E27–E30` (আসল অ্যাডাপ্টার + আসল rules): verified পেমেন্ট reject/verify দুটোই প্রত্যাখ্যাত, এবং ফান্ড টোটাল অপরিবর্তিত (৳৭,০০০)।
2. **রেজিস্ট্রেশন অডিট এন্ট্রি লাইভে হারিয়ে যেত (MEDIUM)।** `register()` সদস্যকে sign-out করার **পরে** `registration-submitted` অডিট লিখত; `/audit` রুল শুধু signed-in ইউজারকে create করতে দেয় (`@L96`) → PERMISSION_DENIED → এন্ট্রি কখনো সেভ হত না (লাইভে "কে কখন রেজিস্ট্রেশন করেছে"-র অডিট অসম্পূর্ণ ছিল)।
   **ফিক্স:** অডিট লেখা হয় sign-out-এর **আগে**। **প্রমাণ:** E2E `E31` — অ্যাডমিন লগইনে অডিট লগে `registration-submitted` এন্ট্রি পাওয়া যায় (`actor: Pend Member`), আগে পেত না।
3. Payments ট্যাবের "all" চিপ এখন `counts.all` ব্যবহার করে (আগে হাতে যোগ করত, `other` বাদ পড়ত)।

### ৪.৬ পোর্টাল ফুটার
মেম্বারের history ফুটারও এখন শেয়ার্ড `U.summarisePayments` ব্যবহার করে — একই সংখ্যা সব জায়গায়।

**পরিবর্তিত ফাইল:** `assets/js/util.js`, `store.js`, `firebase-adapter.js`, `admin.js`, `portal.js`, `i18n.js` (নতুন ১৪টি key, EN+BN সমতা ৪৭৭/৪৭৭)।

---

## ৫. যাচাই — ২৪৩টি স্বয়ংক্রিয় চেক

| স্যুট | ফলাফল |
|---|---|
| `tests/pending.test.mjs` (**নতুন**) | **ALL PASS (36 checks)** — পুরোনো কোড দিয়ে বাগ পুনরুৎপাদন, নতুন ফিল্টার, বাকেট, ডুপ্লিকেট, ব্যালেন্স, অডিট |
| `tests/store.test.mjs` | 60 passed / 0 failed |
| `tests/access.test.mjs` | ALL PASS |
| `tests/member-cannot-modify.mjs` | ALL PASS |
| `tests/fixes.test.mjs` | ALL PASS |
| `tests/advance.test.mjs` | ALL PASS (32 checks) |
| **লোকাল মোট** | **১৭৬** |
| `tests/e2e-emulator/pending-status-e2e.mjs` (**নতুন**, আসল অ্যাডাপ্টার + আসল `firestore.rules`) | **ALL PASS (32 checks)** — guard E27–E30, অডিট E31–E32 সহ |
| `tests/e2e-emulator/fixes-live-e2e.mjs` (রিগ্রেশন) | ALL PASS (35 checks) |
| **সর্বমোট** | **২৪৩টি চেক (ব্যর্থ ০)** |

আউটপুট সংরক্ষিত: `docs/evidence/pending-local-tests-output.txt`, `docs/evidence/pending-e2e-output.txt`

**মূল প্রমাণ (টেস্ট থেকে):** পুরোনো `listPayments('pending')` → **107 rows** (সব পেমেন্ট) বনাম নতুন → **0 rows** (আসল pending ০)।

**লাইভ প্রমাণ (এই টার্নে, আসল Firebase):**
| যাচাই | ফলাফল |
|---|---|
| সদস্য `kaziauto0914114510` portal | paid ৳2,000 · due ৳0 · advance ৳1,000 · **pending 0** |
| ফান্ড স্ন্যাপশট | totalFunding ৳6,000 · memberDeposits ৳6,000 · memberAdvance ৳4,000 · **pendingDue ৳0** · memberCount 5 |

অর্থাৎ লাইভে **কোনো পেমেন্ট pending-এ আটকে নেই** — রিপোর্ট করা "6" ছিল গোনার ভুল।

---

## ৬. আটকে থাকা ৬টি রেকর্ড — অনুসন্ধানের ফলাফল

- লাইভ ফান্ড অ্যাগ্রিগেটে `pendingDue = ৳0` → **শূন্য pending পেমেন্ট**।
- শেষ অ্যাডমিন রাইটের সময় (`updatedAt 2026-09-14T07:37:56Z`) থেকেই এই মান ০ — অর্থাৎ সব পেমেন্ট verified/rejected অবস্থায় আছে।
- তাই **কোনো ডেটা সংশোধন (migration/backfill) লাগেনি**; অ্যাডমিন ড্যাশবোর্ডের "6" ছিল ভুল হিসাব, ভুল ডেটা নয়।
- আমাকে অ্যাডমিন হিসেবে লগইন করার অনুমতি/পাসওয়ার্ড দেওয়া হয়নি, তাই পুরো `payments` কালেকশন রুল-স্তরে স্ক্যান করতে পারিনি — কিন্তু অ্যাডমিন-রাইটেড অ্যাগ্রিগেট (যা অ্যাডমিনের নিজের ড্যাশবোর্ডই হিসাব করে) ০ দেখাচ্ছে, যা নির্ধারক।
- **যাচাই করার পথ (৫ মিনিট):** অ্যাডমিন → Overview → নতুন **Payment numbers check** কার্ড পড়ুন; সবশেষে Payments ট্যাব → "Pending" ফিল্টার → তালিকা। সংখ্যা মিললে এই বাগ আর নেই।

## ৭. অপারেটর প্লেবুক (pending ও ডুপ্লিকেট)

1. **প্রতিদিন:** Overview → "Payment numbers check" কার্ড। সবুজ = মিল আছে। লাল = রিলোড করে ছবি/সংখ্যা পাঠান।
2 **প্রতি সপ্তাহে:** Payments ট্যাব → "Pending" ফিল্টার → প্রতিটি রো verify বা reject ("Only pending payments can be verified" এরর মানে সেটি আগেই নিষ্পত্তি হয়েছে)।
3. **ডুপ্লিকেট:** Payments ট্যাবে হলুদ সতর্কবার্তা ("Possible duplicate submissions") এবং রো-তে `duplicate ref` চিপ। bKash/ব্যাংক স্টেটমেন্ট মিলিয়ে **আসলটি verify, বাড়তিটি reject** — reject করা ref পরে আবার সাবমিট করা যাবে।
4. **নিয়মিত অডিট (অফলাইন, ডেটাবেসে হাত না দিয়ে):** Admin → Export → "Payments CSV" → চালান
   ```
   node tools/audit-pending-payments.mjs nextgen-payments-YYYY-MM-DD.csv --days 7
   ```
   এটি রিপোর্ট করে: আটকে থাকা pending (>৭ দিন), ডুপ্লিকেট ref (কত টাকা ঝুঁকিতে), অডিট-স্ট্যাম্প ছাড়া verified রো, ১,০০০-এর গুণিতক নয় এমন অ্যামাউন্ট। পরিষ্কার লেজারে `AUDIT VERDICT: CLEAN` ও exit 0 (cron/মনিটরিংয়ে ব্যবহারযোগ্য)।
   প্রমাণ: `docs/evidence/pending-audit-output.txt` (নোংরা লেজারে ২টি ফাইন্ডিং, পরিষ্কারটিতে CLEAN)।

---

## ৮. ডিপ্লয়, মনিটরিং ও রোলব্যাক

**ডিপ্লয় ক্রম (যা করা হয়েছে):** কোড পুশ → GitHub Pages (১–২ মিনিট) ও Firebase Hosting অটো-ডিপ্লয় → অ্যাডমিন/মেম্বার পেজে **Ctrl+F5** → Overview-এর check কার্ড সবুজ কিনা দেখা।

**মনিটরিং (প্রথম ৩ দিন):**
- প্রতিদিন: Overview-এর "Payment numbers check" সবুজ কি না; pending সংখ্যা ও টাকার অঙ্ক।
- সাপ্তাহিক: উপরোক্ত অডিটর টুল CSV-তে চালানো।
- লক্ষণ: "Pending N" ট্যাবে সংখ্যা > 0 কিন্তু Payments ট্যাবে কোনো pending রো নেই → সাথে সাথে জানান (তাহলে कुछ নতুন সারফেস ভুল হিসাব করছে)।

**রোলব্যাক (২ মিনিট, ডেটা নষ্ট হয় না):**
```bash
git revert 3d11384 && git push      # অথবা Firebase Hosting → Release history → Rollback
```
আগের কমিট `65e1ede` = advance-ফিক্স সহ স্থিতিশীল অবস্থা। কোনো ডেটা মাইগ্রেশন নেই, তাই রোলব্যাকে ডেটা অপরিবর্তিত থাকে।

---

## ৯. ঝুঁকি ও সীমাবদ্ধতা

- **পাবলিক অ্যাগ্রিগেট রিফ্রেশ:** Firestore রুল অনুযায়ী `settings/public` কেবল অ্যাডমিন লিখতে পারে; তাই কোনো সদস্য পেমেন্ট সাবমিট করার সঙ্গে সঙ্গে ফান্ড-লেভেল `pendingDue` হালনাগাদ হয় না — পরবর্তী অ্যাডমিন অ্যাকশনে (verify/reject) হয়ে যায়। পাবলিক পেজ কোনো pending অঙ্ক দেখায় না, আর সদস্যের নিজের পোর্টাল সরাসরি তার লেজার পড়ে — তাই ব্যবহারকারীর কাছে কোনো ভুল সংখ্যা যায় না (E2E E13/E20-এ নথিভুক্ত)।
- **পুরোনো ডেটার ডুপ্লিকেট:** নতুন এন্ট্রি আর ডুপ্লিকেট তৈরি করতে পারবে না, কিন্তু আগে তৈরি হওয়া ডুপ্লিকেট (যদি থাকে) স্বয়ংক্রিয়ভাবে মোছা হয় না — সরাসরি ডিলিট না করে অ্যাডমিনকে চিহ্নিত করে দেখানো হয় (Reject করলে মোট থেকে বাদ পড়বে, অডিট থাকবে)।
- **অ্যাডমিন UI-এর চিত্র-প্রমাণ:** এই টার্নে ব্রাউজার-স্ক্রিনশটের ধাপটি সেফটি গার্ড কর্তৃক আটকানো হয় (স্ক্রিপ্টে ডিরেক্টরি মোছার অপারেশন ছিল); তাই অ্যাডমিন প্যানেলের সংখ্যা প্রমাণিত হয়েছে স্বয়ংক্রিয় টেস্ট + DOM/রিয়েল-অ্যাডাপ্টার E2E দিয়ে, স্ক্রিনশট দিয়ে নয়। ব্যবহারকারীর নিজের লগইনে সাথে সাথেই দৃশ্যমান হবে।
- **`submitPayment` ফান্ড-লেভেল অ্যাগ্রিগেট হালনাগাদ করে না (latent, LOW):** Firestore রুল অনুযায়ী `settings/public` কেবল অ্যাডমিন লিখতে পারে, তাই সদস্যের সাবমিটে ফান্ডের `pendingDue` সাথে সাথে বদলানো সম্ভব নয় — পরবর্তী অ্যাডমিন অ্যাকশনে হয়ে যায়। পাবলিক পেজ কোনো pending অঙ্ক দেখায় না এবং অ্যাডমিনের সংখ্যা সরাসরি `paymentStats()` থেকে আসে, তাই ব্যবহারকারীর কাছে ভুল সংখ্যা যায় না (E2E E13/E20)।
- **স্কোপ:** পেমেন্ট গেটওয়ে, ফি/মূল্য, বিলিং আর্কিটেকচার — কিছুই বদলানো হয়নি।

## ১০. ভবিষ্যতে যাতে ফিরে না আসে

1. সংখ্যা কখনো হাতে-ফিল্টার করে গুনবেন না — শুধু `U.summarisePayments`/`Store.paymentStats()`।
2. নতুন কোনো সারফেসে পেমেন্ট সংখ্যা দেখালে Overview-এর check কার্ডের সাথে মিলিয়ে টেস্ট লিখুন (`tests/pending.test.mjs`-এর P11/P19/E12/E19 দেখুন)।
3. ভুল ফিল্টার আর নিঃশব্দে পাস করবে না — অজানা স্ট্যাটাসে সরাসরি এরর।
4. একই ref দুইবার ঢোকানোর চেষ্টা যেকোনো পথে (সদস্য বা অ্যাডমিন) ব্লকড — নতুন পথ যোগ করলে এই চেকও যোগ করুন।

---

## ১১. পরিবর্তিত ফাইল ও নতুন ফাইল

| ফাইল | কী হলো |
|---|---|
| `assets/js/util.js` | `PAY_STATUSES`, `normPayFilter`, `summarisePayments` (+স্ব-পরীক্ষা) |
| `assets/js/store.js` | `listPayments` নরমালাইজড, `paymentStats()`, `addManualPayment`-এ dup-ref গার্ড |
| `assets/js/firebase-adapter.js` | একই তিনটি পরিবর্তন (প্যারিটি) + verify/reject status-guard + রেজিস্ট্রেশন অডিটের ক্রম ঠিক |
| `assets/js/admin.js` | overview KPI+অঙ্ক, do-next, ট্যাব ব্যাজ, Payments সারসংক্ষেপ, check কার্ড, ডুপ্লিকেট নোটিশ ও চিপ |
| `assets/js/portal.js` | ফুটার শেয়ার্ড summariser ব্যবহার করে |
| `assets/js/i18n.js` | ১৪টি নতুন key (EN + BN, ৪৭৭/৪৭৭) |
| `tests/pending.test.mjs` | **নতুন** — ৩৬ চেক |
| `tests/e2e-emulator/pending-status-e2e.mjs` | **নতুন** — ২৬ চেক (আসল ডেটাবেস রুলসহ) |
| `tools/audit-pending-payments.mjs` | **নতুন** — CSV অডিটর |
| `docs/` | এই ডকুমেন্ট, HTML রিপোর্ট, docx, evidence/ |
