import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../lib/socket.js';
import { useRealtime } from '../stores/useRealtime.js';
import { useAuth } from '../stores/useAuth.js';
import * as outbox from '../lib/outbox.js';
import { deliver } from '../features/chat/useMessages.js';

/**
 * The single place socket events become application state.
 *
 * Every handler is registered once, at the shell. Wiring listeners inside
 * feature components means duplicate handlers on every mount and messages
 * processed twice — the bug that makes hand-rolled chat apps feel haunted.
 */
export function useSocketBridge() {
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !user) return undefined;

    const realtime = useRealtime.getState();

    /**
     * Reconnecting is not just "the socket is back".
     *
     * While disconnected we missed every push, so the caches are stale, and
     * anything the user typed is sitting in the outbox. Both have to be
     * resolved before the app is honestly usable again.
     */
    const onConnect = async () => {
      realtime.setConnected(true);

      const { sent } = await outbox.flush(deliver);

      // Refetch rather than trusting the cache: messages, presence changes and
      // friend requests all happened while we were not listening.
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (sent > 0) {
        realtime.pushToast({
          icon: '📤',
          title: sent === 1 ? 'Message sent' : `${sent} messages sent`,
          body: 'Delivered after reconnecting.',
        });
      }
    };

    const onDisconnect = () => realtime.setConnected(false);

    const onPresenceSync = ({ online }) => realtime.syncPresence(online ?? []);

    const onPresenceChanged = (payload) => {
      realtime.setPresence(payload.userId, {
        status: payload.status,
        customStatus: payload.customStatus,
        lastSeenAt: payload.lastSeenAt,
      });
    };

    const onMessageNew = ({ message }) => {
      // The sender's own pending copy lives in the outbox, not in this cache,
      // so appending is safe — the outbox entry is cleared by its own ack and
      // useMessages filters queued entries against delivered nonces.
      if (message.clientNonce) outbox.remove(message.clientNonce);

      queryClient.setQueryData(['messages', String(message.conversationId)], (old) => {
        if (!old) return old;

        // Guard against the same message arriving twice — a reconnect can
        // replay an event the cache already has.
        if (old.pages.some((page) => page.messages.some((m) => m.id === message.id))) {
          return old;
        }

        // NOTE: this is the RAW cache, where page 0 is the most recently
        // fetched (newest) page. `useMessages` reverses pages for display, so
        // a new message belongs at the end of page 0 — appending to the last
        // page would file it under the oldest history instead.
        const pages = [...old.pages];
        pages[0] = { ...pages[0], messages: [...pages[0].messages, message] };
        return { ...old, pages };
      });

      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const patchMessage = (conversationId, messageId, patch) => {
      queryClient.setQueryData(['messages', String(conversationId)], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
          })),
        };
      });
    };

    const onMessageUpdated = ({ message }) =>
      patchMessage(message.conversationId, message.id, message);

    const onMessageDeleted = ({ conversationId, messageId }) =>
      patchMessage(conversationId, messageId, {
        kind: 'system', body: '', attachments: [], deletedAt: new Date().toISOString(),
      });

    const onReaction = ({ conversationId, messageId, reactions }) =>
      patchMessage(conversationId, messageId, { reactions });

    const onTyping = ({ conversationId, userId, displayName, typing }) => {
      if (String(userId) === String(user.id)) return;
      realtime.setTyping(conversationId, userId, displayName, typing);
    };

    const onReceipt = ({ conversationId, userId, upToMessageId }) =>
      realtime.setReceipt(conversationId, userId, upToMessageId);

    const onNotification = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (payload.type === 'message' && user.settings?.notifications?.messages !== false) {
        realtime.pushToast({
          icon: '💬',
          title: payload.from?.displayName ?? 'New message',
          body: payload.preview,
        });
      }
    };

    const onFriendChange = () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const onFriendUpdated = ({ user: updated }) => {
      queryClient.setQueryData(['friends'], (old) => {
        if (!old) return old;
        return old.map((f) => (f.user.id === updated.id ? { ...f, user: updated } : f));
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('presence:sync', onPresenceSync);
    socket.on('presence:changed', onPresenceChanged);
    socket.on('message:new', onMessageNew);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('message:reaction', onReaction);
    socket.on('typing:update', onTyping);
    socket.on('read:receipt', onReceipt);
    socket.on('notification:new', onNotification);
    socket.on('friend:request', onFriendChange);
    socket.on('friend:accepted', onFriendChange);
    socket.on('friend:restored', onFriendChange);
    socket.on('friend:updated', onFriendUpdated);

    if (socket.connected) realtime.setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('presence:sync', onPresenceSync);
      socket.off('presence:changed', onPresenceChanged);
      socket.off('message:new', onMessageNew);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('message:reaction', onReaction);
      socket.off('typing:update', onTyping);
      socket.off('read:receipt', onReceipt);
      socket.off('notification:new', onNotification);
      socket.off('friend:request', onFriendChange);
      socket.off('friend:accepted', onFriendChange);
      socket.off('friend:restored', onFriendChange);
      socket.off('friend:updated', onFriendUpdated);
    };
  }, [queryClient, user]);
}
