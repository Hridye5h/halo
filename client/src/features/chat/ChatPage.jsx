import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../../lib/api.js';
import { getSocket } from '../../lib/socket.js';
import { useAuth } from '../../stores/useAuth.js';
import { useRealtime } from '../../stores/useRealtime.js';
import { useVault } from '../../stores/useVault.js';
import { VaultModal } from '../vault/VaultModal.jsx';
import { useMessages } from './useMessages.js';
import { MessageBubble } from './MessageBubble.jsx';
import { Composer } from './Composer.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import {
  dayLabel, lastSeen, presenceOf, timezoneLabel, isLikelyAsleep,
} from '../../lib/format.js';

export function ChatPage() {
  const { conversationId } = useParams();
  const user = useAuth((s) => s.user);
  const presence = useRealtime((s) => s.presence);
  const typing = useRealtime((s) => s.typing[conversationId]);
  const receipts = useRealtime((s) => s.receipts[conversationId]);

  const [replyTo, setReplyTo] = useState(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => (await api.get(`/conversations/${conversationId}`)).conversation,
    enabled: !!conversationId,
  });

  const other = conversation?.participants?.find((p) => p.id !== user?.id);
  const vaultEnabled = conversation?.encryption?.mode === 'vault';
  const vaultStatus = useVault((s) => s.status);
  const [vaultModal, setVaultModal] = useState(null);

  const {
    messages, send, edit, remove, react, markRead,
    fetchNextPage, hasNextPage, isFetchingNextPage, isLoading,
  } = useMessages(conversationId, { vaultEnabled, theirPublicKey: other?.publicKey });

  const status = presence[other?.id]?.status ?? other?.presence?.status ?? 'offline';
  const customStatus = presence[other?.id]?.customStatus ?? other?.presence?.customStatus;
  const typers = Object.values(typing ?? {});

  // Join the room on open so messages arrive for this conversation, and leave
  // on close so typing indicators do not leak across chats.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !conversationId) return undefined;
    socket.emit('conversation:open', { conversationId });
    return () => socket.emit('conversation:close', { conversationId });
  }, [conversationId]);

  // Only auto-scroll when the reader is already at the bottom. Yanking someone
  // out of the history they are reading is the single rudest thing a chat can do.
  useEffect(() => {
    if (!pinnedToBottom.current) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.pending || !document.hasFocus()) return;
    if (String(last.senderId) === String(user?.id)) return;
    markRead(last.id);
  }, [messages, markRead, user]);

  function onScroll(e) {
    const el = e.currentTarget;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    if (el.scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
      // Preserve the reading position across a prepend, or loading older
      // messages visibly throws the user up the list.
      const previousHeight = el.scrollHeight;
      fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          el.scrollTop += el.scrollHeight - previousHeight;
        });
      });
    }
  }

  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );

  const otherReadUpTo = other ? receipts?.[other.id] : null;

  if (!conversationId) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface/60 px-5 py-3 backdrop-blur">
        <Link to="/" className="text-muted hover:text-primary lg:hidden">←</Link>
        {other && (
          <>
            <Link to={`/profile/${other.id}`}>
              <Avatar user={other} status={status} size="md" />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                to={`/profile/${other.id}`}
                className="block truncate font-medium text-primary hover:underline"
              >
                {other.displayName}
              </Link>
              <p className="truncate text-xs text-secondary">
                {typers.length > 0 ? (
                  <span className="text-accent">typing…</span>
                ) : customStatus ? (
                  customStatus
                ) : status === 'offline' ? (
                  `Last seen ${lastSeen(other.presence?.lastSeenAt).toLowerCase()}`
                ) : (
                  `${presenceOf(status).icon} ${presenceOf(status).label}`
                )}
              </p>
            </div>
            <TheirTime timezone={other.timezone} />

            <VaultButton
              enabled={vaultEnabled}
              status={vaultStatus}
              conversationId={conversationId}
              otherName={other.displayName}
              otherHasKey={!!other.publicKey}
              onNeedKey={setVaultModal}
            />

            {conversation?.friendshipId && (
              <Link
                to={`/timeline/${conversation.friendshipId}`}
                className="rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
              >
                Timeline
              </Link>
            )}
          </>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto scroll-thin px-5 py-4"
      >
        {isFetchingNextPage && (
          <p className="pb-3 text-center text-xs text-muted">Loading older messages…</p>
        )}
        {!hasNextPage && !isLoading && messages.length > 0 && (
          <p className="pb-4 text-center text-xs text-muted">
            This is where it all started.
          </p>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-10 w-48 animate-pulse rounded-2xl bg-surface ${i % 2 ? 'ml-auto' : ''}`}
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyChat name={other?.displayName} />
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--row-gap, 0.5rem)' }}>
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const mine = String(message.senderId) === String(user?.id);
              const newDay = !previous
                || new Date(previous.createdAt).toDateString()
                  !== new Date(message.createdAt).toDateString();
              const next = messages[index + 1];
              const showTail = !next || String(next.senderId) !== String(message.senderId);

              return (
                <div key={message.id}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3">
                      <span className="h-px flex-1 bg-line" />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                        {dayLabel(message.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    mine={mine}
                    showTail={showTail}
                    replyTarget={message.replyTo ? byId.get(message.replyTo) : null}
                    readByOther={mine && otherReadUpTo && message.id <= otherReadUpTo}
                    onReact={react}
                    onEdit={edit}
                    onDelete={remove}
                    onReply={setReplyTo}
                  />
                </div>
              );
            })}
          </div>
        )}

        <AnimatePresence>
          {typers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 flex items-center gap-2"
            >
              <div
                className="flex items-center gap-1 rounded-2xl px-3.5 py-2.5"
                style={{ background: 'var(--bubble-them)' }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-current opacity-50"
                    style={{ animation: `typing-bounce 1.2s ${i * 0.15}s infinite` }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted">{typers.join(', ')} is typing</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {vaultEnabled && vaultStatus !== 'unlocked' ? (
        <div className="border-t border-line bg-surface/60 px-4 py-4 text-center">
          <p className="text-sm text-secondary">
            🔒 This conversation is end-to-end encrypted.
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setVaultModal(vaultStatus === 'absent' ? 'restore' : 'unlock')}
          >
            {vaultStatus === 'absent' ? 'Restore your key' : 'Unlock to read and reply'}
          </Button>
        </div>
      ) : (
        <Composer
          conversationId={conversationId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
        />
      )}

      <VaultModal
        open={!!vaultModal}
        mode={vaultModal}
        onClose={() => setVaultModal(null)}
      />
    </div>
  );
}

/**
 * The lock control.
 *
 * Turning encryption on is one-way, so the confirmation spells out both what
 * is gained and what is lost — a user who discovers afterwards that search
 * stopped working, or that their history will not follow them to a new phone,
 * was not given a fair choice.
 */
function VaultButton({ enabled, status, conversationId, otherName, otherHasKey, onNeedKey }) {
  const queryClient = useQueryClient();
  const vaultStatus = useVault((s) => s.status);
  const [busy, setBusy] = useState(false);

  async function enable() {
    if (vaultStatus !== 'unlocked') {
      onNeedKey(vaultStatus === 'absent' ? 'create' : 'unlock');
      return;
    }
    if (!otherHasKey) {
      window.alert(`${otherName} needs to set up their encryption key first.`);
      return;
    }

    const confirmed = window.confirm(
      'Turn on end-to-end encryption?\n\n'
      + '• Only the two of you can read messages from this point — not the server.\n'
      + '• Server-side search stops working; search runs on your device instead.\n'
      + '• History will not appear on a new device unless you restore your key file.\n'
      + '• This cannot be turned off.',
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.post(`/conversations/${conversationId}/vault`);
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <button
        type="button"
        onClick={() => status !== 'unlocked' && onNeedKey(status === 'absent' ? 'restore' : 'unlock')}
        title={status === 'unlocked'
          ? 'End-to-end encrypted — only your devices can read this'
          : 'Encrypted. Unlock to read.'}
        className="rounded-lg px-2.5 py-1.5 text-xs text-success transition-colors hover:bg-hover"
      >
        {status === 'unlocked' ? '🔒 Encrypted' : '🔒 Locked'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy}
      title="Turn on end-to-end encryption"
      className="rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
    >
      🔓 Encrypt
    </button>
  );
}

/** Ticks once a minute — a clock that is wrong is worse than no clock. */
function TheirTime({ timezone }) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!timezone) return undefined;
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [timezone]);

  const label = timezoneLabel(timezone);
  if (!label) return null;

  const asleep = isLikelyAsleep(timezone);

  return (
    <span
      title={asleep ? 'It is the middle of the night for them' : 'Their local time'}
      className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-secondary sm:flex"
    >
      {asleep && <span aria-hidden>🌙</span>}
      {label}
    </span>
  );
}

function EmptyChat({ name }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-2xl">
          ✦
        </div>
        <p className="mt-4 font-medium text-primary">
          {name ? `Say something to ${name}` : 'Say something'}
        </p>
        <p className="mt-1 text-sm text-secondary">
          Everything from here gets kept.
        </p>
      </div>
    </div>
  );
}
