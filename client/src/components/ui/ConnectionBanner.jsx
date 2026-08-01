import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRealtime } from '../../stores/useRealtime.js';
import * as outbox from '../../lib/outbox.js';

/**
 * Tells the truth about the connection.
 *
 * On a link this long, brief drops are normal and constant. Showing a banner
 * the instant the socket blinks would make the app feel broken when it is
 * merely slow — so it waits before complaining, and it says what is actually
 * happening to the user's unsent messages rather than just "offline".
 */
const GRACE_MS = 2500;

export function ConnectionBanner() {
  const connected = useRealtime((s) => s.connected);
  const [visible, setVisible] = useState(false);
  const [queued, setQueued] = useState(() => outbox.list().length);

  useEffect(() => outbox.subscribe((entries) => setQueued(entries.length)), []);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          role="status"
          className="absolute inset-x-0 top-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium"
          style={{ background: 'var(--warn)', color: '#1a1206' }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          Reconnecting…
          {queued > 0 && (
            <span className="opacity-80">
              {queued === 1
                ? '1 message will send when you are back'
                : `${queued} messages will send when you are back`}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
