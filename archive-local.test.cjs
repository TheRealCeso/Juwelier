const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
const archive = require('./archive-local.js');

(async () => {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await archive._crypto.deriveKey('Ein langes Testpasswort 2026', salt);
  const wrongKey = await archive._crypto.deriveKey('Ein anderes Testpasswort', salt);
  const original = new Uint8Array([0, 255, 37, 19, 204, 18]);
  const encrypted = await archive._crypto.seal(key, original, 'JG-20261015-ABCDEF123456:pdf');
  assert.deepEqual(new Uint8Array(await archive._crypto.unseal(key, encrypted, 'JG-20261015-ABCDEF123456:pdf')), original);
  await assert.rejects(archive._crypto.unseal(wrongKey, encrypted, 'JG-20261015-ABCDEF123456:pdf'));
  await assert.rejects(archive._crypto.unseal(key, encrypted, 'JG-20261015-000000000000:pdf'));
  assert.match(archive.newNumber(new Date('2026-10-15T12:00:00')), /^JG-20261015-[A-F0-9]{12}$/);
  console.log('Archiv-Verschlüsselung, falsches Passwort und Belegnummer: 4 Fälle bestanden.');
})().catch(error => { console.error(error); process.exitCode = 1; });
