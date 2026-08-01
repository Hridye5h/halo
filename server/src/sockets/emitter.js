/**
 * Holds the Socket.IO server so HTTP routes can push realtime events without
 * importing the gateway (which imports the services, which would import the
 * routes — a cycle).
 *
 * Every emit is a no-op before `setIo` runs, so nothing crashes if a service
 * fires an event during boot or inside a test with no socket server.
 */
let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

export const roomForUser = (userId) => `user:${userId}`;
export const roomForConversation = (conversationId) => `conv:${conversationId}`;

/** Reaches every device the user has open. */
export function emitToUser(userId, event, payload) {
  io?.to(roomForUser(userId)).emit(event, payload);
}

export function emitToUsers(userIds, event, payload) {
  userIds?.forEach((id) => emitToUser(id, event, payload));
}

export function emitToConversation(conversationId, event, payload) {
  io?.to(roomForConversation(conversationId)).emit(event, payload);
}

/** Fan-out that skips the originating socket — used for echoes the sender
 *  already rendered optimistically. */
export function emitToConversationExcept(socket, conversationId, event, payload) {
  socket.to(roomForConversation(conversationId)).emit(event, payload);
}
