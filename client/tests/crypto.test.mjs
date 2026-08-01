/**
 * Vault crypto tests.
 *
 * Encryption that silently does nothing is worse than none at all, so these
 * check the properties that actually matter: both sides derive the same key,
 * nobody else can, a wrong passphrase fails loudly, and tampered ciphertext is
 * rejected rather than decrypted into garbage.
 *
 * Run with: node client/tests/crypto.test.mjs
 */
let failures = 0;

function check(label, cond, extra) {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra)}` : ''}`);
}

async function throws(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const v = await import('../src/lib/crypto.js');

// --- identity keys ----------------------------------------------------------
const alice = await v.generateIdentityKeyPair();
const bob = await v.generateIdentityKeyPair();
const mallory = await v.generateIdentityKeyPair();

const alicePub = await v.exportPublicKey(alice);
const bobPub = await v.exportPublicKey(bob);

check('generates distinct keypairs', alicePub !== bobPub);
check('public key exports as base64 SPKI', /^[A-Za-z0-9+/]+=*$/.test(alicePub));

// --- key agreement ----------------------------------------------------------
const CONV = 'conversation-abc';

const aliceKey = await v.deriveConversationKey(
  alice.privateKey, await v.importPublicKey(bobPub), CONV,
);
const bobKey = await v.deriveConversationKey(
  bob.privateKey, await v.importPublicKey(alicePub), CONV,
);

// The real test of ECDH: encrypt with one side's derived key, decrypt with the
// other's. If the derivation disagreed, this fails.
const sealed = await v.encryptMessage(aliceKey, 'meet me at the usual place');
check('both sides derive the same key',
  (await v.decryptMessage(bobKey, sealed)) === 'meet me at the usual place');

// --- an outsider cannot read it ---------------------------------------------
const malloryKey = await v.deriveConversationKey(
  mallory.privateKey, await v.importPublicKey(alicePub), CONV,
);
check('a third party cannot decrypt', await throws(() => v.decryptMessage(malloryKey, sealed)));

// --- keys are scoped per conversation ---------------------------------------
const otherConvKey = await v.deriveConversationKey(
  alice.privateKey, await v.importPublicKey(bobPub), 'a-different-conversation',
);
check('a key from one conversation cannot open another',
  await throws(() => v.decryptMessage(otherConvKey, sealed)));

// --- ciphertext properties --------------------------------------------------
check('ciphertext does not contain the plaintext', !sealed.includes('usual place'));
check('ciphertext is recognisable', v.isCiphertext(sealed));
check('plaintext is not mistaken for ciphertext', !v.isCiphertext('hello there'));

const again = await v.encryptMessage(aliceKey, 'meet me at the usual place');
check('same plaintext encrypts differently each time (fresh IV)', again !== sealed);
check('...and both still decrypt',
  (await v.decryptMessage(bobKey, again)) === 'meet me at the usual place');

// --- tampering --------------------------------------------------------------
const [, iv, data] = sealed.split('.');
const flipped = `v1.${iv}.${data.slice(0, -6)}AAAAA=`;
check('tampered ciphertext is rejected', await throws(() => v.decryptMessage(bobKey, flipped)));

const swappedIv = `v1.${v.toBase64(crypto.getRandomValues(new Uint8Array(12)))}.${data}`;
check('a swapped IV is rejected', await throws(() => v.decryptMessage(bobKey, swappedIv)));

check('garbage is rejected', await throws(() => v.decryptMessage(bobKey, 'not-even-close')));

// --- unicode round trip -----------------------------------------------------
const unicode = 'नमस्ते 🌙 ♟ ¿qué tal?';
check('handles unicode and emoji',
  (await v.decryptMessage(bobKey, await v.encryptMessage(aliceKey, unicode))) === unicode);

const long = 'x'.repeat(4000);
check('handles a long message',
  (await v.decryptMessage(bobKey, await v.encryptMessage(aliceKey, long))) === long);

// --- passphrase wrapping ----------------------------------------------------
const wrapped = await v.wrapPrivateKey(alice.privateKey, 'correct horse battery staple');
check('wrapped key has no plaintext key material',
  !!wrapped.salt && !!wrapped.iv && !!wrapped.key && wrapped.iterations >= 600_000, wrapped);

const unwrapped = await v.unwrapPrivateKey(wrapped, 'correct horse battery staple');
const fromRestored = await v.deriveConversationKey(
  unwrapped, await v.importPublicKey(bobPub), CONV,
);
check('a restored key still decrypts old messages',
  (await v.decryptMessage(fromRestored, sealed)) === 'meet me at the usual place');

check('a wrong passphrase fails loudly',
  await throws(() => v.unwrapPrivateKey(wrapped, 'wrong passphrase entirely')));

const tamperedWrap = { ...wrapped, key: `${wrapped.key.slice(0, -6)}AAAAA=` };
check('a tampered key file is rejected',
  await throws(() => v.unwrapPrivateKey(tamperedWrap, 'correct horse battery staple')));

// --- storage ----------------------------------------------------------------
v.storeWrappedKey('user-1', wrapped);
check('stores and loads the wrapped key', v.loadWrappedKey('user-1')?.key === wrapped.key);
check('keeps users separate', v.loadWrappedKey('user-2') === null);

v.clearWrappedKey('user-1');
check('clears the wrapped key', v.loadWrappedKey('user-1') === null);

check('parses a key file', v.parseKeyBackup(JSON.stringify(wrapped))?.key === wrapped.key);
check('rejects a bogus key file', v.parseKeyBackup('{"nope":true}') === null);
check('rejects non-JSON', v.parseKeyBackup('definitely not json') === null);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
