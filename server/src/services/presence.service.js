import { User } from '../models/User.js';

/**
 * Presence.
 *
 * Two separate concepts that are easy to conflate:
 *   - connectivity — do they have a live socket? Derived, never declared.
 *   - intent       — "studying", "playing". Declared by the user, and it
 *                    persists across reconnects.
 *
 * SCALING SEAM: this map is per-process. With more than one server instance
 * each would see only its own sockets. Swapping this module for a Redis-backed
 * store plus `@socket.io/redis-adapter` is the whole change — nothing outside
 * this file knows how presence is stored.
 */
const sockets = new Map(); // userId -> Set<socketId>
const intents = new Map(); // userId -> { status, customStatus }

/** A refresh drops and re-adds a socket within milliseconds; without a grace
 *  period every page load would flash the dot offline and back. */
const OFFLINE_GRACE_MS = 2000;
const pendingOffline = new Map();

export function isOnline(userId) {
  return (sockets.get(String(userId))?.size ?? 0) > 0;
}

export function onlineUserIds() {
  return [...sockets.keys()];
}

export function getIntent(userId) {
  return intents.get(String(userId)) ?? { status: 'online', customStatus: '' };
}

/** @returns {boolean} true if this connection took the user from offline→online */
export function addSocket(userId, socketId) {
  const key = String(userId);

  const pending = pendingOffline.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingOffline.delete(key);
  }

  const wasOnline = isOnline(key);
  if (!sockets.has(key)) sockets.set(key, new Set());
  sockets.get(key).add(socketId);

  return !wasOnline;
}

/**
 * Removes a socket. `onOffline` fires only once the grace period elapses with
 * no reconnection — so callers get a debounced, trustworthy offline signal.
 */
export function removeSocket(userId, socketId, onOffline) {
  const key = String(userId);
  const set = sockets.get(key);
  if (!set) return;

  set.delete(socketId);
  if (set.size > 0) return;

  sockets.delete(key);
  const timer = setTimeout(async () => {
    pendingOffline.delete(key);
    if (isOnline(key)) return; // reconnected inside the grace window

    // lastSeenAt is written only here. Writing it per-event would mean a
    // database write on every keystroke.
    await User.updateOne(
      { _id: key },
      { $set: { 'presence.status': 'offline', 'presence.lastSeenAt': new Date() } },
    ).catch(() => {});

    intents.delete(key);
    onOffline?.(key);
  }, OFFLINE_GRACE_MS);

  pendingOffline.set(key, timer);
}

export async function setIntent(userId, { status, customStatus }) {
  const key = String(userId);
  const current = getIntent(key);
  const next = {
    status: status ?? current.status,
    customStatus: customStatus ?? current.customStatus,
  };
  intents.set(key, next);

  await User.updateOne({ _id: key }, {
    $set: {
      'presence.status': next.status,
      'presence.customStatus': next.customStatus,
      'presence.lastActiveAt': new Date(),
    },
  });

  return next;
}

/**
 * The status another user should see. Invisible mode always reads as offline
 * to everyone else; the user's own client resolves their real status locally.
 */
export function visibleStatus(user) {
  if (user.settings?.invisible) return 'offline';
  if (!isOnline(user._id)) return 'offline';
  return getIntent(user._id).status;
}
