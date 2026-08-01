import crypto from 'node:crypto';

/**
 * Friend Codes and Identity Tokens.
 *
 * Crockford base32: no I, L, O, or U. That removes every 0/O and 1/I/L
 * confusion when a code is read aloud, typed from a screenshot, or written
 * down — which is the entire point of a code you are meant to share verbally.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Unbiased index into ALPHABET. Modulo on a raw byte would skew toward low
 *  letters, because 256 is not a multiple of 32... it is here, but the guard
 *  keeps this correct if the alphabet ever changes length. */
function randomIndex() {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let byte;
  do {
    byte = crypto.randomBytes(1)[0];
  } while (byte >= limit);
  return byte % ALPHABET.length;
}

/** Check character: catches most single-character typos before we hit the DB. */
function checkChar(chars) {
  const sum = chars.reduce((acc, c, i) => acc + ALPHABET.indexOf(c) * (i + 1), 0);
  return ALPHABET[sum % ALPHABET.length];
}

/** Generates a code like `7JXK-92QF` (7 random chars + 1 check char). */
export function generateFriendCode() {
  const chars = Array.from({ length: 7 }, () => ALPHABET[randomIndex()]);
  const full = [...chars, checkChar(chars)].join('');
  return `${full.slice(0, 4)}-${full.slice(4)}`;
}

/** Accepts any casing/spacing/dashes and returns the canonical form, or null. */
export function normalizeFriendCode(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
    // Forgive the characters Crockford drops, mapping them to their lookalikes.
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');

  if (cleaned.length !== 8) return null;
  const chars = cleaned.slice(0, 7).split('');
  if (chars.some((c) => !ALPHABET.includes(c))) return null;
  if (checkChar(chars) !== cleaned[7]) return null;

  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

const WORDS = [
  'amber', 'anchor', 'aurora', 'bishop', 'bramble', 'canyon', 'cedar', 'cinder',
  'comet', 'copper', 'coral', 'delta', 'ember', 'falcon', 'fathom', 'ferry',
  'garnet', 'gambit', 'harbor', 'hollow', 'indigo', 'ivory', 'jasper', 'kestrel',
  'lantern', 'lunar', 'marble', 'meadow', 'nimbus', 'north', 'onyx', 'opal',
  'pawn', 'pepper', 'quartz', 'quiver', 'raven', 'ripple', 'saffron', 'signal',
  'silver', 'summit', 'tundra', 'thistle', 'umber', 'velvet', 'walnut', 'willow',
  'winter', 'zephyr', 'orbit', 'pigeon', 'castle', 'knight', 'rookie', 'stanza',
  'violet', 'wander', 'yonder', 'zenith', 'beacon', 'cobalt', 'drift', 'echo',
];

/**
 * Identity Token — the permanent re-linking secret, shown exactly once.
 *
 * A mnemonic phrase rather than hex: people have to transcribe this by hand
 * into a notes app or onto paper, and words survive that far better than 64
 * characters of hex. 10 words from a 64-word list is 60 bits of entropy —
 * offline-infeasible given it is stored only as an argon2id hash, and
 * online-infeasible given the rate limit on the redemption endpoint.
 */
const TOKEN_WORDS = 10;

export function generateIdentityToken() {
  return Array.from(
    { length: TOKEN_WORDS },
    () => WORDS[crypto.randomInt(WORDS.length)],
  ).join('-');
}

export function normalizeIdentityToken(input) {
  if (typeof input !== 'string') return null;
  const parts = input.toLowerCase().trim().split(/[\s-]+/).filter(Boolean);
  return parts.length === TOKEN_WORDS ? parts.join('-') : null;
}
