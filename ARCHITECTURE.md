# Halo — Architecture & Blueprint

> A private communication platform for a small, permanent circle of people.
> Not a chatbot. Not a social network. A place where a friendship has a home
> that outlives any single account, username, or platform.

**Working name:** Halo (`halo`) — placeholder, easy to rename in one commit.

---

## 0. The thesis

Most chat products optimise for *scale*: millions of weak ties, discovery,
engagement. This one optimises for the opposite — a handful of strong ties,
zero discovery, and **durability**. That single inversion drives nearly every
design decision below:

| Mainstream chat app | Halo |
| --- | --- |
| Identity = username/phone; lose it, lose the graph | Identity = keypair-backed **Friend Code**; the edge survives account loss |
| History is a feed you scroll past | History is an **archive** with a timeline, gallery, and stats |
| Presence is a green dot | Presence is **expressive** (studying / playing / sleeping) |
| Theming = light/dark | Theming = a **token system** users can author and share |
| Server owns the relationship | Server is a **transport + archive**; the relationship is portable |

Everything else — the media pipeline, the chess integrations, the shared
memories page — is a consequence of taking "this friendship should be
preservable" seriously.

---

## 1. Scope: what v1 actually is

I am scoping this in three rings so it can ship instead of sprawling. A feature
list this large fails by never being finished, not by being wrong.

### Ring 1 — the spine (must exist for the product to mean anything)
Auth · Friend Codes · 1:1 realtime chat · presence · profiles · themes ·
message persistence · reactions/replies/edit/delete · typing · read receipts

### Ring 2 — the soul (what makes it *this* product, not a chat clone)
Friendship Timeline · Shared Gallery · Shared Memories stats · media uploads
(image/video/voice/file) · pinned messages · search · notifications

### Ring 3 — the flourish (real, but they depend on Rings 1–2 being solid)
Chess integrations (PGN viewer, challenge cards, link unfurling) · voice/video
calls · custom theme authoring + sharing · E2E "vault" conversations · groups

**This document specifies all three. The code I'm writing tonight implements
Ring 1 end-to-end and lays the seams for Rings 2–3** — meaning the models,
events, and interfaces the later rings need already exist, even where the UI
doesn't yet.

---

## 2. Stack, and why

You proposed Node/Express/Socket.IO/MongoDB/JWT + React/Tailwind/Framer. That's
a good stack and I'm keeping essentially all of it. My changes and reasoning:

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | **Node 24, ESM** | Native `--watch`, no nodemon, no Babel |
| HTTP | **Express 5** | Async error propagation is built in — Express 4 needed a wrapper for every route |
| Realtime | **Socket.IO 4** | Rooms + ack callbacks + automatic reconnect/backoff. Raw `ws` would mean rebuilding all three |
| DB | **MongoDB + Mongoose 8** | Messages are document-shaped and schema-drifty (text vs. media vs. chess card). Relational would mean a join per message type |
| Dev DB | **`mongodb-memory-server`** | You have no Docker and no local `mongod`. This boots a real MongoDB in-process so `npm run dev` works tonight with zero setup, and `MONGO_URI` swaps in Atlas later |
| Auth | **JWT access + rotating refresh** | See §5 — plain long-lived JWTs can't be revoked, which is unacceptable for a private app |
| Validation | **Zod** | One schema validates the request *and* types the handler |
| Frontend | **React 19 + Vite** | Vite for instant HMR |
| State (server) | **TanStack Query** | Chat is mostly cached server state, not client state. Hand-rolling this in Zustand is the classic mistake |
| State (client) | **Zustand** | Only for genuinely local state: theme, composer draft, UI toggles |
| Styling | **Tailwind v4 + CSS variables** | Critical: see §7. Tailwind alone *cannot* express a user-authored theme system; CSS variables can |
| Motion | **Framer Motion** | Layout animations for the message list are the whole reason to include it |

### Two deliberate deviations from your spec

**1. Redis is in the design, but not in v1.**
Presence and socket fan-out live in process memory for now. This is correct at
your scale (2–20 users, one server) and wrong the moment you run two instances.
The code isolates this behind `services/presence.service.js` and the Socket.IO
adapter, so switching to `@socket.io/redis-adapter` + a Redis presence store is
a ~50-line change, not a refactor. I've marked the seam in the code.

