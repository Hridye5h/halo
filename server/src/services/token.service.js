import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../lib/errors.js';
import { log } from '../lib/logger.js';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), username: user.username },
    env.accessSecret,
    { expiresIn: env.accessTtl },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.accessSecret);
  } catch {
    throw ApiError.unauthorized('Session expired');
  }
}

/**
 * Short-lived ticket for the Socket.IO handshake.
 *
 * The access token itself must never ride in a query string — query strings
 * end up in proxy logs, browser history, and Referer headers.
 */
export function signSocketTicket(userId) {
  return jwt.sign({ sub: String(userId) }, env.socketSecret, {
    expiresIn: env.socketTicketTtl,
  });
}

export function verifySocketTicket(ticket) {
  try {
    return jwt.verify(ticket, env.socketSecret);
  } catch {
    throw ApiError.unauthorized('Invalid socket ticket');
  }
}

export async function issueRefreshToken(userId, { family, userAgent, ip } = {}) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 864e5);

  await RefreshToken.create({
    userId,
    tokenHash: hash(raw),
    family: family ?? crypto.randomUUID(),
    expiresAt,
    userAgent: userAgent?.slice(0, 200) ?? '',
    ip: ip ?? '',
  });

  return { raw, expiresAt };
}

/**
 * Rotates a refresh token.
 *
 * If a token that was already used is presented again, two parties hold the
 * same secret — one of them stole it. We cannot tell which, so the only safe
 * move is to revoke the entire family and force a fresh login.
 */
export async function rotateRefreshToken(raw, { userAgent, ip } = {}) {
  const existing = await RefreshToken.findOne({ tokenHash: hash(raw) });
  if (!existing) throw ApiError.unauthorized('Invalid session');

  if (existing.revokedAt) {
    log.warn(`Refresh token reuse detected — revoking family ${existing.family}`);
    await RefreshToken.updateMany(
      { family: existing.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw ApiError.unauthorized('Session revoked — please sign in again');
  }

  if (existing.expiresAt < new Date()) {
    throw ApiError.unauthorized('Session expired');
  }

  const next = await issueRefreshToken(existing.userId, {
    family: existing.family,
    userAgent,
    ip,
  });

  existing.revokedAt = new Date();
  existing.replacedByHash = hash(next.raw);
  await existing.save();

  return { userId: existing.userId, ...next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await RefreshToken.updateOne(
    { tokenHash: hash(raw), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export const REFRESH_COOKIE = 'halo_rt';

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.refreshTtlDays * 864e5,
  };
}
