import { ApiError } from '../../lib/errors.js';
import { log } from '../../lib/logger.js';
import * as messages from '../../services/message.service.js';
import { Notification } from '../../models/Notification.js';
import {
  roomForConversation, emitToConversation, emitToUser,
} from '../emitter.js';

/**
 * Wraps a handler so every failure comes back through the ack callback instead
 * of killing the socket. Without this, one bad payload disconnects the client
 * mid-conversation and the user just sees the app freeze.
 */
const handle = (socket, fn) => async (payload, ack) => {
  try {
    const result = await fn(payload ?? {});
    ack?.({ ok: true, ...result });
  } catch (err) {
    const isExpected = err instanceof ApiError;
    if (!isExpected) log.error('socket handler failed', err);
    ack?.({
      ok: false,
      error: {
        code: isExpected ? err.code : 'internal_error',
        message: isExpected ? err.message : 'Something went wrong',
      },
    });
  }
};

/**
 * Typing state expires server-side.
 *
 * A dropped `typing:stop` — a closed tab, a lost connection — would otherwise
 * leave someone "typing…" forever, which is the classic hand-rolled-chat bug.
 */
const TYPING_TTL_MS = 5000;
const typingTimers = new Map(); // `${conversationId}:${userId}` -> timeout

function clearTyping(conversationId, userId) {
  const key = `${conversationId}:${userId}`;
  const timer = typingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    typingTimers.delete(key);
  }
}

export function registerMessageHandlers(io, socket) {
  const { userId } = socket;

  socket.on('conversation:open', handle(socket, async ({ conversationId }) => {
    await messages.assertMember(conversationId, userId);
    socket.join(roomForConversation(conversationId));
    return { conversationId };
  }));

  socket.on('conversation:close', handle(socket, async ({ conversationId }) => {
    socket.leave(roomForConversation(conversationId));
    clearTyping(conversationId, userId);
    return { conversationId };
  }));

  socket.on('message:send', handle(socket, async (payload) => {
    const { message, conversation, duplicate } = await messages.sendMessage(userId, payload);
    const wire = message.toClient();

    clearTyping(payload.conversationId, userId);
    emitToConversation(conversation._id, 'typing:update', {
      conversationId: String(conversation._id),
      userId,
      typing: false,
    });

    // The sender's own other devices need this too, so the room (which the
    // sender is in) is the right fan-out — the client de-dupes on clientNonce.
    emitToConversation(conversation._id, 'message:new', { message: wire });

    if (!duplicate) {
      const recipients = conversation.participants.filter(
        (id) => String(id) !== String(userId),
      );

      await Notification.insertMany(recipients.map((id) => ({
        userId: id,
        type: 'message',
        actorId: userId,
        title: socket.user.displayName,
        body: conversation.lastMessage.preview,
        meta: { conversationId: conversation._id, messageId: message._id },
      }))).catch(() => {});

      recipients.forEach((id) => emitToUser(id, 'notification:new', {
        type: 'message',
        conversationId: String(conversation._id),
        preview: conversation.lastMessage.preview,
        from: { id: userId, displayName: socket.user.displayName },
      }));
    }

    return { message: wire, duplicate };
  }));

  socket.on('message:edit', handle(socket, async ({ messageId, body }) => {
    const message = await messages.editMessage(userId, messageId, body);
    const wire = message.toClient();
    emitToConversation(message.conversationId, 'message:updated', { message: wire });
    return { message: wire };
  }));

  socket.on('message:delete', handle(socket, async ({ messageId }) => {
    const message = await messages.deleteMessage(userId, messageId);
    emitToConversation(message.conversationId, 'message:deleted', {
      messageId: String(message._id),
      conversationId: String(message.conversationId),
    });
    return { messageId: String(message._id) };
  }));

  socket.on('message:react', handle(socket, async ({ messageId, emoji }) => {
    const message = await messages.toggleReaction(userId, messageId, emoji);
    emitToConversation(message.conversationId, 'message:reaction', {
      messageId: String(message._id),
      conversationId: String(message.conversationId),
      reactions: message.reactions,
    });
    return { reactions: message.reactions };
  }));

  socket.on('read:mark', handle(socket, async ({ conversationId, upToMessageId }) => {
    const result = await messages.markRead(userId, conversationId, upToMessageId);
    socket.to(roomForConversation(conversationId)).emit('read:receipt', {
      conversationId: String(conversationId),
      userId,
      upToMessageId: result.upToMessageId ? String(result.upToMessageId) : null,
      at: result.at,
    });
    return result;
  }));

  socket.on('typing:start', handle(socket, async ({ conversationId }) => {
    await messages.assertMember(conversationId, userId);

    const key = `${conversationId}:${userId}`;
    const alreadyTyping = typingTimers.has(key);
    clearTyping(conversationId, userId);

    typingTimers.set(key, setTimeout(() => {
      typingTimers.delete(key);
      emitToConversation(conversationId, 'typing:update', {
        conversationId: String(conversationId),
        userId,
        typing: false,
      });
    }, TYPING_TTL_MS));

    // Only announce the transition; the client throttles, but the server does
    // not trust it to.
    if (!alreadyTyping) {
      socket.to(roomForConversation(conversationId)).emit('typing:update', {
        conversationId: String(conversationId),
        userId,
        displayName: socket.user.displayName,
        typing: true,
      });
    }
    return {};
  }));

  socket.on('typing:stop', handle(socket, async ({ conversationId }) => {
    clearTyping(conversationId, userId);
    socket.to(roomForConversation(conversationId)).emit('typing:update', {
      conversationId: String(conversationId),
      userId,
      typing: false,
    });
    return {};
  }));

  socket.on('disconnect', () => {
    // Snapshot the keys: clearTyping deletes from the very Map being iterated.
    for (const key of [...typingTimers.keys()]) {
      if (key.endsWith(`:${userId}`)) {
        const conversationId = key.slice(0, key.lastIndexOf(':'));
        clearTyping(conversationId, userId);
        emitToConversation(conversationId, 'typing:update', {
          conversationId,
          userId,
          typing: false,
        });
      }
    }
  });
}