**2. Cloudinary *or* S3, not both.**
You listed Cloudinary for images and Firebase/S3 for files. Running two storage
backends doubles the credential surface and the failure modes for no benefit.
I've built a `StorageProvider` interface with a local-disk implementation
(works tonight) and an S3-compatible one. Cloudinary's real value is
transformation, which I've replaced with server-side `sharp` thumbnailing —
one dependency, no vendor.

---

## 3. Repository layout

```
ChatBot/
├─ ARCHITECTURE.md          ← this file
├─ README.md                ← how to run it
├─ package.json             ← npm workspaces root
├─ server/
│  └─ src/
│     ├─ index.js           ← process entry: db → http → sockets
│     ├─ app.js             ← express app (no listen; testable)
│     ├─ config/            ← env parsing, db connection
│     ├─ models/            ← mongoose schemas
│     ├─ routes/            ← thin: path → middleware → controller
│     ├─ controllers/       ← request/response only
│     ├─ services/          ← business logic, no req/res
│     ├─ sockets/           ← realtime gateway + per-domain handlers
│     ├─ middleware/        ← auth, validation, errors
│     └─ lib/               ← pure helpers (friend codes, errors, logger)
└─ client/
   └─ src/
      ├─ app/               ← router, providers, layout shell
      ├─ features/          ← auth/ chat/ friends/ profile/ timeline/ …
      ├─ components/ui/     ← design-system primitives
      ├─ lib/               ← api client, socket client, formatters
      ├─ stores/            ← zustand
      └─ styles/            ← theme tokens + themes
```

**The rule that keeps this maintainable:** controllers never contain business
logic, services never touch `req`/`res`, and socket handlers call the *same
services* as the HTTP controllers. A message sent over a socket and a message
sent over REST must be indistinguishable at rest — otherwise you get two
divergent code paths and one of them will always be the buggy one.

---

## 4. Data model

Seven collections. Notes on the non-obvious choices follow.

### `User`
```
_id, username (unique, lowercased, immutable-ish)
displayName, avatarUrl, bannerUrl, bio (500), countryCode, pronouns
friendCode          ← permanent, unique, human-readable  (§6)
identityToken       ← permanent, secret, hashed          (§6)
passwordHash        ← argon2id
presence: { status, customStatus, lastSeenAt, lastActiveAt, autoAway }
settings: { theme, customTheme, hideLastSeen, invisible, notifications{...} }
badges: [{ key, label, icon, awardedAt }]
chess:  { chesscomUsername, lichessUsername }
createdAt (= join date), updatedAt
```

### `Friendship`
One document per *pair*, not per direction — a bidirectional edge stored twice
is a data-integrity bug waiting to happen (you will eventually accept one side
and not the other).

```
pair: [userA, userB]   ← always sorted by _id, so the pair is canonical
status: pending | accepted | blocked
requestedBy, respondedAt
establishedAt          ← the friendship's birthday, drives the Timeline
stats: { messageCount, gamesPlayed, voiceNotes, hoursTalked, … }  ← denormalised
```
`unique` index on `pair` — sorting makes "are these two already friends?" a
single indexed lookup instead of a two-branch `$or`.

### `Conversation`
```
type: dm | group
participants: [userId]
friendshipId?          ← DMs link back to the edge
pinnedMessages: [messageId]
lastMessage: { _id, preview, senderId, sentAt }   ← denormalised for the list
encryption: { mode: standard | vault, ... }
```

### `Message`
The polymorphic one. A single `kind` discriminator instead of separate
collections, because the chat renders them interleaved in one ordered stream —
separate collections would mean merge-sorting on every page load.

```
conversationId, senderId, kind
kind: text | image | video | voice | file | chess_game | chess_puzzle | system
body                      ← text/caption
attachments: [{ url, thumbUrl, mime, size, width, height, durationMs, waveform }]
chess: { platform, gameId, pgn, fen, result, timeControl, puzzleId }
replyTo                   ← messageId
reactions: [{ emoji, userId, at }]
readBy:    [{ userId, at }]
editedAt, deletedAt       ← soft delete: tombstone, never destroy
createdAt
```
Index: `{ conversationId: 1, createdAt: -1 }` — every message query is
"latest N in this conversation", so this one compound index serves the entire
chat. Plus a `text` index on `body` for search.

