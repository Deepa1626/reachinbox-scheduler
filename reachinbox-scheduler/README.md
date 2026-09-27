# ReachInbox — Full-Stack Email Job Scheduler

A production-grade email scheduler + dashboard built for the Outbox Labs
Software Development Intern assignment: schedule emails at scale using
**BullMQ + Redis** (no cron), survive restarts without duplicating or losing
jobs, enforce per-sender concurrency/rate limits with live Slack alerts, and
manage everything from a Next.js dashboard.

```
reachinbox-scheduler/
├── backend/      Express + TypeScript API, BullMQ worker, Postgres, Redis, Elasticsearch
└── frontend/     Next.js + TypeScript + Tailwind dashboard
```

---

## 1. Architecture overview

### How scheduling works (no cron)

1. `POST /api/emails/schedule` writes one row per recipient into the
   Postgres `email_jobs` table (source of truth) and, in the same request,
   adds a **BullMQ delayed job** to `email-send-queue` for each row via
   `emailQueue.add(..., { delay, jobId })`.
2. `delay` is computed as `scheduled_time - now()`. BullMQ stores the job in
   Redis and only makes it visible to workers once the delay elapses —
   this is a persistent, Redis-backed timer, not `setTimeout`/cron.
3. **`jobId` is set to the Postgres row's UUID.** BullMQ enforces unique
   `jobId`s per queue, so this one decision is what gives us:
   - **Idempotency** — the same email can never be enqueued twice; a repeat
     call (e.g. during restart recovery) is a silent no-op.
   - **Easy cross-referencing** between the dashboard, Postgres, and the
     Bull Board queue UI.

### How persistence / restart recovery is handled

- Redis is run with `appendonly yes` (see `docker-compose.yml`), so the
  BullMQ queue itself survives a Redis restart.
- On top of that, **`src/queues/worker.ts` runs a recovery scan on every
  boot**: it queries Postgres for every `email_jobs` row whose status is
  not yet terminal (`scheduled`, `queued`, `rescheduled`) and re-adds it to
  BullMQ with the same `jobId`. Because BullMQ jobIds are unique, if the job
  already exists in Redis this is a harmless no-op; if Redis data was lost,
  this is what rebuilds the queue from Postgres.
- **Net effect:** stop the worker, stop Redis, restart both — future emails
  still fire at the correct time, and nothing already marked `sent` is ever
  resent (checked again inside `processJob` as a final guard).

### How rate limiting & concurrency are implemented

| Concern | Mechanism |
|---|---|
| **Worker concurrency** | `new Worker(..., { concurrency: WORKER_CONCURRENCY })` — configurable via env, no code change needed. |
| **Min delay between sends** | Enforced twice: (a) BullMQ's own `limiter: { max, duration }` on the worker as a global throttle, and (b) a Redis key `lastsend:{senderId}` checked/set per job for a precise per-sender minimum gap. |
| **Emails/hour** | A Redis counter keyed `ratelimit:{senderId}:{yyyyMMddHH}` (fixed hour bucket), incremented atomically via `INCR` + `EXPIRE`. Safe across multiple worker processes since the check-and-increment happens in Redis, not in worker memory. |
| **Over-limit behavior** | The job is **never failed or dropped**. `EmailJobs.rescheduleTo()` updates its Postgres row and the job is re-added to BullMQ with a new `delay` targeting the start of the next hour, preserving relative order among jobs pushed together. |
| **Slack alert on limit hit** | The same code path calls `notifyRateLimitHit()`, which posts to the user's stored Slack **incoming webhook URL** (captured via a real OAuth v2 flow, see below). If the user hasn't connected Slack, this is a no-op — never throws, never blocks the reschedule. |

**Trade-off called out explicitly:** the hourly limit uses a *fixed* hour
window (e.g. 14:00–14:59 UTC), not a rolling 60-minute window. This is O(1)
per check (one `INCR`) and matches the "emails per hour" framing in the
spec. A rolling window would need a Redis sorted set per sender and costs
more ops per send — worth it at very high volume, overkill here.

