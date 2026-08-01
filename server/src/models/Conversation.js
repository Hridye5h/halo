import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ['dm', 'group'], default: 'dm' },
  participants: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    required: true,
    index: true,
  },
  friendshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Friendship', default: null },

  title: { type: String, default: '' },
  iconUrl: { type: String, default: '' },
  pinnedMessages: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
    default: [],
  },

  // Denormalised so the conversation list renders from one query instead of
  // N lookups for "what was the last thing said".
  lastMessage: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    preview: { type: String, default: '' },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: null },
  },

  // Per-participant read cursor. Unread counts are derived from this rather
  // than stored, so they can never drift out of sync with the messages.
  readCursors: {
    type: Map,
    of: new mongoose.Schema({
      messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
      at: { type: Date, default: null },
    }, { _id: false }),
    default: () => new Map(),
  },

  // Reserved for vault mode (ARCHITECTURE.md §10). Present now so enabling
  // encryption later is a feature flag, not a migration.
  encryption: {
    mode: { type: String, enum: ['standard', 'vault'], default: 'standard' },
    publicKeys: { type: Map, of: String, default: () => new Map() },
    enabledAt: { type: Date, default: null },
  },
}, { timestamps: true });

conversationSchema.index({ participants: 1, 'lastMessage.sentAt': -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
