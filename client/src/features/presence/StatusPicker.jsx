import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../stores/useAuth.js';
import { useRealtime } from '../../stores/useRealtime.js';
import { getSocket } from '../../lib/socket.js';
import { PRESENCE } from '../../lib/format.js';

const OPTIONS = ['online', 'away', 'studying', 'playing', 'sleeping'];

export function StatusPicker() {
  const user = useAuth((s) => s.user);
  const presence = useRealtime((s) => s.presence);
  const setPresence = useRealtime((s) => s.setPresence);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const current = presence[user?.id]?.status ?? user?.presence?.status ?? 'online';
  const custom = presence[user?.id]?.customStatus ?? user?.presence?.customStatus ?? '';

  function update(patch) {
    // Applied locally first — your own status must never lag your own click.
    setPresence(user.id, patch);
    getSocket()?.emit('presence:update', patch);
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((status) => {
          const option = PRESENCE[status];
          const active = current === status;

          return (
            <button
              key={status}
              type="button"
              onClick={() => update({ status })}
              className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs
                font-medium transition-colors
                ${active ? 'text-accent-contrast' : 'text-secondary hover:bg-hover hover:text-primary'}`}
            >
              {active && (
                <motion.span
                  layoutId="status-pill"
                  className="absolute inset-0 rounded-full bg-accent"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative">{option.icon}</span>
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.form
              key="edit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={(e) => {
                e.preventDefault();
                update({ customStatus: draft.slice(0, 64) });
                setEditing(false);
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={draft}
                maxLength={64}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(false)}
                placeholder="What are you up to?"
                className="flex-1 rounded-lg bg-inset px-3 py-1.5 text-sm text-primary placeholder:text-muted focus:outline-none"
              />
            </motion.form>
          ) : (
            <motion.button
              key="view"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setDraft(custom); setEditing(true); }}
              className="w-full text-left text-sm text-secondary transition-colors hover:text-primary"
            >
              {custom || <span className="text-muted">Set a custom status…</span>}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
