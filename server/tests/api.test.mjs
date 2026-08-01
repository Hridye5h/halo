const BASE = 'http://localhost:4000/api';
let failures = 0;

function check(label, cond, extra) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`${mark}  ${label}${extra && !cond ? `  -> ${JSON.stringify(extra)}` : ''}`);
}

// A tiny cookie jar so refresh-token rotation can actually be exercised.
function makeClient() {
  let access = null;
  let cookie = null;
  return {
    get token() { return access; },
    setToken(t) { access = t; },
    async call(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(access ? { authorization: `Bearer ${access}` } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    },
  };
}

const stamp = Date.now();
const alice = makeClient();
const bob = makeClient();

// --- registration -----------------------------------------------------------
const aReg = await alice.call('POST', '/auth/register', {
  username: `alice${stamp}`, email: `alice${stamp}@test.dev`,
  password: 'correct-horse-battery', displayName: 'Alice',
});
check('register alice', aReg.status === 201, aReg.json);
check('identity token returned once', typeof aReg.json.identityToken === 'string'
  && aReg.json.identityToken.split('-').length === 10, aReg.json.identityToken);
check('friend code shape', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(aReg.json.user?.friendCode),
  aReg.json.user?.friendCode);
check('password hash never serialised', !JSON.stringify(aReg.json).includes('argon2'));
alice.setToken(aReg.json.accessToken);

const bReg = await bob.call('POST', '/auth/register', {
  username: `bob${stamp}`, email: `bob${stamp}@test.dev`,
  password: 'correct-horse-battery', displayName: 'Bob',
});
check('register bob', bReg.status === 201, bReg.json);
bob.setToken(bReg.json.accessToken);

// --- validation -------------------------------------------------------------
const badReg = await makeClient().call('POST', '/auth/register', {
  username: 'x', email: 'nope', password: '123',
});
check('rejects bad registration', badReg.status === 400, badReg.json);

const dupe = await makeClient().call('POST', '/auth/register', {
  username: `alice${stamp}`, email: `other${stamp}@test.dev`, password: 'correct-horse-battery',
});
check('rejects duplicate username', dupe.status === 409, dupe.json);

// --- auth -------------------------------------------------------------------
const badLogin = await makeClient().call('POST', '/auth/login', {
  identifier: `alice${stamp}`, password: 'wrong',
});
check('rejects wrong password', badLogin.status === 401, badLogin.json);

const noAuth = await makeClient().call('GET', '/friends');
check('rejects missing token', noAuth.status === 401, noAuth.json);

const refreshed = await alice.call('POST', '/auth/refresh');
check('refresh rotates', refreshed.status === 200 && !!refreshed.json.accessToken, refreshed.json);
alice.setToken(refreshed.json.accessToken);

// --- friend codes -----------------------------------------------------------
const code = aReg.json.user.friendCode;
const lower = await bob.call('POST', '/friends/lookup', { friendCode: code.toLowerCase() });
check('friend code is case/format tolerant', lower.status === 200, lower.json);

const typo = await bob.call('POST', '/friends/lookup', { friendCode: 'ZZZZ-ZZZZ' });
check('rejects bad check character', typo.status === 404, typo.json);

const self = await alice.call('POST', '/friends/request', { friendCode: code });
check('cannot friend yourself', self.status === 400, self.json);

const req = await bob.call('POST', '/friends/request', { friendCode: code });
check('bob requests alice', req.status === 201, req.json);

const dupeReq = await bob.call('POST', '/friends/request', { friendCode: code });
check('duplicate request rejected', dupeReq.status === 409, dupeReq.json);

const pending = await alice.call('GET', '/friends/requests');
check('alice sees incoming request', pending.json.incoming?.length === 1, pending.json);

const friendshipId = pending.json.incoming[0].friendshipId;
const accepted = await alice.call('POST', `/friends/${friendshipId}/accept`);
check('alice accepts', accepted.status === 200 && !!accepted.json.conversationId, accepted.json);

const conversationId = accepted.json.conversationId;

const list = await alice.call('GET', '/friends');
check('friend list populated', list.json.friends?.length === 1, list.json);
check('friend list carries conversation', !!list.json.friends?.[0]?.conversationId);

// --- messaging --------------------------------------------------------------
const m1 = await alice.call('POST', `/conversations/${conversationId}/messages`, {
  body: 'first message', clientNonce: 'n1',
});
check('alice sends', m1.status === 201, m1.json);

const replay = await alice.call('POST', `/conversations/${conversationId}/messages`, {
  body: 'first message', clientNonce: 'n1',
});
check('nonce makes send idempotent',
  replay.status === 201 && replay.json.message.id === m1.json.message.id, replay.json);

await bob.call('POST', `/conversations/${conversationId}/messages`, { body: 'Afreen Afreen' });

const outsider = makeClient();
const cReg = await outsider.call('POST', '/auth/register', {
  username: `carol${stamp}`, email: `carol${stamp}@test.dev`, password: 'correct-horse-battery',
});
outsider.setToken(cReg.json.accessToken);
const intrusion = await outsider.call('GET', `/conversations/${conversationId}/messages`);
check('non-member cannot read conversation', intrusion.status === 403, intrusion.json);

const profileSnoop = await outsider.call('GET', `/users/${aReg.json.user.id}`);
check('non-friend cannot read profile', profileSnoop.status === 403, profileSnoop.json);

const history = await alice.call('GET', `/conversations/${conversationId}/messages`);
check('history reads back in order',
  history.json.messages?.length === 2 && history.json.messages[0].body === 'first message',
  history.json);

const search = await alice.call('GET', `/conversations/${conversationId}/search?q=afre`);
check('substring search works', search.json.results?.length === 1, search.json);

// --- pins -------------------------------------------------------------------
const pinTarget = m1.json.message.id;
const pinned = await alice.call('POST', `/conversations/${conversationId}/pins/${pinTarget}`);
check('message pins', pinned.json.pinnedMessages?.length === 1, pinned.json);
const unpinned = await alice.call('POST', `/conversations/${conversationId}/pins/${pinTarget}`);
check('pin toggles off', unpinned.json.pinnedMessages?.length === 0, unpinned.json);

// --- timeline ---------------------------------------------------------------
const tl = await alice.call('GET', `/friends/${friendshipId}/timeline`);
const types = (tl.json.events ?? []).map((e) => e.type);
check('timeline recorded friendship start', types.includes('friendship_started'), types);
check('timeline recorded first message', types.includes('first_message'), types);

// --- conversation list ------------------------------------------------------
const convos = await alice.call('GET', '/conversations');
check('conversation list has preview',
  convos.json.conversations?.[0]?.lastMessage?.preview?.length > 0, convos.json);

const unreadBefore = (await bob.call('GET', '/conversations')).json.conversations[0].unreadCount;
check('unread counted for bob', unreadBefore > 0, unreadBefore);
await bob.call('POST', `/conversations/${conversationId}/read`);
const unreadAfter = (await bob.call('GET', '/conversations')).json.conversations[0].unreadCount;
check('unread clears after read', unreadAfter === 0, unreadAfter);

// --- profile + settings -----------------------------------------------------
const patched = await alice.call('PATCH', '/users/me', {
  bio: 'chess, music, long messages', countryCode: 'IN', pronouns: 'she/her',
});
check('profile updates', patched.json.user?.bio?.includes('chess'), patched.json);

const themed = await alice.call('PATCH', '/users/me/settings', {
  theme: 'galaxy', density: 'compact',
});
check('settings persist', themed.json.settings?.theme === 'galaxy', themed.json);

// --- timezone (India ↔ Mexico) ----------------------------------------------
const tz = await alice.call('PATCH', '/users/me', { timezone: 'Asia/Kolkata' });
check('timezone persists', tz.json.user?.timezone === 'Asia/Kolkata', tz.json.user);

await bob.call('PATCH', '/users/me', { timezone: 'America/Mexico_City' });
const friendView = await alice.call('GET', '/friends');
check('friend timezone is visible to friends',
  friendView.json.friends?.[0]?.user?.timezone === 'America/Mexico_City',
  friendView.json.friends?.[0]?.user);

const badTz = await alice.call('PATCH', '/users/me', { timezone: 'x'.repeat(200) });
check('rejects an absurd timezone', badTz.status === 400, badTz.json);

// --- vault mode (end-to-end encryption) -------------------------------------
const noKeys = await alice.call('POST', `/conversations/${conversationId}/vault`);
check('vault refuses to enable without published keys', noKeys.status === 400, noKeys.json);

// Real SPKI-encoded ECDH P-256 public keys, generated here so the server sees
// exactly what a browser would send.
async function publicKeyBase64() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return Buffer.from(spki).toString('base64');
}

