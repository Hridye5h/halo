import { io } from 'socket.io-client';

const BASE = 'http://localhost:4000';
let failures = 0;

function check(label, cond, extra) {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra)}` : ''}`);
}

function makeClient() {
  let access = null;
  let cookie = null;
  return {
    setToken(t) { access = t; },
    async call(method, path, body) {
      const res = await fetch(`${BASE}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(access ? { authorization: `Bearer ${access}` } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, json: await res.json().catch(() => ({})) };
    },
    async connect() {
      const { json } = await this.call('POST', '/auth/socket-ticket');
      // forceNew: socket.io-client otherwise reuses one Manager per URL, so a
      // reconnect after an explicit disconnect() would attach to the closed
      // manager and never establish.
      const socket = io(BASE, {
        auth: { ticket: json.ticket },
        transports: ['websocket'],
        forceNew: true,
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        setTimeout(() => reject(new Error('connect timeout')), 8000);
      });
      return socket;
    },
  };
}

/** Waits for one event, or resolves null on timeout — so a missing event is a
 *  clean assertion failure rather than a hung test run. */
function waitFor(socket, event, ms = 4000, predicate = () => true) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, handler); resolve(null); }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

/** Acks resolve; a missing ack resolves to a timeout marker rather than
 *  hanging the run, so a broken handler fails a check instead of stalling. */
const emit = (socket, event, payload, ms = 8000) => new Promise((resolve) => {
  const timer = setTimeout(
    () => resolve({ ok: false, error: { code: 'ack_timeout', message: 'No ack' } }),
    ms,
  );
  socket.emit(event, payload, (response) => {
    clearTimeout(timer);
    resolve(response);
  });
});

const stamp = Date.now();
const alice = makeClient();
const bob = makeClient();

// --- setup ------------------------------------------------------------------
const aReg = await alice.call('POST', '/auth/register', {
  username: `sa${stamp}`, email: `sa${stamp}@t.dev`, password: 'correct-horse-battery',
  displayName: 'Alice',
});
alice.setToken(aReg.json.accessToken);

const bReg = await bob.call('POST', '/auth/register', {
  username: `sb${stamp}`, email: `sb${stamp}@t.dev`, password: 'correct-horse-battery',
  displayName: 'Bob',
});
bob.setToken(bReg.json.accessToken);

await bob.call('POST', '/friends/request', { friendCode: aReg.json.user.friendCode });
const pending = await alice.call('GET', '/friends/requests');
const accepted = await alice.call('POST', `/friends/${pending.json.incoming[0].friendshipId}/accept`);
const conversationId = accepted.json.conversationId;

// --- handshake --------------------------------------------------------------
const badSocket = io(BASE, { auth: { ticket: 'garbage' }, transports: ['websocket'] });
const rejected = await new Promise((resolve) => {
  badSocket.once('connect_error', () => resolve(true));
  badSocket.once('connect', () => resolve(false));
  setTimeout(() => resolve(false), 4000);
});
check('rejects a forged socket ticket', rejected);
badSocket.close();

const aSocket = await alice.connect();
check('alice connects with a valid ticket', aSocket.connected);

// Bob should learn Alice is online the moment he connects.
const bSocket = await bob.connect();
const sync = await waitFor(bSocket, 'presence:sync');
check('presence syncs on connect',
  sync?.online?.some((o) => String(o.userId) === String(aReg.json.user.id)), sync);

await emit(aSocket, 'conversation:open', { conversationId });
await emit(bSocket, 'conversation:open', { conversationId });

// --- messaging --------------------------------------------------------------
const inbound = waitFor(bSocket, 'message:new');
const ack = await emit(aSocket, 'message:send', {
  conversationId, kind: 'text', body: 'hey, are you around?', clientNonce: 'sock-1',
});
check('send acks with the persisted message', ack?.ok && !!ack.message?.id, ack);

const delivered = await inbound;
check('bob receives it in realtime', delivered?.message?.body === 'hey, are you around?', delivered);

const replay = await emit(aSocket, 'message:send', {
  conversationId, kind: 'text', body: 'hey, are you around?', clientNonce: 'sock-1',
});
check('duplicate nonce returns the original, not a copy',
  replay?.message?.id === ack.message.id && replay?.duplicate === true, replay);

const empty = await emit(aSocket, 'message:send', { conversationId, body: '   ' });
check('rejects an empty message', empty?.ok === false, empty);
check('socket survives a rejected send', aSocket.connected);

const messageId = ack.message.id;

// --- typing -----------------------------------------------------------------
const typingOn = waitFor(bSocket, 'typing:update', 4000, (p) => p.typing === true);
await emit(aSocket, 'typing:start', { conversationId });
const typingEvent = await typingOn;
check('typing start propagates', typingEvent?.typing === true, typingEvent);
check('typing carries a display name', typingEvent?.displayName === 'Alice', typingEvent);

const typingOff = waitFor(bSocket, 'typing:update', 4000, (p) => p.typing === false);
await emit(aSocket, 'typing:stop', { conversationId });
check('typing stop propagates', (await typingOff)?.typing === false);

// --- reactions / edit / delete ----------------------------------------------
const reaction = waitFor(bSocket, 'message:reaction');
await emit(bSocket, 'message:react', { messageId, emoji: '❤️' });
check('reaction fans out', (await reaction)?.reactions?.length === 1);

const toggled = await emit(bSocket, 'message:react', { messageId, emoji: '❤️' });
check('same reaction toggles off', toggled?.reactions?.length === 0, toggled);

const edited = waitFor(bSocket, 'message:updated');
await emit(aSocket, 'message:edit', { messageId, body: 'hey, you around?' });
const editEvent = await edited;
check('edit fans out', editEvent?.message?.body === 'hey, you around?', editEvent);
check('edit is marked', !!editEvent?.message?.editedAt);

const foreignEdit = await emit(bSocket, 'message:edit', { messageId, body: 'not mine' });
check('cannot edit someone else\'s message', foreignEdit?.ok === false, foreignEdit);

// --- read receipts ----------------------------------------------------------
const receipt = waitFor(aSocket, 'read:receipt');
await emit(bSocket, 'read:mark', { conversationId, upToMessageId: messageId });
const receiptEvent = await receipt;
check('read receipt reaches the sender',
  String(receiptEvent?.upToMessageId) === String(messageId), receiptEvent);

// --- deletion ---------------------------------------------------------------
const deleted = waitFor(bSocket, 'message:deleted');
await emit(aSocket, 'message:delete', { messageId });
check('delete fans out', String((await deleted)?.messageId) === String(messageId));

const history = await alice.call('GET', `/conversations/${conversationId}/messages`);
const tombstone = history.json.messages.find((m) => m.id === messageId);
check('deleted message is a tombstone, not a hole',
  !!tombstone && tombstone.deletedAt && tombstone.body === '', tombstone);

// --- surviving a dropped link -----------------------------------------------
// The India ↔ Mexico case: one side drops mid-conversation, the other keeps
// talking, and the queued messages are replayed on reconnect.
const aliceDropped = alice;
aSocket.disconnect();

const whileAway = await emit(bSocket, 'message:send', {
  conversationId, kind: 'text', body: 'sent while you were offline',
  clientNonce: 'offline-1',
});
check('the connected side can still send', whileAway?.ok === true, whileAway);

const aSocket2 = await aliceDropped.connect();
await emit(aSocket2, 'conversation:open', { conversationId });

const backfill = await aliceDropped.call('GET', `/conversations/${conversationId}/messages`);
check('messages missed while offline are there on reconnect',
  backfill.json.messages.some((m) => m.body === 'sent while you were offline'));

// This is exactly what the client outbox replays after a reconnect.
const queued = { conversationId, kind: 'text', body: 'typed while offline', clientNonce: 'q-1' };
const firstTry = await emit(aSocket2, 'message:send', queued);
const replayTry = await emit(aSocket2, 'message:send', queued);
check('replaying a queued message does not duplicate it',
  firstTry?.message?.id === replayTry?.message?.id && replayTry?.duplicate === true,
  { firstTry: firstTry?.message?.id, replayTry: replayTry?.message?.id });

const afterReplay = await aliceDropped.call('GET', `/conversations/${conversationId}/messages`);
check('only one copy is persisted',
  afterReplay.json.messages.filter((m) => m.body === 'typed while offline').length === 1);

// --- presence ---------------------------------------------------------------
// aSocket2 is Alice's live connection from here on — the original was dropped
// deliberately above.
const statusChange = waitFor(bSocket, 'presence:changed', 4000, (p) => p.status === 'studying');
await emit(aSocket2, 'presence:update', { status: 'studying', customStatus: 'endgames' });
const statusEvent = await statusChange;
check('presence intent propagates to friends', statusEvent?.status === 'studying', statusEvent);
check('custom status propagates', statusEvent?.customStatus === 'endgames', statusEvent);

// Offline is debounced by a 2s grace period, so this waits past it.
const wentOffline = waitFor(bSocket, 'presence:changed', 8000, (p) => p.status === 'offline');
aSocket2.close();
const offlineEvent = await wentOffline;
check('disconnect reports offline after the grace period', offlineEvent?.status === 'offline',
  offlineEvent);
check('last seen is included', !!offlineEvent?.lastSeenAt, offlineEvent);

bSocket.close();

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
