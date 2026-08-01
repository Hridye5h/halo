import 'dotenv/config';
import crypto from 'node:crypto';

/**
 * Environment configuration.
 *
 * Secrets fall back to a random value in development so the app boots with no
 * setup at all. That is deliberately NOT allowed in production — a random
 * secret per process would silently invalidate every session on restart, and
 * across multiple instances no two would agree on a token.
 */
const isProd = process.env.NODE_ENV === 'production';

function secret(name) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`${name} must be set in production`);
  }
  return crypto.randomBytes(32).toString('hex');
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',

  // Empty means "spin up an in-process MongoDB" — see config/db.js
  mongoUri: process.env.MONGO_URI ?? '',

  accessSecret: secret('JWT_ACCESS_SECRET'),
  refreshSecret: secret('JWT_REFRESH_SECRET'),
  socketSecret: secret('SOCKET_TICKET_SECRET'),
  // Peppers the identity-token lookup index — see services/auth.service.js
  identityPepper: secret('IDENTITY_PEPPER'),

  accessTtl: '15m',
  refreshTtlDays: 30,
  socketTicketTtl: '60s',

  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024),
};
