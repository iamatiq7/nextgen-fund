#!/usr/bin/env node
/**
 * uptime-evidence.mjs - what does the official Google Cloud / Firebase status feed actually say?
 * Pulls the public incident history and summarises the ones that touch Firebase/Firestore/Hosting.
 * usage: node uptime-evidence.mjs <out.txt>
 */
import fs from 'node:fs';

const OUT = process.argv[2] || 'uptime-evidence.txt';
const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

say('=== official incident history (public status feed) ===');
say(`collected : ${new Date().toISOString()}`);
say('');

async function incidents(url, label) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'uptime-evidence/1.0' } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { say(`${label}: not JSON (${res.status}) - first 120 chars: ${text.slice(0, 120)}`); return []; }
    say(`${label}: http ${res.status}, ${data.length} incident records returned`);
    return data;
  } catch (e) {
    say(`${label}: fetch failed - ${e.message}`);
    return [];
  }
}

const gcloud = await incidents('https://status.cloud.google.com/incidents.json', 'status.cloud.google.com/incidents.json');
say('');

const KEYWORDS = ['firestore', 'firebase', 'hosting', 'identity platform', 'cloud identity', 'gcp console'];
const interesting = gcloud.filter((i) => {
  const blob = JSON.stringify(i.affected_products || []) + ' ' + (i.external_desc || '') + ' ' + (i.service_name || '');
  return KEYWORDS.some((k) => blob.toLowerCase().includes(k));
});

say(`--- incidents mentioning Firebase / Firestore / Hosting / Identity: ${interesting.length} ---`);
const recent = interesting.slice(0, 12);
for (const i of recent) {
  const products = (i.affected_products || []).map((p) => p.title || p.id).join('; ');
  say(`[${i.begin || '?'}] severity=${i.severity || '-'}  ${i.service_name || ''} ${products ? '| ' + products : ''}`);
  say(`   ${(i.external_desc || '').slice(0, 220).replace(/\s+/g, ' ')}`);
}
say('');

// how many days does the feed cover?
const begins = gcloud.map((i) => i.begin).filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b);
if (begins.length) {
  say(`feed window: earliest incident ${begins[0].toISOString()} -> latest ${begins[begins.length - 1].toISOString()} (${Math.round((Date.now() - begins[0]) / 86400000)} days)`);
}
say('');
say('--- method note ---');
say('This is the same public feed the Google Cloud status page renders. It lists incidents that');
say('Google judged worth publishing; short blips that never reached that bar are not in it, so the');
say('absence of an entry is not proof that nothing degraded. It is evidence about published outages.');
say('Firebase-specific view: https://status.firebase.google.com (same underlying incidents).');

fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.log('saved: ' + OUT);
