/**
 * Durable outbox for unsent messages.
 *
 * On a long-haul intercontinental link the socket WILL drop mid-sentence, and
 * a phone switching from wifi to mobile data drops it every single time. The
 * unacceptable outcome is text the user typed disappearing because it happened
 * to be in flight at the wrong moment.
 *
 * So every send is written to localStorage BEFORE it is attempted, and only
 * removed once the server has acknowledged it. Anything still here on reload
 * or reconnect gets retried. Combined with the server's `clientNonce`
 * idempotency, a retry can never produce a duplicate — which is what makes
 * "just retry everything" safe rather than reckless.
 */
const KEY = 'halo:outbox:v1';
const MAX_ATTEMPTS = 50;

let listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable storage must not take the app down with it.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or private mode — the in-memory path still works.
  }
  listeners.forEach((fn) => fn(entries));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const list = read;

export function pendingFor(conversationId) {
  return read().filter((e) => String(e.conversationId) === String(conversationId));
}

export function enqueue(entry) {
  const entries = read();
  if (entries.some((e) => e.clientNonce === entry.clientNonce)) return entry;

  const stored = { ...entry, queuedAt: Date.now(), attempts: 0 };
  write([...entries, stored]);
  return stored;
}

export function remove(clientNonce) {
  write(read().filter((e) => e.clientNonce !== clientNonce));
}

function markAttempted(clientNonce) {
  const entries = read().map((e) =>
    (e.clientNonce === clientNonce ? { ...e, attempts: (e.attempts ?? 0) + 1 } : e));

  // Drop anything hopeless rather than retrying forever — a message rejected
  // on its merits (blocked conversation, deleted account) would otherwise
  // retry on every reconnect for the lifetime of the browser profile.
  write(entries.filter((e) => (e.attempts ?? 0) < MAX_ATTEMPTS));
}

/**
 * Flushes the queue in order.
 *
 * Strictly sequential: messages must arrive in the order they were typed, and
 * firing them in parallel over a lossy link reorders them.
 */
let flushing = false;

export async function flush(sendFn) {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    for (const entry of read()) {
      try {
        await sendFn(entry);
        remove(entry.clientNonce);
        sent += 1;
      } catch {
        markAttempted(entry.clientNonce);
        failed += 1;
        // Stop at the first failure: the link is down, and hammering the
        // remaining queue just burns attempts against the cap.
        break;
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, failed };
}
