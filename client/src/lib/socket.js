import { io } from 'socket.io-client';
import { api } from './api.js';

let socket = null;

/**
 * Connects the realtime socket.
 *
 * The handshake uses a short-lived ticket rather than the access token: the
 * token would end up in the URL for polling transports, and URLs get logged.
 * `auth` is a function so Socket.IO re-fetches a fresh ticket on every
 * reconnect attempt — a stale ticket would make reconnection fail silently.
 */
export async function connectSocket() {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  socket = io({
    path: '/socket.io',
    autoConnect: true,
    transports: ['websocket', 'polling'],
    auth: async (cb) => {
      try {
        const { ticket } = await api.post('/auth/socket-ticket');
        cb({ ticket });
      } catch {
        cb({});
      }
    },
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/**
 * Promise wrapper around an ack-based emit, with a timeout.
 *
 * Without the timeout a dropped connection leaves the caller awaiting forever,
 * which in the composer means a message stuck in "sending" with no way out.
 */
export function emitWithAck(event, payload, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Not connected'));
      return;
    }

    const timer = setTimeout(() => reject(new Error('Timed out')), timeoutMs);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error?.message ?? 'Failed'));
    });
  });
}
