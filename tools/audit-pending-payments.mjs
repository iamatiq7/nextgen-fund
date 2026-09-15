/* NextGen Fund - offline payment-ledger auditor.
   Reads the CSV produced by Admin -> Export -> "Payments CSV" and reports every
   record that needs attention, without touching the database (read-only).

   Usage:
     node tools/audit-pending-payments.mjs nextgen-payments-2026-09-14.csv [--days 7]

   Exit code 0 = clean, 1 = attention needed (safe to use in a cron/monitor job). */
import fs from 'fs';

const file = process.argv[2];
const daysArg = process.argv.indexOf('--days');
const STUCK_DAYS = daysArg > 0 ? Number(process.argv[daysArg + 1]) || 7 : 7;

if (!file) {
  console.error('usage: node tools/audit-pending-payments.mjs <payments.csv> [--days 7]');
  process.exit(2);
}

/* ---------- tiny CSV reader (handles quotes, commas inside fields, CRLF) ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

if (!fs.existsSync(file)) { console.error('cannot find the CSV: ' + file); process.exit(2); }
const raw = fs.readFileSync(file, 'utf8');
const rows = parseCSV(raw);
if (!rows.length) { console.error('empty file'); process.exit(2); }
const header = rows[0].map((h) => h.trim());
const need = ['id', 'paymentDate', 'memberName', 'username', 'type', 'method', 'amount', 'transactionRef', 'status'];
for (const col of need) {
  if (!header.includes(col)) { console.error('missing column in CSV: ' + col + ' | header = ' + header.join(',')); process.exit(2); }
}
const idx = {};
header.forEach((h, i) => { idx[h] = i; });
const rec = rows.slice(1).map((r) => {
  const o = {};
  header.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : String(r[i])).trim(); });
  o.amountNum = Number(o.amount) || 0;
  return o;
});

const fmt = (n) => '\u09F3' + Number(n).toLocaleString('en-US');
const badge = (s) => (s === 'pending' ? 'PENDING' : s === 'verified' ? 'verified' : s === 'rejected' ? 'rejected' : String(s).toUpperCase());

/* ---------- 1. buckets ---------- */
const buckets = { pending: { n: 0, amt: 0 }, verified: { n: 0, amt: 0 }, rejected: { n: 0, amt: 0 }, other: { n: 0, amt: 0 } };
for (const r of rec) {
  const b = buckets[r.status] || buckets.other;
  b.n++; b.amt += r.amountNum;
}
const total = rec.reduce((a, r) => a + r.amountNum, 0);
const bucketSum = Object.values(buckets).reduce((a, b) => a + b.amt, 0);

console.log('== ledger =================================================');
console.log('  rows: ' + rec.length);
for (const k of ['pending', 'verified', 'rejected', 'other']) {
  if (buckets[k].n) console.log('  ' + badge(k).padEnd(9) + String(buckets[k].n).padStart(4) + ' rows   ' + fmt(buckets[k].amt));
}
console.log('  total recorded: ' + fmt(total));

const problems = [];
if (bucketSum !== total) problems.push('bucket amounts do not add up to the total (' + bucketSum + ' vs ' + total + ')');

/* ---------- 2. stuck pending rows ---------- */
const now = Date.now();
const stuck = rec.filter((r) => {
  if (r.status !== 'pending') return false;
  const t = Date.parse(r.submittedAt || r.paymentDate || '');
  return Number.isFinite(t) ? (now - t) / 86400000 > STUCK_DAYS : false;
});
console.log('== pending older than ' + STUCK_DAYS + ' days ========================');
if (!stuck.length) console.log('  none - nothing is waiting too long');
stuck
  .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
  .forEach((r) => {
    const age = Math.round((now - Date.parse(r.submittedAt || r.paymentDate)) / 86400000);
    console.log('  ' + badge(r.status) + '  ' + String(r.username).padEnd(22) + fmt(r.amountNum).padStart(9) + '  ref ' + (r.transactionRef || '-') + '  ' + age + ' days old');
  });
