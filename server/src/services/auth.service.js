import crypto from 'node:crypto';
import argon2 from 'argon2';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import {
  generateFriendCode,
  generateIdentityToken,
  normalizeIdentityToken,
} from '../lib/friendCode.js';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashSecret = (value) => argon2.hash(value, ARGON_OPTS);
export const verifySecret = (hash, value) => argon2.verify(hash, value).catch(() => false);

/**
 * Fast, indexable fingerprint of an identity token.
 *
 * argon2 alone would force a verify against every user on redemption. A plain
 * SHA-256 index would be brute-forceable from a database dump, since the token
 * is only ~60 bits. HMAC under a server-held pepper gives O(1) lookup while
 * keeping a dump useless without the application secret.
 */
const identityLookup = (token) =>
  crypto.createHmac('sha256', env.identityPepper).update(token).digest('hex');

/** Retries on the astronomically unlikely friend-code collision. */
async function allocateFriendCode(attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateFriendCode();
    if (!(await User.exists({ friendCode: code }))) return code;
  }
  throw new Error('Could not allocate a unique friend code');
}

export async function registerUser({ username, email, password, displayName }) {
  const clash = await User.findOne({ $or: [{ username }, { email }] }).lean();
  if (clash) {
    throw ApiError.conflict(
      clash.username === username ? 'That username is taken' : 'That email is already registered',
    );
  }

  const identityToken = generateIdentityToken();
  const [passwordHash, identityTokenHash, friendCode] = await Promise.all([
    hashSecret(password),
    hashSecret(identityToken),
    allocateFriendCode(),
  ]);

  const user = await User.create({
    username,
    email,
    displayName: displayName || username,
    passwordHash,
    identityTokenHash,
    identityTokenLookup: identityLookup(identityToken),
    friendCode,
    badges: [{ key: 'founder', label: 'Founding Member', icon: '🌱' }],
  });

  // The only time the identity token is ever readable. It is stored hashed,
  // so if the user loses this, it is genuinely unrecoverable.
  return { user, identityToken };
}

export async function authenticate({ identifier, password }) {
  const query = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { username: identifier.toLowerCase() };

  const user = await User.findOne(query).select('+passwordHash');

  // Hash even when the user does not exist, so response timing does not
  // reveal which accounts are real.
  if (!user) {
    await hashSecret(password).catch(() => {});
    throw ApiError.unauthorized('Incorrect username or password');
  }

  if (!(await verifySecret(user.passwordHash, password))) {
    throw ApiError.unauthorized('Incorrect username or password');
  }
  if (user.supersededBy) {
    throw ApiError.unauthorized('This account has been replaced');
  }

  return user;
}

/**
 * Finds the account an identity token belongs to.
 *
 * Deliberately does NOT log anyone in — see ARCHITECTURE.md §6. This only
 * identifies which prior account is being claimed; the friends on the other
 * side still have to approve the restore.
 */
export async function resolveIdentityToken(rawToken) {
  const token = normalizeIdentityToken(rawToken);
  if (!token) throw ApiError.badRequest('That identity token is not the right shape');

  const user = await User.findOne({ identityTokenLookup: identityLookup(token) })
    .select('+identityTokenHash');

  // The argon2 verify is redundant given the HMAC matched, but it means a
  // forged lookup value alone is not enough to claim an account.
  if (!user || !(await verifySecret(user.identityTokenHash, token))) {
    throw ApiError.notFound('No account matches that identity token');
  }
  if (user.supersededBy) {
    throw ApiError.badRequest('That identity token has already been redeemed');
  }

  return user;
}