### `TimelineEvent`
The Friendship Timeline is *not* computed by scanning messages at render time —
that's an O(all history) query on every page view. Events are **emitted** when
they happen and appended here.

```
friendshipId, type, occurredAt, actorId, meta{}, autoGenerated
type: first_message | first_voice_note | first_call | milestone_messages
    | games_played | badge_earned | anniversary | custom
```
This makes the timeline a cheap indexed read, and lets you hand-author entries
("the day we actually met"). It's also why it stays fast when there are
200,000 messages.

### `RefreshToken`
`{ userId, tokenHash, family, expiresAt, revokedAt, replacedBy, ua, ip }` — §5.

### `Notification`
`{ userId, type, actorId, entityRef, readAt, createdAt }`

---

## 5. Auth & session design

Plain JWT-in-localStorage is the default tutorial answer and it's wrong for
this app: it can't be revoked, and localStorage is XSS-readable.

**The scheme:**
- **Access token** — JWT, 15 min, held *in memory only* (never localStorage).
- **Refresh token** — opaque random 256-bit string, `httpOnly` + `Secure` +
  `SameSite=Strict` cookie, 30 days, **stored hashed** server-side.
- **Rotation** — every refresh issues a new token and revokes the old one.
- **Reuse detection** — refresh tokens carry a `family` id. If an already-revoked
  token is presented, the entire family is revoked and every session dies.
  That is the signal of a stolen token, and it's the whole reason to store
  refresh tokens server-side at all.

Password hashing is **argon2id**, not bcrypt — bcrypt silently truncates at 72
bytes and is weaker against GPU attack.

A short-lived signed ticket is issued for the Socket.IO handshake so the access
token never rides in a query string (query strings land in logs).

---

## 6. Friend Codes & Identity Tokens — the core idea

This is the feature the whole product is named around, so it deserves precision.
Your instinct was right; here's how it holds up under adversarial conditions.

### Friend Code — the *public* handle
Format: `XXXX-XXXX`, **Crockford base32** (no `I`, `L`, `O`, `U` — so no
0/O or 1/l confusion when read aloud or over a bad connection), with a final
check character.

```
7JXK-92QF
```

- Permanent for the account's life; survives username/email/avatar changes.
- Generated at signup from CSPRNG bytes, uniqueness-checked, retried on collision.
- 32^7 ≈ 34 billion values, so guessing is infeasible — but see the rate limit
  below, because "infeasible to guess" is not the same as "safe to enumerate".
- Adding by code creates a **pending** request, never an automatic friendship.
  A code is an *address*, not a capability.

**Enumeration defence:** the lookup endpoint is rate-limited per account
(and per IP), and returns an identical response shape for "no such code" and
"exists" until a request is actually sent. Without this, someone could sweep
the space and build a user directory — which is exactly the discovery mechanic
this product exists to not have.

### Identity Token — the *private* recovery key
Your "Emergency Contact Token". Sharper version:

- A high-entropy secret shown to the user **exactly once**, formatted as a
  10-word mnemonic phrase (~60 bits) rather than hex — people transcribe this
  by hand, and words survive that where hex does not.
- The server stores only `argon2id(token)` — a database leak does not let an
  attacker impersonate the friendship.
- **What it does:** proves "the account behind this new user is the same person
  you were friends with", letting a *rebuilt* account re-inherit the friendship
  edge, its timeline, and its shared history.
- **What it must never do:** log you in. It is a *re-linking* credential, not an
  authentication one. Conflating the two turns a recovery convenience into a
  full account-takeover vector.

**The re-link flow, with consent:**
1. A user loses their account and creates a new one.
2. They enter their Identity Token.
3. The server verifies the hash and finds the friendships the old identity held.
4. **Every friend on the other side gets a confirmation prompt** — "Someone
   claiming to be @ana wants to restore your friendship. Restored history:
   1,204 messages, 18 shared photos. Approve?"
5. On approval, the `Friendship`, its `TimelineEvent`s, and the `Conversation`
   re-point to the new `userId`. The old user doc is tombstoned, not deleted.

