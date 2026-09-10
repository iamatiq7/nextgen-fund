# Firebase সেটআপ (বাংলা গাইড) — অ্যাডমিনের পরিবর্তন সব ডিভাইসে স্থায়ীভাবে দেখানোর জন্য

## কেন এটা দরকার

GitHub Pages শুধু ওয়েবসাইটের ফাইল দেখায় — নিজে কোনো ডেটাবেস চালায় না। তাই এখন
সাইটটা **ডেমো মোডে** চলে: প্রতিটি ব্রাউজার নিজের কপি নিজের কাছে রাখে। ফলে অ্যাডমিন এক
ব্রাউজারে যা পরিবর্তন করেন, অন্য ব্রাউজার/মোবাইলে দেখা যায় না।

সমাধান: **Firebase** (Google-এর ফ্রি সার্ভিস, Spark প্ল্যান — পরিবারের ফান্ডের জন্য
যথেষ্ট)। একবার জুড়লে:
- অ্যাডমিন **যেকোনো জায়গা থেকে** পরিবর্তন করলে সবার কাছে সাথে সাথে আপডেট হয়
- সব ডেটা **স্থায়ীভাবে** Google-এর সার্ভারে সেভ থাকে (ব্রাউজার বদলালেও হারায় না)
- সাইটের কোডে কোনো মাসিক খরচ নেই, নতুন সার্ভার চালাতে হয় না

সাইটটা আগে থেকেই Firebase-এর জন্য প্রস্তুত — মাত্র ৬টি মান (config) দিলেই চালু হয়ে যায়।

---

## ধাপ ১ — Firebase প্রজেক্ট তৈরি করুন (৫ মিনিট)

1. নিজের Google অ্যাকাউন্ট দিয়ে যান: <https://console.firebase.google.com>
2. **Create a project / Add project** ক্লিক করুন
3. নাম দিন: `nextgen-fund` → Continue
4. **Google Analytics: Disable** রাখুন (দরকার নেই) → **Create project**
5. প্রজেক্ট তৈরি হলে **Continue** ক্লিক করুন

## ধাপ ২ — Web app যোগ করে ৬টি মান কপি করুন

1. প্রজেক্টের হোম পেজে **`</>`** (Web) আইকনে ক্লিক করুন
2. Nickname: `NextGen Fund` → **Register app** (Hosting টিক দিতে হবে না)
3. স্ক্রিনে একটা `firebaseConfig` কোড দেখাবে — এই রকম:

```js
const firebaseConfig = {
  apiKey: "AIzaSy....",
  authDomain: "nextgen-fund.firebaseapp.com",
  projectId: "nextgen-fund",
  storageBucket: "nextgen-fund.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123def456"
};
```

4. **এই ৬টি মান কপি করে রাখুন** (apiKey, authDomain, projectId, storageBucket,
   messagingSenderId, appId)

> **সবচেয়ে সহজ রাস্তা:** এই ৬টি মান **আমাকে (AutoClaw চ্যাটে) পাঠিয়ে দিন** — আমি
> `firebase-config.js`-এ বসিয়ে, টেস্ট করে, GitHub-এ push করে দেব। নিজে করতে চাইলে
> নিচের ধাপ ৩–৮ অনুসরণ করুন।

## ধাপ ৩ — Firestore Database তৈরি (মূল ডেটাবেস)

