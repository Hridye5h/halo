import { useState } from 'react';
import { motion } from 'framer-motion';
import { timeOfDay } from '../../lib/format.js';

const QUICK_REACTIONS = ['❤️', '😂', '😭', '🔥', '👏', '♟'];

export function MessageBubble({
  message, mine, showTail, replyTarget, onReact, onEdit, onDelete, onReply, readByOther,
}) {
  const [hovered, setHovered] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  if (message.deletedAt) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <p className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-xs italic text-muted">
          This message was deleted
        </p>
      </div>
    );
  }

  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-1">
        <p className="rounded-full bg-surface px-3 py-1 text-center text-xs text-muted">
          {message.body}
        </p>
      </div>
    );
  }

  // Encrypted and not readable — either the vault is locked, or this message
  // was encrypted to a key we no longer hold. Say which, rather than showing
  // an empty bubble the user cannot interpret.
  if (message.locked || message.undecryptable) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <p className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-xs italic text-muted">
          {message.undecryptable
            ? '🔒 Encrypted with a different key — cannot be read on this device'
            : message.decrypting ? '🔒 Decrypting…' : '🔒 Locked'}
        </p>
      </div>
    );
  }

  // Reactions arrive as one row per person; the UI wants them grouped.
  const grouped = (message.reactions ?? []).reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: message.pending ? 0.65 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={`group relative flex ${mine ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPicking(false); }}
    >
      <div className={`flex max-w-[min(75%,42rem)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {replyTarget && (
          <div
            className={`mb-1 max-w-full truncate rounded-lg border-l-2 border-accent bg-inset px-2.5 py-1
              text-xs text-secondary ${mine ? 'text-right' : ''}`}
          >
            {replyTarget.body || 'Attachment'}
          </div>
        )}

        <div
          className="relative rounded-2xl text-[0.9375rem] leading-relaxed shadow-sm"
          style={{
            padding: 'var(--bubble-pad, 0.625rem 0.875rem)',
            background: mine ? 'var(--bubble-me)' : 'var(--bubble-them)',
            color: mine ? 'var(--bubble-me-text)' : 'var(--bubble-them-text)',
            borderBottomRightRadius: mine && showTail ? '0.35rem' : undefined,
            borderBottomLeftRadius: !mine && showTail ? '0.35rem' : undefined,
          }}
        >
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = draft.trim();
                if (trimmed && trimmed !== message.body) onEdit(message.id, trimmed);
                setEditing(false);
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                className="w-full min-w-48 bg-transparent text-inherit focus:outline-none"
              />
              <p className="mt-1 text-[10px] opacity-70">Enter to save · Esc to cancel</p>
            </form>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          )}

          <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-60">
            {message.editedAt && <span>edited</span>}
            <span>{timeOfDay(message.createdAt)}</span>
            {mine && (
              <span title={readByOther ? 'Read' : message.pending ? 'Sending' : 'Sent'}>
                {message.failed ? '⚠' : message.pending ? '◌' : readByOther ? '✓✓' : '✓'}
              </span>
            )}
          </div>
        </div>

        {Object.keys(grouped).length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
            {Object.entries(grouped).map(([emoji, count]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(message.id, emoji)}
                className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs transition-transform hover:scale-105"
              >
                <span>{emoji}</span>
                {count > 1 && <span className="text-muted">{count}</span>}
              </button>
            ))}
          </div>
        )}

        {message.failed && (
          <p className="mt-1 text-[11px] text-danger">Failed to send</p>
        )}
      </div>

      {hovered && !editing && (
        <div
          className={`absolute top-0 flex items-center gap-0.5 rounded-lg border border-line
            bg-elevated p-0.5 shadow-lg ${mine ? 'right-full mr-2' : 'left-full ml-2'}`}
        >
          <IconButton title="React" onClick={() => setPicking((p) => !p)}>😊</IconButton>
          <IconButton title="Reply" onClick={() => onReply(message)}>↩</IconButton>
          {mine && (
            <>
              <IconButton title="Edit" onClick={() => { setDraft(message.body); setEditing(true); }}>
                ✎
              </IconButton>
              <IconButton title="Delete" onClick={() => onDelete(message.id)}>🗑</IconButton>
            </>
          )}
        </div>
      )}

      {picking && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`absolute -top-9 z-10 flex gap-0.5 rounded-full border border-line
            bg-elevated px-1.5 py-1 shadow-xl ${mine ? 'right-0' : 'left-0'}`}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => { onReact(message.id, emoji); setPicking(false); }}
              className="rounded-full px-1 text-base transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function IconButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
    >
      {children}
    </button>
  );
}