Step 4 is the part that's easy to skip and must not be. Without it, anyone who
obtains the token silently inherits a private history. With it, the token is a
*request* to reconnect and the human is still the authority — which is also
what makes the feature emotionally correct, not just secure.

---

## 7. The theme system

You asked for an interface better than Chess.com or WhatsApp, with custom
themes. Themes are where that promise is either kept or broken, so this is
designed rather than assembled.

**The problem with the naive approach:** `dark:` variants in Tailwind give you
exactly two themes, both hardcoded at build time. Six themes plus user-authored
ones is a combinatorial mess that way — you'd write `dark:bg-x cyberpunk:bg-y`
on every element.

**The approach:** one semantic token layer in CSS variables; Tailwind consumes
the variables and never names a colour directly.

```
Layer 1  primitives     --violet-500, --slate-900        (raw palette)
Layer 2  semantics      --bg-base, --bg-surface, --text-primary,
                        --accent, --border, --danger      (what things mean)
Layer 3  components     Tailwind classes → bg-surface, text-primary
```

A theme is then *just a set of Layer-2 values* — a JSON object. Which means:

- Switching themes = swapping ~24 CSS variables on `<html>`. No re-render, no
  flash, and it animates.
- A **custom theme is user data**, storable on the `User` doc, and therefore
  shareable as a code and syncable across devices. This falls out for free
  *only* because of the token layer — it is the entire payoff of the design.
- Accessibility is checkable: every theme is validated for WCAG AA contrast
  between `--text-primary` and `--bg-base` before it can be saved. A gorgeous
  theme you can't read is a bug.

Shipping themes: **Midnight** (default), **Chess**, **Galaxy**, **Cyberpunk**,
**Forest**, **Sakura**, plus **Custom**.

**Beyond colour** — this is what actually separates it from WhatsApp:
density control (comfortable/compact), a real type scale, motion that respects
`prefers-reduced-motion`, keyboard-first navigation with a `⌘K` command
palette, and optimistic message send so the UI never waits on the network.

---

## 8. Realtime architecture

### Rooms
- `user:{userId}` — every socket a user has open. Presence and notifications
  fan out here, so all their devices stay in sync.
- `conv:{conversationId}` — joined on open. Messages, typing, reactions.

### Event contract
Namespaced `noun:verb`. Client→server events use **ack callbacks** so the
client learns the persisted `_id` and can reconcile its optimistic message.

```
C→S   message:send   {conversationId, kind, body, replyTo, clientNonce}  → ack {message}
      message:edit / message:delete / message:react
      typing:start / typing:stop
      presence:update  {status, customStatus}
      conversation:open / conversation:close
      read:mark  {conversationId, upToMessageId}

S→C   message:new / message:updated / message:deleted / message:reaction
      typing:update  {conversationId, userIds[]}
      presence:changed  {userId, status, customStatus, lastSeenAt}
      read:receipt / notification:new / friend:request / friend:accepted
```

### Three details that are load-bearing

**`clientNonce` + optimistic UI.** The client renders the message instantly with
a temp id, then swaps in the server's on ack. The nonce also makes send
**idempotent** — a reconnect-retry can't duplicate a message. Without it,
flaky mobile networks produce double-sends, which is the single most common
bug in hand-rolled chat apps.

**Typing is throttled and self-expiring.** `typing:start` fires at most once per
3s and the server expires it after 5s. Otherwise a dropped `typing:stop` leaves
someone "typing…" forever.

**Presence is derived, not declared.** `status` is the user's *intent*
(Studying, Playing). Online/offline is computed from live socket count, with a
2-minute grace period so a page refresh doesn't flicker the dot. `lastSeenAt`
only writes on disconnect — writing it per-event would be a DB write per
keystroke.

---

## 9. Media pipeline

```
1. client  POST /api/media/sign     → { uploadUrl, mediaId }
2. client  PUT bytes directly to storage (bypasses the API server entirely)
3. client  POST /api/media/complete → server verifies, probes, thumbnails
4. server  returns the attachment descriptor
5. client  message:send with the attachment
```

Uploading *through* the Node process is the obvious approach and the wrong one:
a 200 MB video would occupy an event-loop worker and blow memory. Presigned
direct-to-storage keeps the API server stateless and fast.

