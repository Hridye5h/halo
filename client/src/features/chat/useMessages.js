import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { emitWithAck, getSocket } from '../../lib/socket.js';
import { useAuth } from '../../stores/useAuth.js';
import { useVault } from '../../stores/useVault.js';
import * as outbox from '../../lib/outbox.js';
import { encryptMessage, decryptMessage, isCiphertext } from '../../lib/crypto.js';

/** Sends one outbox entry. Shared by the live path and the reconnect flush so
 *  there is exactly one definition of what sending means. */
export function deliver(entry) {
  return emitWithAck('message:send', {
    conversationId: entry.conversationId,
    kind: 'text',
    body: entry.body,
    replyTo: entry.replyTo,
    clientNonce: entry.clientNonce,
    encrypted: !!entry.encrypted,
  });
}

/**
 * Message history + sending.
 *
 * Pagination is cursor-based (`before`), never offset — offsets shift under
 * you the moment a new message arrives mid-scroll.
 *
 * In a vault conversation, bodies are encrypted before they reach the outbox
 * and decrypted here for display. That ordering matters: what gets persisted
 * to localStorage is ciphertext, so a queued message is no more readable on
 * disk than it is on the server.
 */
export function useMessages(conversationId, { vaultEnabled = false, theirPublicKey = null } = {}) {
  const user = useAuth((s) => s.user);
  const vaultStatus = useVault((s) => s.status);
  const keyFor = useVault((s) => s.keyFor);
  const [queued, setQueued] = useState(() => outbox.pendingFor(conversationId));
  const [plaintexts, setPlaintexts] = useState({});

  useEffect(() => {
    setQueued(outbox.pendingFor(conversationId));
    return outbox.subscribe(() => setQueued(outbox.pendingFor(conversationId)));
  }, [conversationId]);

  const query = useInfiniteQuery({
    queryKey: ['messages', String(conversationId)],
    enabled: !!conversationId,
    initialPageParam: null,
    queryFn: ({ pageParam }) => api.get(
      `/conversations/${conversationId}/messages?limit=40${pageParam ? `&before=${pageParam}` : ''}`,
    ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Pages arrive newest-first; the UI wants oldest-first top to bottom.
    select: (data) => ({ ...data, pages: [...data.pages].reverse() }),
  });

  const delivered = useMemo(
    () => query.data?.pages.flatMap((page) => page.messages) ?? [],
    [query.data],
  );

  /**
   * Decrypts anything encrypted that we do not already hold plaintext for.
   *
   * Results are cached by message id, so scrolling back through history does
   * not re-run AES over the same messages on every render.
   */
  useEffect(() => {
    if (vaultStatus !== 'unlocked' || !theirPublicKey) return;

    const pending = delivered.filter(
      (m) => m.encrypted && isCiphertext(m.body) && plaintexts[m.id] === undefined,
    );
    if (!pending.length) return;

    let cancelled = false;

    (async () => {
      try {
        const key = await keyFor(conversationId, theirPublicKey);
        const resolved = {};

        for (const message of pending) {
          try {
            resolved[message.id] = await decryptMessage(key, message.body);
          } catch {
            // One unreadable message must not blank the whole conversation —
            // most likely a key rotation, so mark just this one.
            resolved[message.id] = null;
          }
        }

        if (!cancelled) setPlaintexts((prev) => ({ ...prev, ...resolved }));
      } catch {
        // Key derivation failed; the UI already shows the locked state.
      }
    })();

    return () => { cancelled = true; };
  }, [delivered, vaultStatus, theirPublicKey, conversationId, keyFor, plaintexts]);

  const messages = useMemo(() => {
    const readable = delivered.map((message) => {
      if (!message.encrypted) return message;

      const plaintext = plaintexts[message.id];
      if (plaintext === undefined) {
        return { ...message, body: '', locked: true, decrypting: vaultStatus === 'unlocked' };
      }
      if (plaintext === null) return { ...message, body: '', undecryptable: true };
      return { ...message, body: plaintext };
    });

    const deliveredNonces = new Set(delivered.map((m) => m.clientNonce).filter(Boolean));

    // Queued entries carry their plaintext alongside the ciphertext purely so
    // the sender can read their own unsent message; only `body` is persisted
    // to the server, and the outbox stores the ciphertext.
    const pendingRows = queued
      .filter((entry) => !deliveredNonces.has(entry.clientNonce))
      .map((entry) => ({
        id: `queued-${entry.clientNonce}`,
        conversationId: entry.conversationId,
        senderId: user?.id,
        kind: 'text',
        body: entry.preview ?? entry.body,
        attachments: [],
        reactions: [],
        readBy: [],
        replyTo: entry.replyTo ?? null,
        createdAt: new Date(entry.queuedAt).toISOString(),
        clientNonce: entry.clientNonce,
        pending: true,
        queued: true,
      }));

    return [...readable, ...pendingRows];
  }, [delivered, plaintexts, queued, user, vaultStatus]);

  const send = useCallback(async ({ body, replyTo }) => {
    let payload = body;
    let encrypted = false;

    if (vaultEnabled) {
      // Fail loudly rather than sending plaintext into a conversation the user
      // believes is private. The server rejects it too, but the user deserves
      // the error before the message leaves the device.
      const key = await keyFor(conversationId, theirPublicKey);
      payload = await encryptMessage(key, body);
      encrypted = true;
    }

    const entry = outbox.enqueue({
      clientNonce: crypto.randomUUID(),
      conversationId,
      body: payload,
      // Local-only, so the sender can read their own queued message. Stripped
      // by `deliver`, which sends `body` alone.
      preview: encrypted ? body : undefined,
      encrypted,
      replyTo: replyTo ?? null,
    });

    try {
      await deliver(entry);
      outbox.remove(entry.clientNonce);
    } catch {
      // Stays queued; the reconnect flush delivers it.
    }
  }, [conversationId, vaultEnabled, theirPublicKey, keyFor]);

  const edit = useCallback(async (messageId, body) => {
    let payload = body;
    if (vaultEnabled) {
      const key = await keyFor(conversationId, theirPublicKey);
      payload = await encryptMessage(key, body);
    }
    // Optimistically show the new plaintext; the socket echo confirms it.
    setPlaintexts((prev) => (vaultEnabled ? { ...prev, [messageId]: body } : prev));
    return emitWithAck('message:edit', { messageId, body: payload });
  }, [conversationId, vaultEnabled, theirPublicKey, keyFor]);

  const remove = useCallback(
    (messageId) => emitWithAck('message:delete', { messageId }),
    [],
  );

  const react = useCallback(
    (messageId, emoji) => emitWithAck('message:react', { messageId, emoji }),
    [],
  );

  const markRead = useCallback((upToMessageId) => {
    getSocket()?.emit('read:mark', { conversationId, upToMessageId });
  }, [conversationId]);

  /** Client-side search — the only kind possible once a thread is encrypted. */
  const searchLocal = useCallback((term) => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return messages.filter((m) => m.body?.toLowerCase().includes(needle));
  }, [messages]);

  return {
    ...query, messages, send, edit, remove, react, markRead, searchLocal,
    queuedCount: queued.length,
  };
}