1. বাম মেনু → **Build → Firestore Database → Create database**
2. **Production mode** বেছে নিন
3. Region: **asia-south1 (Mumbai)** — বাংলাদেশের জন্য দ্রুততম
4. **Enable** ক্লিক করুন
5. **Rules** ট্যাবে যান → সব মুছে এই রিপোর `firestore.rules` ফাইলের পুরো কনটেন্ট
   পেস্ট করুন → **Publish**
   (ফাইলটা এখানে: <https://github.com/iamatiq7/nextgen-fund/blob/main/firestore.rules>)

## ধাপ ৪ — Storage তৈরি (রেজিস্ট্রেশনের ছবি/ডকুমেন্টের জন্য)

1. বাম মেনু → **Build → Storage → Get started** → Production mode → একই region → Enable
2. **Rules** ট্যাবে নিচের রুল পেস্ট করে **Publish** করুন:

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

## ধাপ ৫ — Authentication চালু করুন

1. বাম মেনু → **Build → Authentication → Get started**
2. **Email/Password** সিলেক্ট করে **Enable** → Save
3. **Settings → Authorized domains** → **Add domain** → `iamatiq7.github.io` লিখে যোগ করুন
   (না দিলে লাইভ সাইট থেকে লগইন কাজ করবে না)

## ধাপ ৬ — কনফিগ সাইটে বসানো

**আমাকে পাঠালে:** চ্যাটে ৬টি মান দিন → আমি `assets/js/firebase-config.js`-এ বসিয়ে
GitHub-এ push করব → প্রায় ১ মিনিটে সাইট লাইভ মোডে চলে যাবে → আমি নিজে টেস্ট করে জানাব।

**নিজে করলে:**
1. `assets/js/firebase-config.js` খুলুন — প্রতিটি খালি `""`-এর জায়গায় ধাপ ২-এর মান বসান
2. সেভ করে: `git add -A && git commit -m "connect firebase" && git push`
3. ~১ মিনিট অপেক্ষা করে সাইটে **Ctrl+F5** (হার্ড রিফ্রেশ)
4. হেডারে আগে **Demo** লেখা ছিল, এখন **Live** দেখাবে — এটাই চালু হওয়ার প্রমাণ

## ধাপ ৭ — লাইভ মোডে প্রথম সেটআপ

লাইভ মোডে ডেমোর মতো আগে থেকে কোনো ডেটা থাকে না (একদম পরিষ্কার খাতা শুরু হয়):

1. সাইটে `setup.html` খুলুন → অ্যাডমিন অ্যাকাউন্ট তৈরি করুন (username `admin`,
   আপনার নাম, ইমেইল, শক্তিশালী পাসওয়ার্ড — ১২+ অক্ষর)। একবার তৈরি হলে আর কেউ নিজেকে
   অ্যাডমিন বানাতে পারবে না
2. **Admin → Settings**: আসল bKash/Nagad/Rocket/Upay নাম্বার, ব্যাংক হিসাব, পরের
   মিটিংয়ের তারিখ সেট করুন — এবার এগুলো **সবার কাছে স্থায়ীভাবে** দেখাবে
3. **Admin → Members**: প্রতিজন ভাইকে এড করুন (নাম, শেয়ার সংখ্যা — মাসিক কিস্তি নিজে
   থেকে হিসাব হবে; শেয়ার × ১,০০০ টাকা)
4. **Admin → Payments → Record payment manually**: জানুয়ারি–সেপ্টেম্বরের পুরনো
   জমাগুলো এন্ট্রি করুন (xlsx অনুযায়ী মোট ৳১,৬২,০০০) — Verify হওয়ার সাথে সাথে ব্যালেন্স
   আপডেট হবে
5. **Admin → Finance**: প্রতি মাসের Funding এন্ট্রি (জানু ২১,০০০ … সেপ্ট ৭,০০০) দিলে
   পাবলিক ড্যাশবোর্ডের হিসাব ঠিক হবে

## ধাপ ৮ — যাচাই

- একটা টেস্ট মেম্বার রেজিস্টার করুন → Admin → Registrations-এ ডকুমেন্টসহ দেখা যাবে → Accept
- মেম্বার দিয়ে লগইন → পেমেন্ট সাবমিট → অ্যাডমিন Verify → ব্যালেন্স আপডেট হওয়া যাচাই করুন
- অন্য একটা ফোন/ব্রাউজার থেকে দেখুন — সব একই ডেটা দেখাবে (এটাই মূল লক্ষ্য)

## সমস্যা হলে

| সমস্যা | সমাধান |
|---|---|
| লগইনে "auth/unauthorized-domain" | Authentication → Settings → Authorized domains-এ `iamatiq7.github.io` যোগ করুন |
| রেজিস্ট্রেশন হয় কিন্তু ডকুমেন্ট নেই | Storage তৈরি না হয়ে থাকলে, বা Storage rules Publish করা হয়নি |
| "Missing or insufficient permissions" | Firestore rules Publish করা হয়নি, বা setup.html দিয়ে অ্যাডমিন তৈরি করা হয়নি |
| সাইট এখনো "Demo mode" দেখায় | firebase-config.js-এর মান ঠিকমতো বসেনি বা push হয়নি; Ctrl+F5 দিন |

## রোলব্যাক

লাইভ মোডে গেলে ফিরে যেতে চাইলে: `firebase-config.js`-এর মানগুলো আবার খালি `""` করে
push করুন — সাইট আবার ডেমো মোডে ফিরে যাবে (Firebase-এ সেভ হওয়া ডেটা নষ্ট হয় না)।
ডেটার ব্যাকআপ: **Admin → Export** থেকে তিনটি CSV নামিয়ে রাখুন।

## খরচ

- Firebase **Spark প্ল্যান সম্পূর্ণ ফ্রি** — একটি পরিবারিক ফান্ডের ব্যবহারের জন্য
  ফ্রি লিমিট অনেক গুণ বেশি (১ জিবি ডেটা, ৫০ হাজার রিড/দিন)
- GitHub Pages-ও ফ্রি — মোট খরচ **৳০/মাস**