- Validation is on **magic bytes**, not the file extension or client-supplied
  MIME — both are trivially forged.
- Images → `sharp` → WebP thumbnail + blurhash placeholder (so the layout never
  jumps while loading).
- Voice notes → Opus, with a peak-amplitude **waveform array precomputed
  server-side** and stored on the attachment. Computing it client-side means
  every viewer re-downloads and re-decodes the whole file just to draw the bars.
- Everything is also written to the **Shared Gallery** index as it arrives, so
  the gallery is a query, not a scan.

---

## 10. Distance: designing for intercontinental links

A private circle is rarely in one city. The worked example throughout this
section is **India ↔ Mexico** — roughly 12,000 km and 11.5 hours apart, close
to the worst case — because assumptions that hold fine for users sharing a
metro area break completely at that distance.

### Latency and dropped links

A good India–Mexico round trip is 250–350 ms; on mobile data it is worse and
frequently interrupted. Concretely:

- **Socket.IO defaults are wrong here.** The stock 20 s `pingTimeout` /
  25 s `pingInterval` will drop a connection that is merely slow. Every false
  disconnect costs a full handshake and a visible flicker. Raised to 60 s / 25 s,
  with `connectTimeout` at 60 s so a bad moment during login is not a failure.
- **Compression on** (`perMessageDeflate` above 1 KB) — on a long-haul mobile
  link, bandwidth is the constraint, not CPU.

### The outbox — the actual guarantee

Optimistic UI alone is not enough. If the socket drops mid-send, an optimistic
message is a lie: it is on screen and nowhere else. So:

> **Every message is written to `localStorage` before it is attempted, and
> removed only when the server acknowledges it.**

Anything still in the outbox is replayed on reconnect and after a page reload.
This is safe — not reckless — precisely because of the `clientNonce`
idempotency from §8: replaying cannot create a duplicate. The two features are
designed as a pair; either alone is insufficient.

Details that matter:

- **Flush is strictly sequential.** Messages must arrive in the order they were
  typed; firing the queue in parallel over a lossy link reorders them.
- **Flush stops at the first failure** rather than burning the whole queue
  against a link that is plainly down.
- **A message gives up after 50 attempts.** Something rejected on its merits
  (blocked conversation, deleted account) would otherwise retry on every
  reconnect for the lifetime of the browser profile.
- **Reconnect is not just "socket is back."** Every push was missed while
  disconnected, so the caches are stale: the client invalidates messages,
  conversations, friends, requests and notifications on reconnect.

### Timezones

Across a large offset, presence cannot answer the question people actually
have. "Offline" at 2 pm and "online" at 4 am mean completely different things,
and neither is visible from a green dot.

So each user's IANA zone is captured automatically from the browser
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) — never a dropdown — and
friends see **their local time** in the friends list, the chat header, and the
profile, plus a 🌙 when it is the middle of the night for them.

The hour gap is rounded to the **nearest half hour**, not the nearest hour.
India is UTC+05:30, Nepal +05:45, parts of Australia +09:30; whole-hour
rounding would tell a user in Delhi they are "11h" from Mexico City when the
answer is 11.5. Being half an hour wrong about someone's bedtime defeats the
entire point of showing it.

All timestamps remain UTC on the wire and are formatted at the edge, so
"Last seen 8:31 PM" always means *the viewer's* 8:31 PM.

---

## 11. Vault mode — end-to-end encryption

*End-to-end encryption* and *server-side message search* are in direct
conflict: if the server can index it, the server can read it. Anyone claiming
otherwise is selling something. So it is a per-conversation choice, stated
plainly in the UI rather than hidden:

- **Standard (default):** TLS in transit, encrypted at rest, server can read.
  Full server-side search, history syncs to a new device instantly.
- **Vault:** keys never leave the device. Search runs client-side.

### How it works

| | |
| --- | --- |
| Identity | ECDH **P-256** keypair, generated in the browser |
| Key agreement | `ECDH(myPrivate, theirPublic)` → **HKDF-SHA256** → AES-256-GCM key |
| Messages | **AES-256-GCM**, fresh random 96-bit IV per message |
| Key at rest | Wrapped with AES-GCM under **PBKDF2-SHA256, 600k iterations** |