const aliceKey = await alice.call('PUT', '/users/me/keys', { publicKey: await publicKeyBase64() });
check('publishes a public key', aliceKey.status === 200, aliceKey.json);

const junkKey = await alice.call('PUT', '/users/me/keys', { publicKey: 'nope' });
check('rejects a malformed public key', junkKey.status === 400, junkKey.json);

await bob.call('PUT', '/users/me/keys', { publicKey: await publicKeyBase64() });

const enabled = await alice.call('POST', `/conversations/${conversationId}/vault`);
check('vault enables once both have keys',
  enabled.json.encryption?.mode === 'vault', enabled.json);

const plaintextAttempt = await alice.call('POST', `/conversations/${conversationId}/messages`, {
  body: 'this should never be stored in the clear',
});
check('server refuses plaintext in an encrypted conversation',
  plaintextAttempt.status === 400, plaintextAttempt.json);

const cipher = 'v1.YWJjZGVmZ2hpamts.c29tZSBjaXBoZXJ0ZXh0IGhlcmU=';
const encryptedSend = await alice.call('POST', `/conversations/${conversationId}/messages`, {
  body: cipher, encrypted: true,
});
check('accepts ciphertext', encryptedSend.status === 201, encryptedSend.json);
check('stores the ciphertext verbatim', encryptedSend.json.message?.body === cipher);
check('marks the message encrypted', encryptedSend.json.message?.encrypted === true);

const listed = await alice.call('GET', '/conversations');
const vaultConv = listed.json.conversations.find((c) => String(c.id) === String(conversationId));
check('conversation preview leaks nothing',
  vaultConv?.lastMessage?.preview === '🔒 Encrypted message', vaultConv?.lastMessage);

const vaultSearch = await alice.call('GET', `/conversations/${conversationId}/search?q=never`);
check('server-side search is refused, not silently empty',
  vaultSearch.status === 400, vaultSearch.json);

const outsiderRead = await outsider.call('GET', `/conversations/${conversationId}/messages`);
check('non-member still cannot read the encrypted thread', outsiderRead.status === 403);

const hidden = await alice.call('PATCH', '/users/me/settings', { invisible: true });
check('invisible accepted', hidden.json.settings?.invisible === true, hidden.json);
const asSeenByBob = await bob.call('GET', `/users/${aReg.json.user.id}`);
check('invisible reads as offline to friends',
  asSeenByBob.json.user?.presence?.status === 'offline', asSeenByBob.json.user?.presence);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