if (stuck.length) problems.push(stuck.length + ' pending payment(s) older than ' + STUCK_DAYS + ' days need a decision (verify or reject)');

/* ---------- 3. duplicate references ---------- */
const seen = new Map();
for (const r of rec) {
  const ref = String(r.transactionRef || '').trim().toLowerCase();
  if (!ref || r.status === 'rejected') continue;
  const key = String(r.username || r.memberName) + '|' + String(r.method) + '|' + ref;
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(r);
}
const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
console.log('== duplicate references ==================================');
if (!dups.length) console.log('  none');
dups.forEach(([key, list]) => {
  const amt = list.reduce((a, r) => a + r.amountNum, 0);
  console.log('  ' + key + '  x' + list.length + '  ' + fmt(amt) + '  [' + list.map((r) => badge(r.status)).join(', ') + ']');
  console.log('      ids: ' + list.map((r) => r.id).join(', '));
});
if (dups.length) problems.push(dups.length + ' reference(s) appear more than once - money may be counted twice (' + fmt(dups.reduce((a, [, v]) => a + v.reduce((x, r) => x + r.amountNum, 0), 0)) + ' at risk)');

/* ---------- 4. audit gaps on verified rows ---------- */
const noAudit = rec.filter((r) => r.status === 'verified' && (!r.verifiedAt || !r.verifiedBy));
console.log('== verified rows without an audit stamp ===================');
if (!noAudit.length) console.log('  none - every verified payment records who and when');
noAudit.slice(0, 10).forEach((r) => console.log('  ' + String(r.username).padEnd(22) + fmt(r.amountNum).padStart(9) + '  ref ' + (r.transactionRef || '-') + '  verifiedAt="' + r.verifiedAt + '" verifiedBy="' + r.verifiedBy + '"'));
if (noAudit.length) problems.push(noAudit.length + ' verified payment(s) have no verifiedAt/verifiedBy stamp');

/* ---------- 5. amounts that break the 1,000 rule ---------- */
const badAmount = rec.filter((r) => r.amountNum <= 0 || r.amountNum % 1000 !== 0);
console.log('== amounts that are not a positive multiple of 1,000 ======');
if (!badAmount.length) console.log('  none');
badAmount.slice(0, 10).forEach((r) => console.log('  ' + String(r.username).padEnd(22) + '  ' + r.amount + '  ref ' + (r.transactionRef || '-')));
if (badAmount.length) problems.push(badAmount.length + ' payment(s) have an amount that is not a positive multiple of 1,000');

/* ---------- 6. per-member pending summary ---------- */
const perMember = new Map();
for (const r of rec) {
  if (r.status !== 'pending') continue;
  const k = String(r.username || r.memberName);
  const o = perMember.get(k) || { n: 0, amt: 0 };
  o.n++; o.amt += r.amountNum;
  perMember.set(k, o);
}
console.log('== pending per member ====================================');
if (!perMember.size) console.log('  nobody has a pending payment');
[...perMember.entries()].sort((a, b) => b[1].amt - a[1].amt).forEach(([k, v]) => console.log('  ' + k.padEnd(22) + String(v.n).padStart(3) + ' rows   ' + fmt(v.amt)));

/* ---------- verdict ---------- */
console.log('=========================================================');
console.log('rows checked: ' + rec.length);
if (!problems.length) {
  console.log('AUDIT VERDICT: CLEAN - no stuck pending rows, no duplicates, the ledger adds up.');
  process.exit(0);
}
console.log('AUDIT VERDICT: ' + problems.length + ' finding(s):');
problems.forEach((p, i) => console.log('  ' + (i + 1) + '. ' + p));
console.log('Fix them in Admin -> Payments (verify or reject the extra rows) and re-run this audit.');
process.exit(1);
