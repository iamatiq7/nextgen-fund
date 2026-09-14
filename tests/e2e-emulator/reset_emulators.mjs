/* Wipe emulator state so the E2E always starts from a clean fund */
const urls = [
  'http://127.0.0.1:8080/emulator/v1/projects/demo-nextgen-fund/databases/(default)/documents',
  'http://127.0.0.1:9099/emulator/v1/projects/demo-nextgen-fund/accounts'
];
for (const u of urls) {
  try { const r = await fetch(u, { method: 'DELETE' }); console.log('reset', r.status, u.split('/emulator')[0]); }
  catch (e) { console.log('reset failed', u, e.message); }
}
