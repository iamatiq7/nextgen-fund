#!/usr/bin/env node
/**
 * firebase-incidents.mjs - analyse the Firebase-specific public incident feed.
 * Figures out how often Hosting / Firestore / Authentication have had published incidents.
 * usage: node firebase-incidents.mjs <out.txt>
 */
import fs from 'node:fs';

const OUT = process.argv[2] || 'firebase-incidents.txt';
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

const res = await fetch('https://status.firebase.google.com/incidents.json', { headers: { 'user-agent': 'uptime-evidence/1.0' } });
const data = await res.json();
const now = new Date();
const day = (d) => new Date(d).toISOString().slice(0, 10);

say('=== Firebase incident history (status.firebase.google.com/incidents.json) ===');
say(`collected : ${now.toISOString()}`);
say(`http      : ${res.status}   records: ${data.length}`);
const begins = data.map((i) => new Date(i.begin)).filter((d) => !Number.isNaN(d));
const ends = data.filter((i) => i.end).map((i) => new Date(i.end));
begins.sort((a, b) => a - b);
say(`window    : ${day(begins[0])} -> ${day(begins[begins.length - 1])}  (${Math.round((now - begins[0]) / 86400000)} days of history in this feed)`);
say('');

// service / product tagging
const svc = new Map();
const prod = new Map();
for (const i of data) {
  const s = i.service_name || '(untagged)';
  svc.set(s, (svc.get(s) || 0) + 1);
  for (const p of i.affected_products || []) {
    const t = (p.title || p.id || '').trim();
    if (t) prod.set(t, (prod.get(t) || 0) + 1);
  }
}
say('--- incidents by Firebase service ---');
[...svc.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => say(`  ${String(v).padStart(4)}x  ${k}`));
say('');
say('--- incidents by affected product (top 20) ---');
[...prod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => say(`  ${String(v).padStart(4)}x  ${k}`));
say('');

const match = (kw) => data.filter((i) => JSON.stringify(i).toLowerCase().includes(kw));
for (const kw of ['hosting', 'firestore', 'authentication', 'identity platform']) {
  const hits = match(kw);
  say(`--- incidents mentioning "${kw}": ${hits.length} ---`);
  const dur = hits.map((i) => (i.end ? (new Date(i.end) - new Date(i.begin)) / 60000 : null)).filter((x) => x !== null);
  if (dur.length) {
    const sum = dur.reduce((a, b) => a + b, 0);
    say(`    total published duration: ${Math.round(sum)} minutes over ${dur.length} closed incidents (mean ${(sum / dur.length).toFixed(0)} min, longest ${Math.round(Math.max(...dur))} min)`);
  }
  hits.slice(0, 5).forEach((i) => {
    const mins = i.end ? Math.round((new Date(i.end) - new Date(i.begin)) / 60000) + ' min' : 'ongoing';
    say(`    [${day(i.begin)}] ${mins.padEnd(9)} ${(i.external_desc || i.service_name || '').replace(/\s+/g, ' ').slice(0, 150)}`);
  });
  say('');
}

const avail = (kw, windowDays) => {
  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  const hits = match(kw).filter((i) => new Date(i.begin) >= cutoff);
  const down = hits.reduce((a, i) => a + ((i.end ? new Date(i.end) : now) - new Date(i.begin)), 0);
  const total = windowDays * 86400000;
  return { incidents: hits.length, downMinutes: Math.round(down / 60000), impliedUptime: ((1 - down / total) * 100).toFixed(4) };
};
say('--- rough availability implied by published incidents (last 180 days) ---');
for (const kw of ['hosting', 'firestore', 'authentication']) {
  const a = avail(kw, 180);
  say(`  ${kw.padEnd(15)} incidents: ${String(a.incidents).padStart(3)}   published downtime: ${String(a.downMinutes).padStart(5)} min   implied uptime: ${a.impliedUptime}%`);
}
say('');
say('--- caveats ---');
say('* This is the published-incident feed, not a per-request measurement. Incidents shorter than');
say('  Google threshold, or that never got a public entry, are not counted.');
say('* Durations are the published start/end of the incident, which is wider than the moment any one');
say('  user was affected; treating all of it as downtime for everyone understates real-world uptime.');
say('* Some incidents overlap in time, so the minutes must not be summed across products.');
say('* The contractual promise is the SLA (Hosting 99.95%, Firestore multi-region 99.999%), not this table.');

fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + OUT);
