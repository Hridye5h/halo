/**
 * Vault mode — end-to-end encryption for a conversation.
 *
 * Everything here runs in the browser. The server stores ciphertext and never
 * receives a private key or a passphrase, so a database dump, a compromised
 * host, or a curious operator yields nothing readable.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 *   Identity      ECDH P-256 keypair, generated on the device.
 *   Key agreement ECDH(myPrivate, theirPublic) → HKDF-SHA256 → AES-256-GCM key.
 *   Messages      AES-256-GCM, fresh random 96-bit IV per message.
 *   At rest       The private key is wrapped with AES-GCM under a key derived
 *                 from a passphrase via PBKDF2-SHA256 (600k iterations).
 *
 * P-256 rather than X25519 deliberately: X25519 only reached WebCrypto in very
 * recent browsers, and a key-exchange that silently fails on someone's phone
 * is worse than a slightly less fashionable curve. P-256 ECDH is available
 * everywhere and is not the weak link here.
 *
 * ── What this does and does not give you ───────────────────────────────────
 *   ✓ The server cannot read your messages, now or retroactively.
 *   ✓ A database leak exposes ciphertext only.
 *   ✓ Tampering is detected — GCM is authenticated.
 *   ✗ NO forward secrecy. The shared secret is static, so someone who steals a
 *     private key AND has stored ciphertext can decrypt past messages. Real
 *     forward secrecy needs a ratchet (Signal's X3DH + Double Ratchet); that
 *     is a much larger build and is noted in the roadmap.
 *   ✗ Metadata is not hidden. Who talked to whom, when, and how often is still
 *     visible to the server.
 *   ✗ This code has not been independently audited. It is a genuine, careful
 *     implementation of standard primitives — not a substitute for Signal if
 *     your threat model includes a determined state actor.
 */

const KDF_ITERATIONS = 600_000;
const STORAGE_KEY = 'halo:vault:v1';

/* ── encoding helpers ─────────────────────────────────────────────────────── */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── identity keys ────────────────────────────────────────────────────────── */

export async function generateIdentityKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable — required to wrap it for backup
    ['deriveBits'],
  );
}

export async function exportPublicKey(keyPair) {
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return toBase64(spki);
}

export async function importPublicKey(base64) {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(base64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

/* ── passphrase wrapping ──────────────────────────────────────────────────── */

async function deriveWrappingKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Wraps the private key under a passphrase. The result is safe to persist. */
export async function wrapPrivateKey(privateKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);

  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, wrappingKey, {
    name: 'AES-GCM', iv,
  });

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    key: toBase64(wrapped),
  };
}

export async function unwrapPrivateKey(blob, passphrase) {
  const wrappingKey = await deriveWrappingKey(passphrase, fromBase64(blob.salt));

  // A wrong passphrase fails GCM authentication here rather than silently
  // producing a garbage key that would corrupt every message sent with it.
  return crypto.subtle.unwrapKey(
    'pkcs8',
    fromBase64(blob.key),
    wrappingKey,
    { name: 'AES-GCM', iv: fromBase64(blob.iv) },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
}

/* ── local storage of the wrapped key ─────────────────────────────────────── */

export function storeWrappedKey(userId, blob) {
  const all = readVaultStore();
  all[userId] = blob;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function loadWrappedKey(userId) {
  return readVaultStore()[userId] ?? null;
}

export function clearWrappedKey(userId) {
  const all = readVaultStore();
  delete all[userId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function readVaultStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/* ── key agreement ────────────────────────────────────────────────────────── */

/**
 * Derives the AES key for a conversation.
 *
 * The conversation id is bound in as HKDF salt so the same pair of identity
 * keys yields a different key per conversation — one compromised conversation
 * key does not unlock the others.
 */
export async function deriveConversationKey(privateKey, theirPublicKey, conversationId) {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(String(conversationId)),
      info: enc.encode('halo-vault-v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ── message encryption ───────────────────────────────────────────────────── */

/** @returns {string} `v1.<iv>.<ciphertext>` — self-describing, so the format
 *  can change later without guessing at what old messages are. */
export async function encryptMessage(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(plaintext),
  );
  return `v1.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptMessage(key, payload) {
  if (typeof payload !== 'string' || !payload.startsWith('v1.')) {
    throw new Error('Unrecognised ciphertext');
  }

  const [, ivPart, dataPart] = payload.split('.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(dataPart),
  );

  return dec.decode(plaintext);
}

export const isCiphertext = (value) => typeof value === 'string' && value.startsWith('v1.');

/* ── fingerprints ─────────────────────────────────────────────────────────── */

/**
 * A short, human-comparable fingerprint of a public key.
 *
 * This is what closes the last hole in the scheme. Public keys are handed out
 * by the server, so a malicious or compromised server could hand you *its* key
 * instead of your friend's and read everything in the middle. No amount of
 * cipher strength prevents that — the only defence is comparing fingerprints
 * over a channel the server does not control (out loud, on a call, in person).
 *
 * Formatted as five groups of four hex characters: long enough that forging a
 * match is infeasible, short enough that two people will actually read it out.
 */
export async function keyFingerprint(publicKeyBase64) {
  if (!publicKeyBase64) return null;
  const digest = await crypto.subtle.digest('SHA-256', fromBase64(publicKeyBase64));

  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return hex.slice(0, 20).match(/.{4}/g).join(' ');
}

/* ── backup ───────────────────────────────────────────────────────────────── */

/**
 * The wrapped key as a portable file.
 *
 * This is what lets someone read their history on a second device. Without a
 * backup, losing the browser profile means losing every encrypted message
 * permanently — there is deliberately no server-side copy to fall back on.
 */
export function downloadKeyBackup(blob, username) {
  const contents = JSON.stringify({ ...blob, username, exportedAt: new Date().toISOString() }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `halo-vault-key-${username}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseKeyBackup(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.v !== 1 || !parsed.salt || !parsed.iv || !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}
