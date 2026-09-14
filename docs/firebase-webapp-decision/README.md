# firebase-webapp-decision — `web.app` ব্যবহার করা কি ঠিক?

**প্রশ্ন (মালিকের):** "Firebase-এর `web.app` ব্যবহার করলে কোনো চ্যালেঞ্জ হবে? এটা কি সবসময় লাইভ থাকবে — ডাউন হওয়ার সুযোগ নেই? আমার ডেটা কি নিরাপদ থাকবে?"

## সোজা উত্তর

| প্রশ্ন | উত্তর |
| --- | --- |
| ১. `web.app`-এ চ্যালেঞ্জ? | **হ্যাঁ, আছে** — ব্র্যান্ডিং, SEO, শেয়ারযোগ্যতা, `authDomain` আলাদা, ভবিষ্যতের মাইগ্রেশন (১২টি পয়েন্ট)। **কিন্তু কোনো প্রযুক্তিগত blocker নয়।** |
| ২. সবসময় লাইভ? | **না — "কখনো ডাউন হবে না" এই নিশ্চয়তা কেউ দিতে পারে না।** Hosting SLA **৯৯.৯৫%** (মাসে ~২১.৯ মিনিট অনুমোদিত downtime), Firestore multi-region ৯৯.৯৯৯%। বাস্তব ঝুঁকি মূলত নিজের ভুল ডিপ্লয়, কোটা, বিলিং ও DNS। |
| ৩. ডেটা নিরাপদ? | **শর্তসহ হ্যাঁ।** TLS 1.3, রেস্টে স্বয়ংক্রিয় এনক্রিপশন, rules ডিফল্ট-ডিনাই — **৩১/৩১ টেস্ট PASS**, live-এ anonymous পড়া 403, **restore drill ৭৭/৭৭ PASS**। |

## এই ফোল্ডারে কী আছে

| ফাইল | কী |
| --- | --- |
| [`nextgen-fund-webapp-decision.md`](nextgen-fund-webapp-decision.md) | পূর্ণ সিদ্ধান্ত ডকুমেন্ট (Markdown) — সব সোর্স, ঝুঁকি ম্যাট্রিক্স, চেকলিস্ট, রানবুক, মাইগ্রেশন প্ল্যান |
| [`nextgen-fund-webapp-decision.html`](nextgen-fund-webapp-decision.html) | একই ডকুমেন্টের ডিজাইন করা সংস্করণ (প্রিসেট **04 Fathom Information Design**) — SLA ও incident চার্ট, ঝুঁকি ম্যাট্রিক্স, ফুটনোট-সোর্স |
| [`NextGen-Fund-webapp-decision.docx`](NextGen-Fund-webapp-decision.docx) | টিম/ক্লায়েন্টের সাথে শেয়ার করার Word সংস্করণ (১৪টি টেবিল) |
| [`evidence/`](evidence/) | কাঁচা প্রমাণ: ৩১-চেক rules suite, restore drill (সময়সহ), incident ফিড বিশ্লেষণ, live probe, সোর্স তালিকা |
| [`tools/`](tools/) | যাচাইয়ের স্ক্রিপ্ট — যে কেউ চালিয়ে ফল মিলিয়ে দেখতে পারবে |

## কীভাবে নিজে যাচাই করবেন

```powershell
# ১) নিরাপত্তা মডেল (emulator test project - live ডেটা ছোঁয়া হয় না)
cd .openclaw\tmp\rules-test ; $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node e2e\data-safety-check.mjs out.txt   # প্রত্যাশা: checks 31, pass 31, RESULT: ALL PASS

# ২) backup → wipe → restore drill (সময় মাপা হয়)
node e2e\restore-drill.mjs out.txt       # প্রত্যাশা: 77/77 হুবহু, RESULT: PASS

# ৩) আপটাইম ইতিহাস (অফিসিয়াল ফিড)
node docs\firebase-webapp-decision\tools\firebase-incidents.mjs out.txt
```

## সীমাবদ্ধতা (সৎভাবে)

- **করা হয়নি:** বাজেট অ্যালার্ট/স্পেন্ড-ক্যাপ সেট করা — এতে আপনার billing অ্যাকাউন্টে অনুমতি লাগে (এই কাজের আওতার বাইরে)। ধাপগুলো রিপোর্টে দেওয়া; এটিই একমাত্র অসম্পূর্ণ আইটেম।
- কোটা/বিলিং ইনসিডেন্ট ডেটা ও Firestore-এর ডেটাবেস লোকেশন console থেকেই দেখতে হবে — পাবলিক API মেলে না।
- incident ফিড প্রকাশিত ঘটনা ধরে; ছোট degradation বাদ পড়ে। তাই এটি "ঝুঁকি কম" এর প্রমাণ, "ঝুঁকি শূন্য" এর নয়।
- এই ডকুমেন্ট কোনো আইনি পরামর্শ বা SLA-র আইনি ব্যাখ্যা নয়।
