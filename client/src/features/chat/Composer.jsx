import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSocket } from '../../lib/socket.js';

/**
 * Typing events are throttled to one per 3s and stopped explicitly on send or
 * on going idle. The server also expires them after 5s — belt and braces,
 * because a closed tab never sends the stop.
 */
const TYPING_THROTTLE_MS = 3000;
const IDLE_STOP_MS = 2500;

export function Composer({ conversationId, replyTo, onCancelReply, onSend, disabled }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);
  const lastTypingAt = useRef(0);
  const idleTimer = useRef(null);

  // Auto-grow, capped — a message should not push the conversation off screen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    setValue('');
  }, [conversationId]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  function signalTyping() {
    const socket = getSocket();
    if (!socket) return;

    const now = Date.now();
    if (now - lastTypingAt.current > TYPING_THROTTLE_MS) {
      lastTypingAt.current = now;
      socket.emit('typing:start', { conversationId });
    }

    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      lastTypingAt.current = 0;
      socket.emit('typing:stop', { conversationId });
    }, IDLE_STOP_MS);
  }

  function submit() {
    const body = value.trim();
    if (!body || disabled) return;

    clearTimeout(idleTimer.current);
    lastTypingAt.current = 0;
    getSocket()?.emit('typing:stop', { conversationId });

    onSend({ body, replyTo: replyTo?.id ?? null });
    setValue('');
    onCancelReply?.();
  }

  return (
    <div className="border-t border-line bg-surface/60 px-4 py-3 backdrop-blur">
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center gap-2 overflow-hidden"
          >
            <div className="min-w-0 flex-1 truncate rounded-lg border-l-2 border-accent bg-inset px-3 py-1.5 text-xs text-secondary">
              <span className="text-muted">Replying to </span>
              {replyTo.body || 'Attachment'}
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-primary"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2 rounded-2xl border border-line bg-inset px-3 py-2 transition-colors focus-within:border-accent">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={disabled ? 'You cannot send messages here' : 'Message…'}
          onChange={(e) => { setValue(e.target.value); signalTyping(); }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat user already has in their fingers.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-[0.9375rem] text-primary placeholder:text-muted focus:outline-none disabled:cursor-not-allowed scroll-thin"
        />

        <motion.button
          type="button"
          onClick={submit}
          disabled={!value.trim() || disabled}
          whileTap={{ scale: 0.9 }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-contrast transition-opacity disabled:opacity-30"
          title="Send"
        >
          ↑
        </motion.button>
      </div>
    </div>
  );
}
