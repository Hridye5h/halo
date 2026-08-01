import mongoose from 'mongoose';

export const PRESENCE_STATUSES = [
  'online', 'away', 'offline', 'sleeping', 'studying', 'playing',
];

const badgeSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String, default: '🏅' },
  awardedAt: { type: Date, default: Date.now },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 24,
    match: /^[a-z0-9_]+$/,
  },
  displayName: { type: String, required: true, trim: true, maxlength: 32 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },

  // Permanent identity — see ARCHITECTURE.md §6. Neither ever changes.
  friendCode: { type: String, required: true, unique: true, index: true },
  identityTokenHash: { type: String, required: true, select: false },
  // Peppered HMAC of the same token, purely so redemption is an indexed lookup
  // instead of an argon2 verify against every user. See auth.service.js.
  identityTokenLookup: { type: String, required: true, unique: true, select: false },

  avatarUrl: { type: String, default: '' },
  bannerUrl: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 500 },
  countryCode: { type: String, default: '', maxlength: 2, uppercase: true },
  pronouns: { type: String, default: '', maxlength: 24 },
  // IANA zone, e.g. "Asia/Kolkata". Stored so friends can see what time it is
  // where you are — with 11+ hours between them that is the difference between
  // "say hi" and "you just woke them at 3am".
  timezone: { type: String, default: '', maxlength: 64 },

  // Base64 SPKI of the user's ECDH P-256 public key, published so friends can
  // derive a shared secret. Public by design — the private half never leaves
  // the device and the server has no way to obtain it.
  publicKey: { type: String, default: '', maxlength: 500 },
  publicKeyUpdatedAt: { type: Date, default: null },

  presence: {
    status: { type: String, enum: PRESENCE_STATUSES, default: 'offline' },
    customStatus: { type: String, default: '', maxlength: 64 },
    lastSeenAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
  },

  settings: {
    theme: { type: String, default: 'midnight' },
    customTheme: { type: mongoose.Schema.Types.Mixed, default: null },
    density: { type: String, enum: ['comfortable', 'compact'], default: 'comfortable' },
    reducedMotion: { type: Boolean, default: false },
    hideLastSeen: { type: Boolean, default: false },
    invisible: { type: Boolean, default: false },
    notifications: {
      messages: { type: Boolean, default: true },
      presence: { type: Boolean, default: true },
      sounds: { type: Boolean, default: true },
    },
  },

  badges: { type: [badgeSchema], default: [] },

  chess: {
    chesscomUsername: { type: String, default: '' },
    lichessUsername: { type: String, default: '' },
  },

  // Set when an account is superseded via identity-token recovery. The doc is
  // kept so historical messages still resolve a sender — never hard-deleted.
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

/**
 * The public shape of a user. Everything the client is allowed to see and
 * nothing else — `select: false` protects the secrets at the query layer, and
 * this protects against accidentally serialising a full document.
 *
 * `viewerId` matters: privacy settings mean you see your own real presence
 * even when you are invisible to everyone else.
 */
userSchema.methods.toPublic = function toPublic(viewerId = null) {
  const isSelf = viewerId && String(viewerId) === String(this._id);
  const hidden = this.settings?.invisible || this.settings?.hideLastSeen;

  return {
    id: this._id,
    username: this.username,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    bannerUrl: this.bannerUrl,
    bio: this.bio,
    countryCode: this.countryCode,
    pronouns: this.pronouns,
    timezone: this.timezone,
    publicKey: this.publicKey,
    friendCode: this.friendCode,
    badges: this.badges,
    chess: this.chess,
    joinedAt: this.createdAt,
    presence: {
      status: isSelf || !this.settings?.invisible ? this.presence.status : 'offline',
      customStatus: this.presence.customStatus,
      lastSeenAt: isSelf || !hidden ? this.presence.lastSeenAt : null,
    },
    ...(isSelf ? { email: this.email, settings: this.settings } : {}),
  };
};

export const User = mongoose.model('User', userSchema);
