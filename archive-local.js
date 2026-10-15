// Verschlüsseltes, browserlokales Testarchiv. Der Schlüssel bleibt nur im Arbeitsspeicher.
(function (root) {
  const databaseName = 'juwelier-goek-testarchiv-v1';
  const iterations = 310000;
  const marker = 'JUWELIER-GOEK-ARCHIV-V1';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let unlockedKey = null;
  let databasePromise;
  let lockGeneration = 0;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Archivzugriff abgebrochen.'));
    });
  }

  function database() {
    if (!root.indexedDB || !root.crypto?.subtle) throw new Error('Das verschlüsselte Archiv wird von diesem Browser nicht unterstützt.');
    databasePromise ??= new Promise((resolve, reject) => {
      const request = root.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('config', { keyPath: 'id' });
        db.createObjectStore('receipts', { keyPath: 'number' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Das Archiv ist in einem anderen Tab geöffnet.'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function read(storeName, key) {
    const db = await database();
    return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function all(storeName) {
    const db = await database();
    return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function write(storeName, method, value) {
    const db = await database();
    const transaction = db.transaction(storeName, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(storeName)[method](value);
    await done;
  }

  async function deriveKey(passphrase, salt) {
    const baseKey = await root.crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function seal(key, bytes, context) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, bytes);
    return { iv, data };
  }

  async function unseal(key, sealed, context) {
    return root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(context) }, key, sealed.data);
  }

  async function isConfigured() { return Boolean(await read('config', 'main')); }
  function isUnlocked() { return Boolean(unlockedKey); }
  function lock() { unlockedKey = null; lockGeneration++; }

  async function unlock(passphrase, confirmation = '') {
    if (typeof passphrase !== 'string' || !passphrase) throw new Error('Bitte das Archiv-Passwort eingeben.');
    const generation = lockGeneration;
    const config = await read('config', 'main');
    if (config) {
      const key = await deriveKey(passphrase, config.salt);
      try {
        const value = decoder.decode(await unseal(key, config.verifier, 'archiv-pruefung'));
        if (value !== marker) throw new Error();
      } catch { throw new Error('Das Archiv-Passwort ist nicht richtig.'); }
      if (generation !== lockGeneration) throw new Error('Archivöffnung wurde abgebrochen.');
      unlockedKey = key;
      return { created: false };
    }
    if (passphrase.length < 12) throw new Error('Bitte mindestens 12 Zeichen für das neue Archiv-Passwort verwenden.');
    if (passphrase !== confirmation) throw new Error('Die beiden Passwörter stimmen nicht überein.');
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt);
    const verifier = await seal(key, encoder.encode(marker), 'archiv-pruefung');
    if (generation !== lockGeneration) throw new Error('Archivöffnung wurde abgebrochen.');
    await write('config', 'add', { id: 'main', salt, verifier });
    if (generation !== lockGeneration) throw new Error('Archivöffnung wurde abgebrochen.');
    unlockedKey = key;
    return { created: true };
  }

  async function save(number, metadata, pdfBytes) {
    if (!unlockedKey) throw new Error('Bitte das Archiv zuerst entsperren.');
    const key = unlockedKey;
    if (!/^JG-\d{8}-[A-F0-9]{12}$/.test(number)) throw new Error('Ungültige Belegnummer.');
    if (await read('receipts', number)) throw new Error('Dieser Beleg ist bereits archiviert. Für einen neuen Beleg die Seite neu laden.');
    const meta = await seal(key, encoder.encode(JSON.stringify(metadata)), `${number}:meta`);
    const pdf = await seal(key, pdfBytes, `${number}:pdf`);
    await write('receipts', 'add', { number, meta, pdf });
  }

  async function list() {
    if (!unlockedKey) throw new Error('Bitte das Archiv zuerst entsperren.');
    const key = unlockedKey;
    const records = await all('receipts');
    const items = await Promise.all(records.map(async record => ({
      number: record.number,
      ...JSON.parse(decoder.decode(await unseal(key, record.meta, `${record.number}:meta`)))
    })));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function pdf(number) {
    if (!unlockedKey) throw new Error('Bitte das Archiv zuerst entsperren.');
    const key = unlockedKey;
    const record = await read('receipts', number);
    if (!record) throw new Error('Beleg nicht gefunden.');
    return new Uint8Array(await unseal(key, record.pdf, `${number}:pdf`));
  }

  async function remove(number) {
    if (!unlockedKey) throw new Error('Bitte das Archiv zuerst entsperren.');
    const db = await database();
    const transaction = db.transaction('receipts', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('receipts').delete(number);
    await done;
  }

  function newNumber(now = new Date()) {
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const random = Array.from(root.crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `JG-${date}-${random}`;
  }

  const api = { isConfigured, isUnlocked, lock, unlock, save, list, pdf, remove, newNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = { ...api, _crypto: { deriveKey, seal, unseal } };
  else root.BelegArchive = api;
})(typeof window === 'undefined' ? globalThis : window);
