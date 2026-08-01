import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { Friendship } from '../models/Friendship.js';
import { ApiError } from '../lib/errors.js';
import * as timeline from './timeline.service.js';

/** Every read and write funnels through this. Membership is never assumed. */
export async function assertMember(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw ApiError.notFound('Conversation not found');
  }
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw ApiError.notFound('Conversation not found');
  if (!conversation.participants.some((id) => String(id) === String(userId))) {
    throw ApiError.forbidden('Not a member of this conversation');
  }
  return conversation;
}

/** Ciphertext produced by the client's vault format. */
const isCiphertext = (value) => typeof value === 'string' && value.startsWith('v1.');

const PREVIEWS = {
  image: '📷 Photo',
  video: '🎬 Video',
  voice: '🎤 Voice note',
  file: '📎 File',
  chess_game: '♟ Chess game',
  chess_puzzle: '🧩 Chess puzzle',
};

function previewFor(message, conversation) {
  // Never store a preview of an encrypted body. The body is ciphertext, so a
  // slice of it would be useless anyway — but writing it into the conversation
  // list is exactly the kind of accidental plaintext leak worth ruling out
  // structurally rather than by convention.
  if (conversation?.encryption?.mode === 'vault') return '🔒 Encrypted message';

  if (message.kind === 'text') return message.body.slice(0, 120);
  return message.body?.slice(0, 120) || PREVIEWS[message.kind] || '';
}

export async function sendMessage(userId, {
  conversationId, kind = 'text', body = '', attachments = [], chess, replyTo, clientNonce,
  encrypted = false,
}) {
  const conversation = await assertMember(conversationId, userId);

  // Refuse plaintext into an encrypted conversation. A client bug that skipped
  // encryption would otherwise silently write readable messages into a thread
  // the users believe is private — the one failure mode that must not be quiet.
  const isVault = conversation.encryption?.mode === 'vault';
  if (isVault && kind === 'text' && !encrypted) {
    throw ApiError.badRequest('This conversation requires end-to-end encryption');
  }

  if (conversation.friendshipId) {
    const friendship = await Friendship.findById(conversation.friendshipId).lean();
    if (friendship?.status === 'blocked') {
      throw ApiError.forbidden('This conversation is blocked');
    }
  }

  const trimmed = body.trim();
  if (kind === 'text' && !trimmed) throw ApiError.badRequest('Message is empty');
  if (trimmed.length > 8000) throw ApiError.badRequest('Message is too long');
  if (kind !== 'text' && !attachments.length && !chess?.url && !trimmed) {
    throw ApiError.badRequest('Nothing to send');
  }

  if (replyTo) {
    const parent = await Message.findById(replyTo).select('conversationId').lean();
    if (!parent || String(parent.conversationId) !== String(conversationId)) {
      throw ApiError.badRequest('You can only reply to messages in this conversation');
    }
  }

  let message;
  try {
    message = await Message.create({
      conversationId,
      senderId: userId,
      kind,
      body: trimmed,
      encrypted: Boolean(encrypted),
      attachments,
      chess,
      replyTo: replyTo ?? null,
      clientNonce: clientNonce ?? null,
    });
  } catch (err) {
    // Duplicate nonce — a retry of a send that already succeeded. Return the
    // original rather than erroring, which is the entire point of the nonce.
    if (err?.code === 11000 && clientNonce) {
      const existing = await Message.findOne({ conversationId, clientNonce });
      if (existing) return { message: existing, conversation, duplicate: true };
    }
    throw err;
  }

  conversation.lastMessage = {
    messageId: message._id,
    preview: previewFor(message, conversation),
    senderId: userId,
    sentAt: message.createdAt,
  };
  await conversation.save();

  await recordMessageStats(conversation, message, userId);

  return { message, conversation, duplicate: false };
}

/**
 * Updates the denormalised friendship stats and emits timeline events.
 *
 * Failures here must never fail the send — a message that was delivered but
 * not counted is a cosmetic problem; a message that vanished because a
 * counter update threw is a real one.
 */
