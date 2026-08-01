import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { log } from '../lib/logger.js';
import { User } from '../models/User.js';
import { Conversation } from '../models/Conversation.js';
import { Friendship } from '../models/Friendship.js';
import { verifySocketTicket } from '../services/token.service.js';
import * as presence from '../services/presence.service.js';
import { setIo, roomForUser, roomForConversation, emitToUser } from './emitter.js';
import { registerMessageHandlers } from './handlers/message.handlers.js';
import { registerPresenceHandlers } from './handlers/presence.handlers.js';

/** Everyone who should learn about this user's presence changes. */
async function friendIdsOf(userId) {
  const friendships = await Friendship.find({ pair: userId, status: 'accepted' })
    .select('pair')
    .lean();
  return friendships.map((f) => f.pair.find((id) => String(id) !== String(userId)));
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    // Same-origin in production (the API serves the client), so CORS applies
    // only to the Vite dev server.
    ...(env.isProd ? {} : { cors: { origin: env.clientOrigin, credentials: true } }),

    // Tuned for intercontinental links (India ↔ Mexico is ~250-350ms RTT on a
    // good day, far worse on mobile data). The defaults — 20s timeout, 25s
    // interval — drop a connection that is merely slow, and every false
    // disconnect costs a full handshake plus a visible "reconnecting" flicker.
    pingTimeout: 60_000,
    pingInterval: 25_000,

    // Give up on a slow first handshake later than the 45s default, so a bad
    // moment on the link does not turn into a failed login.
    connectTimeout: 60_000,

    // Compression pays for itself when bandwidth is the constraint rather
    // than CPU, which is the case on a long-haul mobile connection.
    perMessageDeflate: { threshold: 1024 },

    // SCALING SEAM: multi-instance needs @socket.io/redis-adapter here.
  });

  io.use(async (socket, next) => {
    try {
      const ticket = socket.handshake.auth?.ticket;
      if (!ticket) return next(new Error('unauthorized'));

      const payload = verifySocketTicket(ticket);
      const user = await User.findById(payload.sub);
      if (!user || user.supersededBy) return next(new Error('unauthorized'));

      socket.userId = String(user._id);
      socket.user = user;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId } = socket;
    log.socket(`connected ${socket.user.username} (${socket.id})`);

    socket.join(roomForUser(userId));

    // Join every conversation room up front so messages arrive even when the
    // chat is not the open view — that is what drives unread badges.
    const conversations = await Conversation.find({ participants: userId })
      .select('_id')
      .lean();
    conversations.forEach((c) => socket.join(roomForConversation(c._id)));

    const cameOnline = presence.addSocket(userId, socket.id);
    const friends = await friendIdsOf(userId);

    if (cameOnline) {
      const intent = await presence.setIntent(userId, { status: 'online' });

      // The user's own devices always learn their real status, invisible or
      // not — otherwise your own sidebar shows you as offline while you are
      // demonstrably sitting there using the app.
      emitToUser(userId, 'presence:changed', {
        userId,
        status: intent.status,
        customStatus: intent.customStatus,
      });

      if (!socket.user.settings?.invisible) {
        friends.forEach((id) => emitToUser(id, 'presence:changed', {
          userId,
          status: intent.status,
          customStatus: intent.customStatus,
        }));
      }
    }

    // Seed the client with who is already online, so it does not have to wait
    // for the next presence event to render the list correctly.
    socket.emit('presence:sync', {
      online: friends
        .filter((id) => presence.isOnline(id))
        .map((id) => ({ userId: String(id), ...presence.getIntent(id) })),
    });

    registerMessageHandlers(io, socket);
    registerPresenceHandlers(io, socket, { friendIdsOf });

    socket.on('disconnect', (reason) => {
      log.socket(`disconnected ${socket.user.username} (${reason})`);

      presence.removeSocket(userId, socket.id, async (offlineUserId) => {
        const stillFriends = await friendIdsOf(offlineUserId);
        const fresh = await User.findById(offlineUserId).select('settings presence').lean();

        stillFriends.forEach((id) => emitToUser(id, 'presence:changed', {
          userId: String(offlineUserId),
          status: 'offline',
          lastSeenAt: fresh?.settings?.hideLastSeen ? null : fresh?.presence?.lastSeenAt,
        }));
      });
    });
  });

  setIo(io);
  return io;
}
