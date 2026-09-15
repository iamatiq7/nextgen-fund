#!/usr/bin/env node
/**
 * tls-dump.mjs - dump the TLS certificate chain / handshake facts for a host.
 * usage: node tls-dump.mjs <label> <host> [host...]
 * Appends the result to the evidence folder so repeated runs can be compared.
 */
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

const EVIDENCE = process.env.EVIDENCE_DIR;
const [label, ...hosts] = process.argv.slice(2);
const out = [];
const say = (s) => { out.push(s); console.log(s); };

function probe(host, servername) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername, rejectUnauthorized: false, timeout: 15000 }, () => {
      const cert = socket.getPeerCertificate(true);
      const lines = [];
      lines.push(`host=${host} sni=${servername || host}`);
      lines.push(`  negotiated protocol  : ${socket.getProtocol()}`);
      lines.push(`  cipher               : ${socket.getCipher()?.name} (${socket.getCipher()?.version})`);
      lines.push(`  authorized (trusted)  : ${socket.authorized} ${socket.authorizationError ? '| ' + socket.authorizationError : ''}`);
      lines.push(`  peer IP:port         : ${socket.remoteAddress}:${socket.remotePort}`);
      lines.push(`  leaf subject         : ${cert.subject?.CN} | O=${cert.subject?.O} | C=${cert.subject?.C}`);
      lines.push(`  leaf issuer          : ${cert.issuer?.CN} | O=${cert.issuer?.O} | C=${cert.issuer?.C}`);
      lines.push(`  validity             : ${cert.valid_from}  ->  ${cert.valid_to}`);
      lines.push(`  serial / fingerprint : ${cert.serialNumber} | sha256 ${cert.fingerprint256}`);
      lines.push(`  subjectAltName       : ${cert.subjectaltname}`);
      lines.push('  chain:');
      let c = cert;
      let depth = 0;
      const seen = new Set();
      while (c && !seen.has(c.fingerprint256) && depth < 6) {
        seen.add(c.fingerprint256);
        lines.push(`    [${depth}] CN=${c.subject?.CN} | issuer=${c.issuer?.CN} | O=${c.issuer?.O} | valid_to=${c.valid_to}`);
        c = c.issuerCertificate;
        depth += 1;
      }
      socket.end();
      resolve(lines.join('\n'));
    });
    socket.on('error', (e) => resolve(`host=${host} sni=${servername} ERROR: ${e.message}`));
    socket.on('timeout', () => { socket.destroy(); resolve(`host=${host} sni=${servername} TIMEOUT`); });
  });
}

say(`=== TLS handshake evidence - ${label} ===`);
say(`timestamp: ${new Date().toISOString()}`);
say('');
for (const h of hosts) {
  say(await probe(h.split('|')[0], h.split('|')[1] || h.split('|')[0]));
  say('');
}

if (EVIDENCE) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const f = path.join(EVIDENCE, `02-tls-${label}.txt`);
  fs.writeFileSync(f, out.join('\n') + '\n', 'utf8');
  console.log('saved: ' + f);
}