async function recordMessageStats(conversation, message, userId) {
  if (!conversation.friendshipId) return;

  try {
    const inc = { 'stats.messageCount': 1 };
    if (message.kind === 'voice') inc['stats.voiceNotes'] = 1;
    if (['image', 'video', 'file'].includes(message.kind)) inc['stats.mediaShared'] = 1;

    const friendship = await Friendship.findByIdAndUpdate(
      conversation.friendshipId,
      { $inc: inc },
      { new: true },
    );
    if (!friendship) return;

    const firsts = {
      text: ['first_message', 'First message', '💬'],
      voice: ['first_voice_note', 'First voice note', '🎤'],
      image: ['first_photo', 'First photo shared', '📷'],
    };

    if (firsts[message.kind]) {
      const [type, title, icon] = firsts[message.kind];
      await timeline.record({
        friendshipId: friendship._id,
        type,
        actorId: userId,
        title,
        icon,
        occurredAt: message.createdAt,
        once: true,
      });
    }

    await timeline.checkMessageMilestone(friendship._id, friendship.stats.messageCount);
  } catch {
    // Intentionally swallowed — see the note above.
  }
}

/** Cursor pagination. `skip` degrades linearly and breaks when messages
 *  arrive mid-scroll, so the cursor is the newest message already held. */
export async function listMessages(userId, conversationId, { before, limit = 40 } = {}) {
  await assertMember(conversationId, userId);

  const query = { conversationId };
  if (before && mongoose.isValidObjectId(before)) {
    query._id = { $lt: new mongoose.Types.ObjectId(String(before)) };
  }

  const capped = Math.min(Number(limit) || 40, 100);
  const messages = await Message.find(query)
    .sort({ _id: -1 })
    .limit(capped + 1)
    .exec();

  const hasMore = messages.length > capped;
  const page = hasMore ? messages.slice(0, capped) : messages;

  return {
    messages: page.reverse().map((m) => m.toClient()),
    nextCursor: hasMore ? String(page[0]._id) : null,
    hasMore,
  };
}

export async function editMessage(userId, messageId, body) {
  const message = await Message.findById(messageId);
  if (!message || message.deletedAt) throw ApiError.notFound('Message not found');
  if (String(message.senderId) !== String(userId)) {
    throw ApiError.forbidden('You can only edit your own messages');
  }
  if (message.kind !== 'text') throw ApiError.badRequest('Only text messages can be edited');

  const trimmed = body.trim();
  if (!trimmed) throw ApiError.badRequest('Message cannot be empty');
  if (trimmed.length > 8000) throw ApiError.badRequest('Message is too long');

  // An encrypted message must stay encrypted through an edit — the client
  // re-encrypts and sends ciphertext, so plaintext arriving here is a bug.
  if (message.encrypted && !isCiphertext(trimmed)) {
    throw ApiError.badRequest('This conversation requires end-to-end encryption');
  }

  message.body = trimmed;
  message.editedAt = new Date();
  await message.save();

  return message;
}

export async function deleteMessage(userId, messageId) {
  const message = await Message.findById(messageId);
  if (!message) throw ApiError.notFound('Message not found');
  if (String(message.senderId) !== String(userId)) {
    throw ApiError.forbidden('You can only delete your own messages');
  }
  if (message.deletedAt) return message;

  // Tombstone, never destroy — replies pointing here must stay coherent.
  message.deletedAt = new Date();
  message.body = '';
  message.attachments = [];
  await message.save();

  await Conversation.updateOne(
    { _id: message.conversationId, 'lastMessage.messageId': message._id },
    { $set: { 'lastMessage.preview': 'Message deleted' } },
  );

  return message;
}

/** Reactions toggle: the same emoji from the same person removes it. */
export async function toggleReaction(userId, messageId, emoji) {
  const message = await Message.findById(messageId);
  if (!message || message.deletedAt) throw ApiError.notFound('Message not found');
  await assertMember(message.conversationId, userId);

  const index = message.reactions.findIndex(
    (r) => r.emoji === emoji && String(r.userId) === String(userId),
  );

  if (index >= 0) {
    message.reactions.splice(index, 1);
  } else {
    message.reactions.push({ emoji, userId, at: new Date() });
    await trackEmoji(message.conversationId, emoji);
  }

  await message.save();
  return message;
}