### Google OAuth (frontend login)

Real Google OAuth 2.0 (Authorization Code flow) via `google-auth-library`:
`GET /api/auth/google` → Google consent screen → `GET
/api/auth/google/callback` verifies the ID token, upserts a `users` row, and
sets an HTTP-only session cookie (`session_token`, a JWT). The dashboard
calls `GET /api/auth/me` to hydrate the header (name, email, avatar).

### Slack OAuth (rate-limit notifications)

Real Slack OAuth v2 with the `incoming-webhook` scope:
`GET /api/slack/oauth/start` → Slack authorize screen → `GET
/api/slack/oauth/callback` exchanges the code for an incoming webhook URL,
stored per user in Postgres (`users.slack_webhook_url`). The worker posts to
that webhook the moment an hourly limit is hit — a live HTTP call, not a log
line. Disconnecting clears the column; reconnecting repopulates it — no
redeploy needed either way since it's all just a DB read at send time.

### Search (Elasticsearch)

Every job transition (`queued`, `sent`, `failed`) is mirrored into an
`email_jobs` ES index (`src/services/elasticsearch.ts`). `GET
/api/search?q=...` runs a `bool` query across subject/body/recipient.
Indexing is **best-effort and non-blocking** — if Elasticsearch is down, the
send pipeline is unaffected; only search results are stale.

### Live BullMQ dashboard

Wired via `@bull-board/express` at **`GET /admin/queues`** — shows every
delayed/active/completed/failed job in real time, exactly matching what's
in `email_jobs`.

### Behavior under load (1000+ emails at once)

- All 1000 rows are bulk-inserted into Postgres in one query
  (`EmailJobs.bulkCreate`), then enqueued as individually delayed BullMQ
  jobs staggered by `delayMs` so they don't all fire in the same tick.
- Worker `concurrency` caps how many are processed in parallel regardless of
  how many are "due" at once — BullMQ pulls from Redis at that rate.
- If sends exceed the hourly budget partway through, the excess is pushed
  to the next hour window automatically (see rate-limiting above) rather
  than erroring out — so scheduling 1000 emails against a 200/hr limit just
  spreads them over ~5 hours without any manual intervention.

---

## 2. Features implemented

**Backend**
- [x] BullMQ delayed-job scheduler (no cron) — `queues/emailQueue.ts`
- [x] Postgres persistence of every job + campaign — `db/schema.sql`, `db/models.ts`
- [x] Restart recovery scan — `queues/worker.ts`
- [x] Idempotent sends (jobId = DB row id, DB status double-check) — `queues/worker.ts`
- [x] Configurable worker concurrency — `env.WORKER_CONCURRENCY`
- [x] Min delay between sends (limiter + Redis timestamp) — `services/rateLimiter.ts`
- [x] Redis-backed, multi-worker-safe emails/hour limiter — `services/rateLimiter.ts`
- [x] Graceful reschedule (not drop/fail) on limit hit — `queues/worker.ts`
- [x] Real Slack OAuth + live webhook notification on limit hit — `services/slackService.ts`, `routes/slack.ts`
- [x] Ethereal SMTP sending — `services/emailSender.ts`
- [x] Elasticsearch indexing + search endpoint — `services/elasticsearch.ts`, `routes/search.ts`
- [x] Live Bull Board dashboard at `/admin/queues` — `app.ts`
- [x] Real Google OAuth login + session cookie — `routes/auth.ts`
- [x] CSV/text lead upload + parsing — `routes/emails.ts`

**Frontend**
- [x] Google login page — `pages/index.tsx`
- [x] Dashboard with header (avatar/name/email), logout, Slack connect badge — `components/Header.tsx`
- [x] Scheduled / Sent tabs with polling — `pages/dashboard.tsx`
- [x] Compose modal: subject, body, CSV upload with live detected-email count, start time, delay, hourly limit — `components/ComposeModal.tsx`
- [x] Tables with loading skeletons + empty states — `components/ScheduledTable.tsx`, `SentTable.tsx`
- [x] Reusable UI primitives (Button, Input, Textarea, Field) — `components/ui.tsx`
- [x] Toast-based error handling — `react-hot-toast`
- [x] Full TypeScript types for API responses/props — `types/index.ts`

