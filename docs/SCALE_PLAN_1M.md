# SCALE_PLAN_1M.md

How NexaFlow gets from "single laptop + Docker compose" to **1M registered
users / ~100k peak concurrent / ~600 msgs/sec sustained**.

This is the worked plan for the 1M milestone, sequenced. The broader 10M
target lives in [`10M_SCALE_ARCHITECTURE.md`](10M_SCALE_ARCHITECTURE.md);
this doc is more specific and reaches the 1M wall first.

> **Per Playbook §1**: this is a planning artifact. No implementation code
> in this PR. The tasks at the bottom are Codex-ready slices, sized small.

---

## 1. How I (Claude) plan this

Each time the user assigns a scale milestone, I follow this loop. It mirrors
the workflow in [`CLAUDE.md`](../CLAUDE.md) but is reproduced here because
this is the worked example.

1. **Define the target as numbers.** "1M users" is meaningless without DAU,
   peak concurrent, and request/message mix.
2. **Audit the code, not the marketing.** Open the files, grep for in-memory
   state, count `Serializable` transactions, time the slow paths.
3. **Find the wall, not the wish list.** For each layer (LB / API / Redis /
   Postgres / workers / Meta) project the failure mode at the target load.
4. **Sequence by blast radius.** First move = highest leverage with lowest
   risk to billing / tenant isolation / Meta compliance.
5. **Define acceptance per phase.** A phase isn't "done" until a load test
   on real infra hits the target SLOs.
6. **Hand off as Codex-ready tasks.** Each task fits one PR. Codex stays
   inside `TASKS.md`. Claude reviews diffs against the checklist in CLAUDE.md.

The Playbook §9 rule applies: **stop and request a smaller plan** if a fast
implementation would break tenant isolation, billing, provider abstraction,
or AI safety.

---

## 2. What "1M users" means in numbers

Concrete assumptions. Adjust later when real telemetry contradicts them.

| Dimension | Value | Source |
|---|---|---|
| Registered users | 1,000,000 | target |
| Daily active users (DAU) | 200,000 (20%) | typical SaaS |
| Peak concurrent web sessions | 60,000 (30% of DAU at peak hour) | hour-of-day curve |
| Average requests / DAU / day | 80 | guess; refine with telemetry |
| Peak API RPS | ~5,500 | DAU × 80 ÷ 86,400 × 3 (peak factor) |
| Inbound WhatsApp msgs / day | 10,000,000 | 10 per DAU |
| Peak inbound MPS | ~580 | with 5x peak factor |
| Outbound campaigns / day | 5,000,000 | 5 per DAU |
| Avg agents per tenant | 5 | typical |
| Storage growth (messages) | ~3 TB / year | 10M msg/day × 800 bytes × 365 |
| Storage growth (audit + flow runs) | ~1 TB / year | conservative |

The wall we're sizing against: **5,500 RPS sustained, 580 MPS inbound peak,
60k concurrent WebSockets, 100M msgs/month outbound**.

---

## 3. Bottleneck audit — current code

Code references are real and current.

### 3.1 P0 — will break first

| # | Bottleneck | Failure at scale | Where |
|---|---|---|---|
| B1 | **In-process workers** — six pollers run inside the API process when `APP_MODE=all`; with N>1 API replicas, each replica polls and dispatches the same row. | Duplicate sends, duplicate webhooks, race on `confirmationSentAt` stamps. | `apps/api/src/index.ts:62,168-173` |
| B2 | **Polling inbox** — the `/inbox` page fetches `/api/v1/conversations?limit=50` on mount with no real-time channel. | If users poll every 3s, 60k concurrent × 0.33 RPS = 20k RPS just for inbox. | `apps/web/app/inbox/page.tsx` (no WebSocket usage) |
| B3 | **bcrypt cost 12 on login** — ~250ms CPU on Node.js. | Login burst of 1,000 sign-ins/s saturates an entire 4-vCPU box. | `apps/api/src/services/auth.service.ts:116` |
| B4 | **Serializable wallet transactions** — every debit takes `TransactionIsolationLevel.Serializable`. | Two concurrent debits on the same wallet retry-loop hard. At 580 MPS, hundreds of debits/sec/tenant. | `apps/api/src/services/wallet.service.ts:113,119,158,235,261` |
| B5 | **No PgBouncer** — every Node replica opens its own pool. 50 replicas × 10 conns = 500, well past Postgres's default 100. | API replicas refuse connections under load. | not present |

