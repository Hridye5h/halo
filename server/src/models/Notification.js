import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'friend_request', 'friend_accepted', 'message', 'reaction', 'mention',
  'presence', 'profile_updated', 'chess_challenge', 'identity_restore_request',
];

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  title: { type: String, default: '' },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
