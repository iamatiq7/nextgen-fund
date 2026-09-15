# রেজিস্টার ফর্ম পুনর্বিন্যাস — হস্তান্তর নোট (২০২৬-০৯-১৫)

## কী বদলেছে
ফর্মটি তিনটি স্পষ্ট ভাগে সাজানো হলো, আপনার বলা ক্রম অনুযায়ী:

1. **সদস্যের তথ্য** — পূর্ণ নাম · ইউজারনেম · ইমেইল · মোবাইল · বাবার নাম · মায়ের নাম · ঠিকানা · পেশা · শেয়ার · শুরু/join মাস · পাসওয়ার্ড · পাসওয়ার্ড (পুনরায়)
2. **নমিনি** — নমিনির নাম · নমিনির সাথে সম্পর্ক · নমিনির মোবাইল (ঐচ্ছিক) · নমিনির ঠিকানা
3. **ডকুমেন্ট (বাধ্যতামূলক, ক্রমিক নম্বরসহ)** — ১. Member's Picture · ২. Member's NID / Birth Certificate (front) · ৩. Member's NID / Birth Certificate (back) · ৪. Nominee's Picture

## অতিরিক্ত যা বাদ দেওয়া হলো (সেটিংস থেকে আসা পুরোনো ফিল্ড)
| বাদ দেওয়া আইটেম | আগের অবস্থান | কারণ |
|---|---|---|
| “Photo ID (NID / Birth Certificate)” ফিল্ড | ডকুমেন্ট তালিকার ৫ম ঘর | এখন “Member's NID / Birth Certificate” (front+back) নামে দুটি নির্দিষ্ট ফিল্ড আছে — এটি নকল; আগে এটিই ভুলে বাধ্যতামূলক গোনা হয়ে রেজিস্ট্রেশন আটকাত |
| “Passport-size Photograph” ফিল্ড | ডকুমেন্ট তালিকার ৬ষ্ঠ ঘর | “Member's Picture” ও “Nominee's Picture” দুটি আলাদা ফিল্ডে ভাগ হয়ে গেছে — এটি নকল |

ফলে ডকুমেন্ট ইনপুট এখন **ঠিক ৪টি** (আগে ৬টি)।

## কী বদলায়নি (নিরাপত্তা)
- ফিল্ডের id ও অভ্যন্তরীণ কী (profile-picture, nid-front, nid-back, nominee-passport-photo) হুবহু আগের মতো — ডেটাবেস, Drive ফোল্ডারের ফাইলনাম ও অ্যাডমিন ভিউ অপরিবর্তিত।
- কোনো ডেটা মুছে ফেলা বা বদলানো হয়নি; শুধু পর্দার বিন্যাস ও দেখানো ফিল্ড।
- আগের সংস্করণের কপি: ackup/register.html.before ও ackup/register.js.before (আগের কমিট 05964d9)।

## যাচাই
- এন্ড-টু-এন্ড: নতুন বিন্যাসে সম্পূর্ণ ফর্ম (৪ নথি + নতুন ফিল্ড) সাবমিট → error box = "", রেকর্ড সংরক্ষিত {status: pending, docs: [profile-picture, nid-front, nid-back, nominee-passport-photo], joinMonth: 2026-08, fatherName: "Father Name"} → সব চেক PASS
- আগে/পরে ক্রম: BEFORE = নাম, ইউজারনেম, ইমেইল, মোবাইল, পেশা, বাবা, মা, নমিনি… (মিশ্র) → AFTER = সদস্য → নমিনি → ১-৪ নম্বরযুক্ত ডকুমেন্ট
- ছবি: shots/before-desktop-1280.png · shots/before-mobile-390.png · shots/after-desktop-1280.png · shots/after-mobile-390.png
- টেস্ট স্যুট: registration-rules ALL PASS · store 61/61 · advance 32 · pending 36 · fixes · access — সব সবুজ

## ফিরিয়ে নেওয়ার ধাপ (রোলব্যাক)
1. git revert <commit> → push (অথবা)
2. ackup/register.html.before ও ackup/register.js.before ফাইল দুটি রিপোতে ফিরিয়ে বসিয়ে push, (অথবা)
3. Firebase Hosting → Release history → আগের রিলিজে Rollback

## ভবিষ্যতে বদলাতে হলে
- ফর্মের ক্রম/লেবেল: egister.html-এর <div class="grid form2"> ব্লকগুলো (তিন ভাগে)
- ডকুমেন্টের তালিকা/নাম/ক্রম: ssets/js/register.js-এর DOCS অ্যারে (ক্রমিক নম্বর স্বয়ংক্রিয়)
- লেখার অনুবাদ: ssets/js/i18n.js-এ eg.secMember, eg.secNominee, eg.secDocs ইত্যাদি
