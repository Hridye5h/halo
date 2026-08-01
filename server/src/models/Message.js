import mongoose from 'mongoose';

export const MESSAGE_KINDS = [
  'text', 'image', 'video', 'voice', 'file', 'chess_game', 'chess_puzzle', 'system',
];

const attachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  thumbUrl: { type: String, default: '' },
  blurhash: { type: String, default: '' },
  name: { type: String, default: '' },
  mime: { type: String, default: '' },
  size: { type: Number, default: 0 },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  // Precomputed peaks so a voice note can draw its waveform without the
  // client downloading and decoding the audio first.
  waveform: { type: [Number], default: [] },
}, { _id: false });

const reactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: MESSAGE_KINDS, default: 'text' },

  // For encrypted messages this holds ciphertext (`v1.<iv>.<data>`), which the
  // server cannot read. Larger than the plaintext cap because base64 + GCM tag
  // inflate it by roughly a third.
  body: { type: String, default: '', maxlength: 8000 },
  // Set by the client. The server only uses it to know not to index or preview
  // the body — it never has the means to decrypt either way.
  encrypted: { type: Boolean, default: false },
  attachments: { type: [attachmentSchema], default: [] },

  chess: {
    platform: { type: String, enum: ['chesscom', 'lichess', ''], default: '' },
    gameId: { type: String, default: '' },
    url: { type: String, default: '' },
    pgn: { type: String, default: '' },
    fen: { type: String, default: '' },
    white: { type: String, default: '' },
    black: { type: String, default: '' },
    result: { type: String, default: '' },
    timeControl: { type: String, default: '' },
    puzzleId: { type: String, default: '' },
  },

  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: { type: [reactionSchema], default: [] },
  readBy: {
    type: [new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date, default: Date.now },
    }, { _id: false })],
    default: [],
  },

  editedAt: { type: Date, default: null },
  // Soft delete only. Hard-deleting breaks reply chains and reaction counts.
  deletedAt: { type: Date, default: null },

  // Idempotency key from the client. Makes a reconnect-retry safe: the same
  // nonce can never create two messages.
  clientNonce: { type: String, default: null },
}, { timestamps: true });

// The one index that serves the entire chat: "latest N in this conversation".
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index(
  { conversationId: 1, clientNonce: 1 },
  { unique: true, partialFilterExpression: { clientNonce: { $type: 'string' } } },
);
messageSchema.index({ body: 'text' });

/**
 * A deleted message still occupies its slot in the stream so replies pointing
 * at it stay coherent — the client renders a tombstone.
 */
messageSchema.methods.toClient = function toClient() {
  const base = {
    id: this._id,
    conversationId: this.conversationId,
    senderId: this.senderId,
    replyTo: this.replyTo,
    createdAt: this.createdAt,
    editedAt: this.editedAt,
    deletedAt: this.deletedAt,
    clientNonce: this.clientNonce,
  };

  if (this.deletedAt) {
    return { ...base, kind: 'system', body: '', attachments: [], reactions: [], readBy: [] };
  }

  return {
    ...base,
    kind: this.kind,
    body: this.body,
    encrypted: this.encrypted,
    attachments: this.attachments,
    chess: this.chess?.platform ? this.chess : undefined,
    reactions: this.reactions,
    readBy: this.readBy,
  };
};

export const Message = mongoose.model('Message', messageSchema);