---

## 3. Running it locally

### Prerequisites
- Node.js 20+
- Docker (for Postgres/Redis/Elasticsearch) — or run those three yourself

### Step 1 — Infra
```bash
cd backend
docker compose up -d      # postgres:5432, redis:6379, elasticsearch:9200
```

### Step 2 — Backend
```bash
cd backend
cp .env.example .env      # fill in GOOGLE_CLIENT_ID/SECRET, SLACK_CLIENT_ID/SECRET
npm install
npm run migrate           # applies schema.sql
npm run dev                # starts the Express API on :4000
```
In a **second terminal**, start the worker (separate process, as it should
be in production so API and send-throughput scale independently):
```bash
npm run worker
```

### Step 3 — Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                # http://localhost:3000
```

### Step 4 — Ethereal Email setup
No manual signup needed: the first time a sender is created,
`services/emailSender.ts` calls `nodemailer.createTestAccount()` to mint a
free disposable Ethereal inbox on the fly and stores its creds in the
`senders` table. The console logs the address; sent-message preview links
are also returned in `sendEmail()`'s response for manual inspection at
https://ethereal.email. To pin a fixed inbox instead, set `SMTP_USER` /
`SMTP_PASS` in `.env`.

### Step 5 — Google & Slack OAuth apps
- **Google:** create an OAuth 2.0 Client ID (Web application) in Google
  Cloud Console, add `http://localhost:4000/api/auth/google/callback` as an
  authorized redirect URI, and put the client ID/secret in `backend/.env`.
- **Slack:** create a Slack app at api.slack.com/apps, add the
  `incoming-webhook` and `chat:write` scopes, set the redirect URL to
  `http://localhost:4000/api/slack/oauth/callback`, and put the client
  ID/secret in `backend/.env`.

### Verify BullMQ dashboard
Visit `http://localhost:4000/admin/queues` after scheduling a few emails.

---

## 4. Assumptions, shortcuts & trade-offs

- **Rate-limit window is a fixed hour bucket**, not a rolling 60-minute
  window (see architecture section above for the reasoning).
- **One default sender per user** is auto-created on first "Schedule"
  action (`Senders.getOrCreateDefault`) rather than building a full
  multi-sender management UI — the data model (`senders` table,
  per-sender rate/delay columns) fully supports multiple senders per user;
  only the UI to add/pick one was left out to keep scope in bounds for the
  assignment window.
- **Elasticsearch indexing is best-effort/fire-and-forget** — a design
  choice so ES downtime never blocks or slows the actual send path. The
  `/api/search` endpoint exists but isn't wired into the dashboard UI (no
  search box) since it wasn't in the table/tab requirements — trivial to
  add, calls the existing endpoint.
- **CSV parsing is regex-based over any column**, not strict schema
  validation, so it tolerates messy real-world lead exports (mixed
  columns, plain text lists, etc.) at the cost of not validating anything
  beyond "looks like an email".
- **Session auth uses a signed JWT in an httpOnly cookie**, not
  Passport.js sessions — simpler to run stateless across the API/worker
  split without a shared session store.
- **Body templating (`{{firstName}}` etc.) is shown as a placeholder in the
  UI copy but not actually interpolated per-recipient** — every recipient
  in a campaign currently gets the identical `body`. Noted as the most
  natural next feature to add (per-recipient template rendering at enqueue
  time in `routes/emails.ts`).
- **1000+ concurrent schedule requests are not load-tested against a real
  SMTP quota** — per the assignment, the logic (bulk insert, staggered
  delays, hourly rescheduling) is demonstrated at smaller scale; behavior
  at 1000+ is by design (see "Behavior under load" above), not empirically
  benchmarked against a real Ethereal account's throughput limits.
