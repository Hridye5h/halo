# Deploying Halo

Everything here has been verified locally in real `NODE_ENV=production` mode —
single-origin serving, SPA fallback, CSP, websockets, and the full test suite.

---

## 1. Where to host — read this before picking a region

If your users are far apart, the region is not a detail. The worked example
below is **India ↔ Mexico**, close to the worst case:

| Server region | → India (RTT) | → Mexico (RTT) | Verdict |
| --- | --- | --- | --- |
| **Frankfurt / Amsterdam** | ~110–140 ms | ~120–160 ms | **Balanced — pick this** |
| US East (Virginia) | ~200–250 ms | ~50–70 ms | Great for one end, sluggish for the other |
| US Central (Chicago) | ~220–250 ms | ~45–60 ms | Same problem, slightly worse |
| Mumbai | ~30–50 ms | ~280–320 ms | Mirror image of the same problem |

These are approximate — real numbers vary by ISP and time of day — but the
*shape* is what matters. Two points that far apart are nearly antipodal, so the
total path is roughly constant wherever the server sits. What changes is
**who absorbs the delay**.

Hosting in the Americas makes it excellent for the Mexico end and poor for the
India end. Europe sits near the midpoint of both routes, so each side gets
~130 ms — responsive for both.

**Recommendation: Frankfurt** (`fra` on Fly, `frankfurt` on Render). The configs
in this repo already default to it.

> The general rule: pick the region that minimises the *worst* round trip, not
> the average. If one user is far heavier than the others, host near them
> instead — fairness is a sensible default, not a law.

### The mistake that costs more than the region

**Put the database in the same region as the server.** A single API request
makes several database round trips. Server in Frankfurt with an Atlas cluster
in Virginia adds ~90 ms *per query* — often worse than anything the region
choice costs you. Match them and the database round trip is ~1 ms.

---

## 2. Database — MongoDB Atlas

1. Create a free **M0** cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Region: **AWS / eu-central-1 (Frankfurt)** — matching your server.
3. **Database Access** → add a user with a strong generated password.
4. **Network Access** → the deploy platform's egress IPs. If the platform has
   no static IPs, `0.0.0.0/0` is the pragmatic option; the database password is
   then your only control, so make it a long random one.
5. Copy the connection string and append the database name:

```
mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/halo?retryWrites=true&w=majority
```

M0 is genuinely enough here. It caps at 512 MB, which is on the order of a
million text messages — you will hit it with media long before text.

---

## 3. Secrets

Generate four. Run this four times:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Notes |
| --- | --- |
| `JWT_ACCESS_SECRET` | Rotating it logs everyone out. Harmless. |
| `JWT_REFRESH_SECRET` | Same. |
| `SOCKET_TICKET_SECRET` | Same. |
| `IDENTITY_PEPPER` | **Never rotate this.** See below. |

> ### ⚠️ `IDENTITY_PEPPER` is permanent
>
> It keys the lookup for every identity token ever issued. Change it and every
> recovery phrase your users wrote down stops working — permanently, with no
> way to recover. Back it up somewhere you will still have in five years:
> a password manager, not a `.env` on one laptop.

The server **refuses to start** in production without all four, deliberately —
in development it generates them per process, which would silently invalidate
every session on each restart.

---

## 4. Deploy

The client is served by the API from the **same origin**. That is deliberate:
no CORS preflight (an extra round trip you cannot afford at 300 ms), the
refresh cookie stays `SameSite=Strict`, and there is one thing to deploy.

### Fly.io — recommended

Best websocket support of the three, and no idle spin-down on paid plans.

```bash
fly launch --no-deploy --copy-config
```

```bash
fly secrets set MONGO_URI="mongodb+srv://..." JWT_ACCESS_SECRET="..." JWT_REFRESH_SECRET="..." SOCKET_TICKET_SECRET="..." IDENTITY_PEPPER="..."
```

```bash
fly deploy
```

`fly.toml` already pins `fra`, keeps one machine always running (so nobody gets
disconnected during a quiet spell), and health-checks `/api/health`.

### Render

Push the repo, then **New → Blueprint** and point it at `render.yaml`. It
generates three of the four secrets for you; set `MONGO_URI` by hand.

> Render's **free** tier spins down when idle, which drops every websocket and
> makes the first message after a quiet period slow. The outbox handles it
> correctly — nothing is lost — but use the paid Starter plan for a chat app.

### Railway

No config file needed; it detects the `Dockerfile`.

```bash
railway up
```

Set the five variables in the dashboard and pick the **europe-west** region.

### Anywhere with Docker

```bash
docker build -t halo .
```

```bash
docker run -p 4000:4000 --env-file server/.env halo
```

---

## 5. After the first deploy

1. Open the URL, register the first account, and **save the identity token** —
   it is shown exactly once.
2. Share the URL and your friend code with whoever is joining.
3. They register, enter your friend code, you accept.
4. Check the friend's local time appears in the chat header. It should read
   something like `2:15 AM their time · 11.5h behind`.

### Verify it is actually healthy

```bash
curl https://your-app.fly.dev/api/health
```

Then confirm realtime works: open the app in two browsers, send a message, and
check it appears in the other without a refresh. If messages need a refresh,
websockets are being blocked — check the platform supports them (all three
above do).

---

## 6. Operational notes

**Backups.** Atlas M0 has no automatic backups. For something whose entire
point is preserving a friendship, that is a real gap. Either upgrade to M2+
(which adds them) or run `mongodump` on a schedule.

**Uploads are ephemeral.** The media pipeline is not built yet, but when it is,
container filesystems are wiped on every deploy. It needs S3 or R2, not local
disk. This is noted in `ARCHITECTURE.md` §9.

**Scaling past one instance.** Presence and socket fan-out are in-process
today. Two instances would each see only their own sockets. The fix is
`@socket.io/redis-adapter` plus a Redis presence store — the seams are marked
in `server/src/services/presence.service.js` and `server/src/sockets/index.js`.
You will not need this for two people.

**Logs.** `fly logs`, or the dashboard on Render/Railway. Unexpected errors log
in full server-side and return only a generic message to the client.
