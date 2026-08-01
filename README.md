# Halo

A private communication platform for a small, permanent circle of people.

Chat, presence, profiles, themes — plus the things a general-purpose messenger
has no reason to build: a **friendship timeline**, a **shared gallery**, and
**friend codes** that let a connection survive losing an account entirely.

The full design rationale is in [ARCHITECTURE.md](ARCHITECTURE.md). This file
is just how to run it.

---

## Run it

```bash
npm install
```

```bash
npm run dev
```

That is the whole setup. **No database to install.** With no `MONGO_URI` set,
the server boots a real MongoDB in-process (`mongodb-memory-server`), so it
works on a machine with no Docker and no local `mongod`.

- Client → http://localhost:5173
- API → http://localhost:4000/api

> In-memory data is wiped on every restart. Point `MONGO_URI` at a real
> database (Atlas has a free tier) when you want it to persist.

### Demo data

```bash
npm run dev:seed
```

Seeds two accounts with a two-week-old friendship, conversation history,
and timeline events:

| Username | Password |
| --- | --- |
| `demo_alex` | `demo-password-1234` |
| `demo_robin` | `demo-password-1234` |

### Tests

With the server running:

```bash
npm test
```

25 crypto, 17 outbox, 49 API and 27 realtime assertions covering auth,
end-to-end encryption, friend codes,
authorization boundaries, message idempotency, typing, reactions, read
receipts, soft deletes, presence transitions, timezones, and the
drop-and-reconnect path.

The outbox tests run without a server:

```bash
npm run test --workspace client
```

---

## What works right now

| Area | Status |
| --- | --- |
| Register / login / session refresh with token rotation | ✅ |
| Friend codes — lookup, request, accept, decline, block | ✅ |
| Identity tokens — issue + claim with friend approval | ✅ backend, UI pending |
| Realtime messaging, optimistic send, idempotent retries | ✅ |
| Edit, delete (tombstoned), reply, reactions, pins | ✅ |
| Typing indicators, read receipts, unread counts | ✅ |
| Presence — 6 states, custom status, invisible mode | ✅ |
| Profiles — bio, flag, pronouns, badges, chess handles | ✅ |
| 6 themes + custom theme studio with contrast validation | ✅ |
| Message search, conversation list, friendship timeline | ✅ |
| Offline outbox — nothing lost when the link drops | ✅ |
| Friend's local time + timezone gap | ✅ |
| **End-to-end encryption** (opt-in per conversation) | ✅ |
| Media uploads, voice notes, gallery | ⏳ designed, not built |
| Chess integrations (PGN viewer, challenges) | ⏳ designed, not built |
| Voice / video calls | ⏳ designed, not built |

The unbuilt rows are Rings 2–3 in [ARCHITECTURE.md](ARCHITECTURE.md#1-scope-what-v1-actually-is).
Their data models and socket events already exist, so they are additive rather
than a rewrite.

---

## Layout

```
server/src/
  config/      env parsing, database connection
  models/      mongoose schemas
  routes/      path → middleware → handler
  services/    business logic (no req/res — shared by HTTP and sockets)
  sockets/     realtime gateway + per-domain handlers
  middleware/  auth, validation, error translation
  lib/         pure helpers (friend codes, errors, logging)

client/src/
  app/         router, shell, socket→state bridge
  features/    auth/ chat/ friends/ home/ presence/ profile/ settings/ timeline/
  components/  design-system primitives
  lib/         api client, socket client, theme runtime, formatters
  stores/      zustand (client state only)
  styles/      theme token definitions
```

**The rule that keeps it maintainable:** a message sent over a socket and one
sent over REST hit the same service and are indistinguishable at rest. Two code
paths for one operation means one of them is always the buggy one.

---

## Deploying

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. Short version: build the client, and
the API serves it from the same origin — one thing to deploy, no CORS
preflight, and the refresh cookie stays `SameSite=Strict`.

```bash
npm run build
```

```bash
npm start --workspace server
```

`Dockerfile`, `fly.toml` and `render.yaml` are included and default to
**Frankfurt**, which balances round-trip time across widely separated regions
rather than favouring one end. DEPLOYMENT.md §1 has the numbers.

---

## Configuration

Everything has a working default in development. For production, set:

```
NODE_ENV=production
MONGO_URI=mongodb+srv://...
CLIENT_ORIGIN=https://your.domain
JWT_ACCESS_SECRET=<32+ random bytes>
JWT_REFRESH_SECRET=<32+ random bytes>
SOCKET_TICKET_SECRET=<32+ random bytes>
IDENTITY_PEPPER=<32+ random bytes>
```

The server **refuses to start** in production without these. In development it
generates them per-process — convenient, but it means every restart invalidates
existing sessions, which is exactly why it is not allowed in production.

---

## Notable design decisions

Short version; the reasoning is in [ARCHITECTURE.md](ARCHITECTURE.md).

- **Access tokens live in memory, never localStorage.** Refresh tokens are
  httpOnly cookies, stored hashed, rotated on every use, with reuse detection
  that kills the whole token family.
- **Friend codes use Crockford base32** (no `I`/`L`/`O`/`U`) with a check
  character, so a code read aloud or typed from a screenshot still works.
- **Identity tokens cannot log you in.** They only *request* a re-link, and the
  friend on the other side approves it. Conflating recovery with authentication
  turns a convenience into an account-takeover vector.
- **Themes are a token layer, not a stylesheet.** Nothing in the app names a
  colour, which is what makes user-authored themes possible at all.
- **Messages are tombstoned, never destroyed** — hard deletes break reply
  chains and reaction counts.
- **Vault mode is real end-to-end encryption** — ECDH P-256 → HKDF →
  AES-256-GCM, keys wrapped under PBKDF2 (600k). The server *rejects* plaintext
  in an encrypted conversation rather than trusting the client to encrypt. Its
  limits (no forward secrecy, metadata still visible, unaudited) are stated in
  [§11](ARCHITECTURE.md#11-vault-mode--end-to-end-encryption) rather than
  glossed over.
- **Pagination is cursor-based**, never `skip`/`limit`.
- **Built for intercontinental links.** Messages are written to a
  `localStorage` outbox *before* they are sent and replayed on reconnect,
  socket timeouts are tuned for 300 ms round trips, and each friend's local
  time is shown because a large offset makes "are they around?" a timezone
  question, not a presence one.
  See [§10](ARCHITECTURE.md#10-distance-designing-for-intercontinental-links).