**P-256 rather than X25519**, deliberately: X25519 only reached WebCrypto in
very recent browsers, and a key exchange that silently fails on someone's phone
is worse than a less fashionable curve. P-256 ECDH is available everywhere and
is not the weak link.

**The conversation id is bound in as HKDF salt.** The same pair of identity
keys therefore yields a different key per conversation, so one compromised
conversation key does not unlock the others.

**The passphrase is separate from the account password.** The server verifies
the password; reusing it would put the one secret protecting the messages
within reach of the server at sign-in.

### Enforcement, not just intent

A client bug that skipped encryption would silently write readable messages
into a thread the users believe is private — the one failure mode that must not
be quiet. So the server **rejects plaintext** in a vault conversation, on both
the send and edit paths, and stores `🔒 Encrypted message` as the conversation
preview so a plaintext body can never leak into the conversation list. Search
returns an explicit error rather than an empty list that would read as "no
results".

Enabling vault mode is **one-way**. Everything already written stays
encrypted, so allowing "off" would produce a half-readable conversation with no
honest way to describe it.

### Safety numbers — closing the substitution hole

Public keys are distributed *by the server*. A malicious or compromised server
could hand you its own key instead of your friend's and read everything in the
middle. No amount of cipher strength prevents this; strong AES over a key you
negotiated with an impostor is perfectly encrypted and perfectly readable by
them.

The only defence is comparing keys over a channel the server does not control.
Each profile therefore shows a **safety number** — `SHA-256(publicKey)`
truncated to five groups of four hex characters:

```
5CC2 3243 AD9B 82E4 0659
```

Both people should see the same string. Reading it out on a call takes ten
seconds and is the difference between "encrypted" and "encrypted *to the right
person*". A key change also pushes a `friend:keyChanged` event, so a silent
substitution cannot pass unnoticed.

### What this does not give you

This is stated in the docs, in the code, and in the confirmation dialog,
because encryption that is oversold is worse than none:

- **No forward secrecy.** The shared secret is static, so someone who steals a
  private key *and* has stored ciphertext can decrypt past messages. Real
  forward secrecy needs a ratchet (X3DH + Double Ratchet) — a much larger build.
- **Metadata is not hidden.** Who talked to whom, when, and how often remains
  visible to the server.
- **History does not follow you to a new device** unless you restore the key
  file. There is deliberately no server-side copy to fall back on.
- **Not independently audited.** A careful implementation of standard
  primitives is not a substitute for Signal against a determined state actor.

Verified by 25 tests in `client/tests/crypto.test.mjs` — both sides derive the
same key, a third party cannot, keys do not cross conversations, tampered
ciphertext and wrong passphrases are rejected — plus server-side tests proving
plaintext is refused and previews leak nothing.

---

## 12. Roadmap

| Phase | Deliverable |
| --- | --- |
| **1** | Monorepo, auth + rotation, User/Friendship/Conversation/Message, Socket.IO gateway, theme engine, chat UI, presence, friend codes |
| **2** | Media pipeline, gallery, reactions/pins/search UI, notifications |
| **3** | Timeline + memories/stats, badges, identity-token recovery flow |
| **4** | Chess: link unfurling, PGN viewer, challenge cards, opening explorer |
| **5** | WebRTC voice/video/screenshare (mesh; 1:1 needs no SFU) |
| **6** | Groups, PWA + push, forward secrecy (Double Ratchet) for vault mode |

**Phase 1 is what I'm building tonight.**

---

## 13. Things I'd get wrong if I didn't write them down

- **Message pagination must be cursor-based** (`createdAt` + `_id`), never
  `skip`/`limit`. `skip` degrades linearly and breaks when messages arrive
  mid-scroll.
- **Never hard-delete a message.** Tombstone it. Hard deletes break reply
  chains, reaction counts, and the timeline.
- **Denormalised counters drift.** `Friendship.stats` needs a nightly
  reconciliation job. Design for the drift instead of pretending it won't happen.
- **Timezones.** Store UTC everywhere, format at the edge. "Last seen 8:31 PM"
  must mean *the viewer's* 8:31 PM.
- **The socket is not a database.** If a socket write fails, the HTTP path must
  still be able to produce the same result. Same services, both paths.