async function trackEmoji(conversationId, emoji) {
  try {
    const conversation = await Conversation.findById(conversationId).select('friendshipId').lean();
    if (!conversation?.friendshipId) return;
    await Friendship.updateOne(
      { _id: conversation.friendshipId },
      { $inc: { [`stats.emojiCounts.${emoji}`]: 1 } },
    );
  } catch {
    // Stats are best-effort.
  }
}

/**
 * Marks everything up to a message as read.
 *
 * The cursor on the conversation is the source of truth for unread counts;
 * the per-message `readBy` array exists only to render the tick marks, and is
 * capped to recent messages so a long backlog does not rewrite thousands of
 * documents in one go.
 */
export async function markRead(userId, conversationId, upToMessageId) {
  const conversation = await assertMember(conversationId, userId);

  const target = upToMessageId
    ? await Message.findById(upToMessageId).select('_id createdAt').lean()
    : await Message.findOne({ conversationId }).sort({ _id: -1 }).select('_id createdAt').lean();

  if (!target) return { conversationId, upToMessageId: null };

  conversation.readCursors.set(String(userId), {
    messageId: target._id,
    at: new Date(),
  });
  await conversation.save();

  // Cap the receipt backfill: opening a conversation with 10,000 unread
  // messages must not turn into a 10,000-document write.
  const pending = await Message.find({
    conversationId,
    _id: { $lte: target._id },
    senderId: { $ne: userId },
    'readBy.userId': { $ne: userId },
  })
    .sort({ _id: -1 })
    .limit(200)
    .select('_id')
    .lean();

  if (pending.length) {
    await Message.updateMany(
      { _id: { $in: pending.map((m) => m._id) } },
      { $push: { readBy: { userId, at: new Date() } } },
    );
  }

  return { conversationId, upToMessageId: target._id, at: new Date() };
}

export async function unreadCount(conversationId, userId, cursors) {
  const cursor = cursors?.get?.(String(userId));
  const query = { conversationId, senderId: { $ne: userId }, deletedAt: null };
  if (cursor?.messageId) query._id = { $gt: cursor.messageId };
  return Message.countDocuments(query);
}

export async function searchMessages(userId, conversationId, term, { limit = 30 } = {}) {
  const conversation = await assertMember(conversationId, userId);

  // The server holds only ciphertext here, so there is nothing to search. Say
  // so explicitly rather than returning an empty list that looks like "no
  // results" and quietly misleads the user.
  if (conversation.encryption?.mode === 'vault') {
    throw ApiError.badRequest(
      'This conversation is end-to-end encrypted — search runs on your device instead',
    );
  }

  const trimmed = term?.trim();
  if (!trimmed) return [];

  // Regex rather than $text: substring matching is what people expect from a
  // chat search ("afre" should find "Afreen"), and $text only matches whole
  // stemmed words. Escaped so user input cannot inject a pattern.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const messages = await Message.find({
    conversationId,
    deletedAt: null,
    body: { $regex: escaped, $options: 'i' },
  })
    .sort({ _id: -1 })
    .limit(Math.min(Number(limit) || 30, 100));

  return messages.map((m) => m.toClient());
}

export async function togglePin(userId, conversationId, messageId) {
  const conversation = await assertMember(conversationId, userId);
  const message = await Message.findById(messageId).select('conversationId').lean();

  if (!message || String(message.conversationId) !== String(conversationId)) {
    throw ApiError.notFound('Message not found');
  }

  const index = conversation.pinnedMessages.findIndex(
    (id) => String(id) === String(messageId),
  );

  if (index >= 0) {
    conversation.pinnedMessages.splice(index, 1);
  } else {
    if (conversation.pinnedMessages.length >= 50) {
      throw ApiError.badRequest('You can pin up to 50 messages');
    }
    conversation.pinnedMessages.push(messageId);
  }

  await conversation.save();
  return conversation;
}
