import { create } from 'zustand';

/**
 * Ephemeral realtime state: who is online, who is typing, live receipts.
 *
 * Deliberately separate from TanStack Query, which owns *server* state
 * (messages, friends, profiles). Mixing the two is the usual mistake — this
 * data has no fetch, no cache key, and no staleness, it is just pushed.
 */
export const useRealtime = create((set, get) => ({
  connected: false,
  presence: {}, // userId -> { status, customStatus, lastSeenAt }
  typing: {},   // conversationId -> { userId: displayName }
  receipts: {}, // conversationId -> { userId: upToMessageId }
  toasts: [],

  setConnected: (connected) => set({ connected }),

  syncPresence(entries) {
    const presence = { ...get().presence };
    entries.forEach(({ userId, status, customStatus }) => {
      presence[userId] = { ...presence[userId], status, customStatus };
    });
    set({ presence });
  },

  setPresence(userId, patch) {
    set({ presence: { ...get().presence, [userId]: { ...get().presence[userId], ...patch } } });
  },

  statusOf(userId, fallback = 'offline') {
    return get().presence[userId]?.status ?? fallback;
  },

  setTyping(conversationId, userId, displayName, isTyping) {
    const byConversation = { ...(get().typing[conversationId] ?? {}) };
    if (isTyping) byConversation[userId] = displayName ?? 'Someone';
    else delete byConversation[userId];

    set({ typing: { ...get().typing, [conversationId]: byConversation } });
  },

  typersIn(conversationId) {
    return Object.values(get().typing[conversationId] ?? {});
  },

  setReceipt(conversationId, userId, upToMessageId) {
    const forConversation = { ...(get().receipts[conversationId] ?? {}), [userId]: upToMessageId };
    set({ receipts: { ...get().receipts, [conversationId]: forConversation } });
  },

  pushToast(toast) {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, ...toast }] });
    setTimeout(() => get().dismissToast(id), toast.duration ?? 4500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
