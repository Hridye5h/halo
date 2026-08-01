import mongoose from 'mongoose';

/**
 * Refresh tokens are stored HASHED, and rotated on every use.
 *
 * `family` is what makes theft detectable: all tokens descended from one login
 * share a family id. Presenting an already-revoked token means two parties hold
 * the same token — so the whole family is revoked and every session dies.
 */
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },

  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedByHash: { type: String, default: null },

  userAgent: { type: String, default: '' },
  ip: { type: String, default: '' },
}, { timestamps: true });

// Mongo evicts expired documents on its own; no cleanup job needed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
