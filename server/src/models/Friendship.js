import mongoose from 'mongoose';

/**
 * One document per PAIR, not per direction.
 *
 * `pair` is always stored sorted by id, which makes it a canonical key: the
 * unique index then makes "are these two connected?" a single indexed lookup
 * and makes duplicate/half-accepted friendships structurally impossible.
 */
const friendshipSchema = new mongoose.Schema({
  pair: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    required: true,
    validate: [(v) => v.length === 2, 'A friendship has exactly two members'],
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'blocked'],
    default: 'pending',
    index: true,
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  respondedAt: { type: Date, default: null },
  establishedAt: { type: Date, default: null },

  // Denormalised for the Shared Memories page. Cheap to increment, and a
  // reconciliation job corrects drift (ARCHITECTURE.md §12).
  stats: {
    messageCount: { type: Number, default: 0 },
    voiceNotes: { type: Number, default: 0 },
    mediaShared: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    secondsTalked: { type: Number, default: 0 },
    emojiCounts: { type: Map, of: Number, default: () => new Map() },
  },
}, { timestamps: true });

friendshipSchema.index({ pair: 1 }, { unique: true });

/** Canonical ordering — every read and write must go through this. */
export function sortPair(a, b) {
  return [a, b].map(String).sort();
}

friendshipSchema.statics.between = function between(a, b) {
  return this.findOne({ pair: sortPair(a, b) });
};

friendshipSchema.methods.otherMember = function otherMember(userId) {
  return this.pair.find((id) => String(id) !== String(userId));
};

export const Friendship = mongoose.model('Friendship', friendshipSchema);
