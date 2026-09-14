/* Builds the emulator harness from the REAL adapter.
   Only the four SDK import URLs are rewritten to local shims; all other code is untouched. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.resolve(here, '..', '..', 'assets', 'js', 'firebase-adapter.js');

const shims = {
  'shim-app.mjs': "export * from 'firebase/app';\n",
  'shim-auth.mjs':
    "import * as A from 'firebase/auth';\n" +
    "export * from 'firebase/auth';\n" +
    "let done = false;\n" +
    "export function getAuth(app) {\n" +
    "  const a = A.getAuth(app);\n" +
    "  if (!done) { done = true; try { A.connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true }); } catch (e) { console.warn('auth emu:', e && e.message); } }\n" +
    "  return a;\n" +
    "}\n",
  'shim-firestore.mjs':
    "import * as F from 'firebase/firestore';\n" +
    "export * from 'firebase/firestore';\n" +
    "let done = false;\n" +
    "export function getFirestore(app) {\n" +
    "  const db = F.getFirestore(app);\n" +
    "  if (!done) { done = true; try { F.connectFirestoreEmulator(db, '127.0.0.1', 8080); } catch (e) { console.warn('fs emu:', e && e.message); } }\n" +
    "  return db;\n" +
    "}\n",
  'shim-storage.mjs': "export * from 'firebase/storage';\n"
};
for (const [name, body] of Object.entries(shims)) fs.writeFileSync(path.join(here, name), body);

const pairs = [
  ["appMod = await import(V + '/firebase-app.js')", "appMod = await import('./shim-app.mjs')"],
  ["authMod = await import(V + '/firebase-auth.js')", "authMod = await import('./shim-auth.mjs')"],
  ["fsMod = await import(V + '/firebase-firestore.js')", "fsMod = await import('./shim-firestore.mjs')"],
  ["stMod = await import(V + '/firebase-storage.js')", "stMod = await import('./shim-storage.mjs')"]
];
let src = fs.readFileSync(adapterPath, 'utf8');
for (const [a, b] of pairs) {
  if (src.split(a).length - 1 !== 1) throw new Error('anchor not found exactly once: ' + a);
  src = src.replace(a, b);
}
fs.writeFileSync(path.join(here, 'adapter-live.js'), src);

if (!fs.existsSync(path.join(here, 'firebase.json'))) {
  fs.writeFileSync(path.join(here, 'firebase.json'),
    JSON.stringify({ firestore: { rules: '../../firestore.rules' }, emulators: { auth: { port: 9099 }, firestore: { port: 8080 } } }, null, 2) + '\n');
}
console.log('harness built from', adapterPath);
