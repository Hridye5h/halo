import { PRESENCE_STATUSES } from '../../models/User.js';
import * as presence from '../../services/presence.service.js';
import { emitToUser } from '../emitter.js';

export function registerPresenceHandlers(io, socket, { friendIdsOf }) {
  const { userId } = socket;

  socket.on('presence:update', async (payload, ack) => {
    try {
      const status = PRESENCE_STATUSES.includes(payload?.status) ? payload.status : undefined;
      const customStatus = typeof payload?.customStatus === 'string'
        ? payload.customStatus.slice(0, 64)
        : undefined;

      const intent = await presence.setIntent(userId, { status, customStatus });

      // Mirror to the user's other devices regardless of visibility — their
      // own clients must always agree on their real status.
      socket.to(`user:${userId}`).emit('presence:changed', { userId, ...intent });

      if (!socket.user.settings?.invisible) {
        const friends = await friendIdsOf(userId);
        friends.forEach((id) => emitToUser(id, 'presence:changed', { userId, ...intent }));
      }

      ack?.({ ok: true, ...intent });
    } catch {
      ack?.({ ok: false, error: { code: 'internal_error', message: 'Could not update status' } });
    }
  });
}