### 3.2 P1 — will degrade

| # | Bottleneck | Failure at scale | Where |
|---|---|---|---|
| B6 | Single Redis instance — sessions, throttle, routing cursor, refresh JTI, autosave drafts all on one node. | Hot-key contention; single-AZ outage = full auth outage. | `apps/api/src/lib/redis.ts` |
| B7 | Send throttle uses a single sorted set per tenant. | Above ~5k sends/sec/tenant the ZADD/ZRANGEBYSCORE becomes the bottleneck per tenant. | `apps/api/src/services/sendThrottle.service.ts` |
| B8 | No CDN; Next.js SSR per request. | First Load JS for `/inbox` is 103KB; without edge cache this is a per-request render cost. | `apps/web/next.config.js` (no CDN config) |
| B9 | `Message`, `AuditLog`, `AiUsage`, `WebhookLog` are unpartitioned; tenant queries scan the whole table. | Inbox latency grows linearly with global message count. | `packages/db/prisma/schema.prisma` |
| B10 | No `Message.metaMessageId` unique index — Meta replays produce duplicate rows (also tracked as T-003). | Storage drift, lost idempotency. | `packages/db/prisma/schema.prisma` |

### 3.3 P2 — observable problems

| # | Bottleneck | Why it matters |
|---|---|---|
| B11 | No OpenTelemetry / APM / Sentry integration. | At 1M users you cannot debug latency anomalies blind. |
| B12 | No load tests in CI. | The 10M doc says: "Do not claim X capacity without load tests on real infrastructure." |
| B13 | No leader election when running multiple API replicas in `APP_MODE=all`. | Workers double-fire (B1's root cause). |

---

## 4. Phased plan

Five phases. Each phase has **acceptance criteria** that must pass before
moving on. Don't skip phases — capacity claims without load tests are lies.

### Phase A — Worker fleet + DB pool (target: 50k concurrent / 200 MPS)

**Goal**: stop in-process polling; survive a horizontal API scale-out.

| Task | Codex-ready? | Notes |
|---|---|---|
| Move workers to durable queue (BullMQ on Redis) for: campaign, appointment, flow, SLA, webhook retry, lead follow-up | Yes (split into 6 sub-tasks) | Keep `APP_MODE=worker` deployment target. Migrate one worker at a time so we don't deploy six new failure modes at once. |
| Add `PgBouncer` in front of Postgres (transaction pooling mode) | Yes | Compose service for dev; managed in prod. Set `prisma` to use the pooled URL. |
| Add `Message.metaMessageId @unique` (T-003) | Yes | Idempotency for Meta replays. |
| Add `/live` and `/ready` endpoints diverge: `/live` always 200; `/ready` requires Postgres + Redis OK | Yes | LB uses `/ready`. |

**Acceptance**:
- Run **2 API replicas + 1 worker replica** with `docker compose`. No duplicate sends in a 1k-message campaign.
- k6 script `auth+inbox` at 1,000 RPS for 5 minutes: p95 < 400ms, error rate < 0.1%.
- Postgres connection count stays under 50 with PgBouncer in transaction mode.

### Phase B — Auth + Redis + send throttle hardening (target: 100k concurrent / 400 MPS)

| Task | Notes |
|---|---|
| Drop bcrypt cost to 10 OR introduce **JWT verification cache** (Redis, 5min TTL) so re-validation is sub-ms | Cost 10 keeps cracking ~3x faster; that's an acceptable trade at this throughput. Document in ADR. |
| Per-account login throttle (T-012) | 5 fails / 15 min / account, separate from per-IP. |
| **Redis Cluster** behind the existing `getRedis()` client | Shard by key prefix. All current keys (`auth:refresh:`, `send:`, `routing:`) are tenant- or random-keyed; safe to shard. |
| Send throttle **per phone-number-id** instead of per-tenant when tenant has multiple WABA numbers (future-proof for B7) | A tenant with 10 WABA numbers can send 10× through the existing per-second cap. |
| WABA-token at rest encryption (T-013) | Envelope-encrypt with a KMS key. |

**Acceptance**:
- k6 `login-burst` at 500 RPS for 2 minutes: p95 < 600ms, no 5xx.
- Redis Cluster failover (kill one shard) doesn't cause auth outage.
- Send 100k messages over 5 minutes across 10 simulated tenants: throughput holds, no Meta 429s.

### Phase C — Real-time inbox + read replicas (target: 100k concurrent WS / inbox scale)

| Task | Notes |
|---|---|
| **WebSocket service** for inbox: Socket.io behind a Redis adapter, deployed as its own fleet (`APP_MODE=realtime`). Inbound webhook publishes a `message:{tenantId}` event; subscribed clients re-fetch the affected conversation. | Removes polling. Each WS connection costs ~10KB on the server side; 100k connections need 4-8 nodes with `socket.io` + Redis adapter. |
| **Postgres read replica(s)** behind PgBouncer; route read-only queries (analytics, list views, conversation history > 24h) to replicas | Replica lag is OK for inbox lists; **never use replica for wallet reads** — strict consistency required. |
| **Cursor-based pagination** for inbox list (replace `skip/take`) | At 100k conversations per tenant, `skip` is O(N). |
| Update web `useInbox` to subscribe via WS; fall back to polling for unsupported browsers/networks | Keep the polling code path as the disaster-recovery fallback. |

**Acceptance**:
- 25k concurrent WS connections per WS replica with p99 message latency < 200ms.
- Inbox cold load p95 < 300ms with 50k conversations on a tenant.
- Replica lag dashboard exists; alerts on >5s.

### Phase D — Storage partitioning + cold path (target: sustained 1M users)

| Task | Notes |
|---|---|
| Partition `Message`, `AuditLog`, `AiUsage`, `WebhookLog` by **month** (declarative partitioning in Postgres) | One partition per month; auto-drop after retention period (e.g. 24 months). |
| Move messages older than 30 days to a cold-storage `messages_archive` table on the read replica, OR to OpenSearch for search | Inbox queries target the hot partition by default. |
| **OpenSearch** (or Elasticsearch — already in docker compose) for full-text contact + message search | Today no index is wired; queries do `contains` on Postgres which is O(N). |
| **Wallet sharding strategy** — *plan only in this phase, implement only if contention shows up in load test*: SuperAdmin wallet stays global; partner + customer wallets are already tenant-scoped (good). If contention persists, fanout debits onto a partitioned `WalletTransaction_{shard}` table by `wallet_id % N` and reconcile nightly. | Don't pre-shard. Measure first. |
| CDN (Cloudflare) for `/_next/static/*` and the public marketing page | Bandwidth + edge cache. |

**Acceptance**:
- k6 inbox at 60k concurrent users with 50M messages in DB: p95 list < 500ms.
- Monthly partition rotation is automated.
- Backups: PITR works; tested restore to a non-prod environment.

### Phase E — Observability + chaos (target: production-ready 1M)

| Task | Notes |
|---|---|
| OpenTelemetry traces across Next → API → DB → Redis → workers → Meta | Trace IDs in every audit row. Default exporter to Datadog or Honeycomb. |
| Sentry for unhandled errors in API + web + workers | Sample rate 1.0 in dev, 0.1 in prod. |
| RED metrics (Rate / Errors / Duration) per route via OpenTelemetry instrumentation | Per-route, per-tenant percentiles (anonymized). |
| Synthetic checks on `/health`, `/api/v1/health`, public booking page, login flow | 5-minute interval, multi-region. |
| Chaos test: kill workers / Postgres / Redis shards in staging; verify queue drains, no data loss | Run weekly. |

**Acceptance**:
- p95 / p99 dashboards exist per route, per tenant tier.
- A purposeful 60-second Redis Cluster failover does not cause user-visible inbox or send errors (just degraded latency).
- One full chaos drill passes per quarter.

---

## 5. Load test plan (k6 scenarios)

Every phase ends with a load test. These scripts live in `apps/load/`
(does not exist yet — Phase A task).

| Scenario | RPS / users | What it stresses |
|---|---|---|
| `auth-burst` | 500 logins/s for 2 min | bcrypt, JWT, Redis refresh JTI |
| `inbox-poll` | 1,000 RPS for 5 min | Conversation list + tenant scoping |
| `webhook-storm` | 2,000 inbound msgs/s for 1 min | `/webhooks/whatsapp` handler, idempotency, queue depth |
| `campaign-fanout` | 1 campaign × 100k recipients | Worker fan-out, throttle, wallet debits |
| `mixed-day` | 5,500 RPS varied for 30 min | Realistic production mix |

Targets:
- p95 < 500ms on every read endpoint
- p99 < 1s on every write endpoint
- 0 5xx during 5-minute steady-state
- 0 duplicate sends in a 100k-recipient campaign

---

## 6. Cost ballpark (monthly, AWS-equivalent)

Rough order of magnitude for budgeting; refine after first load tests.

| Component | Spec | Monthly |
|---|---|---|
| API fleet | 20 × c6i.xlarge (4 vCPU / 8 GB) | ~$1,800 |
| Worker fleet | 6 × c6i.large | ~$280 |
| WS fleet (Phase C) | 4 × c6i.xlarge | ~$360 |
| Postgres primary | db.r6g.2xlarge + 2 replicas | ~$2,400 |
| PgBouncer | t4g.medium | ~$30 |
| Redis Cluster (3 shards × 2 replicas) | cache.r6g.large × 6 | ~$1,200 |
| OpenSearch | 3 × r6g.large.search | ~$900 |
| CDN + WAF | Cloudflare Pro / Enterprise | ~$200 |
| Anthropic API | depends on AI volume (per `Tenant.aiCreditsPerMonth`) | variable |
| Meta WhatsApp conversation fees | per Meta tariff | variable |
| **Infrastructure subtotal** | | **~$7,200/mo** |

Marginal cost per active user at 200k DAU: **~$0.036/user/month** before
WhatsApp + AI variable costs. That's healthy for a B2B SaaS at this scale.

---

## 7. What I will NOT do in this scale work

Per Playbook §3 hard rules:

- **No rewrite to NestJS**, GraphQL, or any other framework swap.
- **No premature wallet sharding** — measure first, shard if contention shows
  up in Phase D load tests.
- **No swap of Anthropic for OpenAI** during this work (decoupled from scale).
- **No "scale" PR that also touches features** — scale changes ship in their
  own branch with their own load test results.
- **No claim of 1M capacity without** a green k6 `mixed-day` scenario on real
  staging infra.

---

## 8. The first three architectural moves (handoff)

These are ready for Codex. Full task entries are in `TASKS.md` as
T-080 / T-081 / T-082.

### Move 1 — Migrate the campaign worker to BullMQ (T-080)

- Why first: highest write volume, already has a clear job shape, no schema
  changes needed.
- Scope: introduce `bullmq` dependency, define a `campaign-dispatch` queue,
  move `dispatchCampaign(id)` from `services/campaign.service.ts` polling
  into a job processor. Producer is the campaign API route + a recurring
  scheduler job that scans `SCHEDULED` campaigns.
- Acceptance: existing campaign tests still pass; queue depth visible via a
  `/admin/queues` endpoint; worker can run with `APP_MODE=worker`.

### Move 2 — PgBouncer in docker-compose + DATABASE_URL_POOLED (T-081)

- Why second: unlocks running multiple API replicas without breaking the
  connection budget.
- Scope: add PgBouncer service to compose, expose on 6432, add
  `DATABASE_URL_POOLED` env var, Prisma uses pooled URL by default. Direct
  URL retained for migrations.
- Acceptance: 5 API replicas behind a local NGINX, total Postgres connection
  count stays under 30 under load.

### Move 3 — Message.metaMessageId @unique + duplicate-handling in webhook (T-003, already in next-up)

- Why now: prerequisite for any Meta retry idempotency claim. Tiny scope,
  closes a real security/data-integrity gap.
- Acceptance: replaying the same inbound webhook twice produces one
  `Message` row; webhook still ACKs 200 on the duplicate.

After Move 3 the codebase is ready to attempt the Phase A load test target
(50k concurrent / 200 MPS).

---

## 9. Open questions for the user

These need product-side decisions before I plan further:

1. **Region strategy** — single region, or do we need to be multi-region
   (e.g. India primary, EU secondary)? Impacts Postgres replication shape
   and Meta webhook latency budget.
2. **Hot tenants** — are there a small number of huge tenants (e.g. one
   enterprise with 200k contacts) or many small ones? Sharding strategy
   differs.
3. **Storage retention** — how long do we keep raw messages? Affects
   partition rotation cadence.
4. **AI cost ceiling** — at 1M users, AI usage per tenant becomes a real
   line item. Hard cap per plan, or pay-as-you-go?

Once those are answered, the Phase D plan tightens up considerably.
