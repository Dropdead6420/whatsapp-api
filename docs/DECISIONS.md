# DECISIONS.md

Architectural decisions in lightweight ADR form. **Append only.** When a
decision is superseded, write a new entry referencing the old one rather than
editing it in place.

Format:
- **ADR-NNN**: short title
  - **Date**: YYYY-MM-DD
  - **Status**: Accepted / Superseded by ADR-X / Deprecated
  - **Context**: why this came up
  - **Decision**: what we chose
  - **Consequences**: trade-offs we accept

---

## ADR-001 — Express, not NestJS, for the API

- **Date**: 2026-05-16
- **Status**: Accepted
- **Context**: V2 PRD listed NestJS. The Express scaffold from Phase 1 was working.
- **Decision**: Keep Express. A rewrite costs weeks of churn for zero user-visible benefit at this stage.
- **Consequences**: We give up Nest's DI + decorator ergonomics. We accept manual wiring. Revisit only if request volume or team size justifies it.

---

## ADR-002 — Multi-tenancy is row-level via `tenantId`, not schema-per-tenant

- **Date**: 2026-05-16
- **Status**: Accepted
- **Context**: Two viable strategies for multi-tenant Postgres: row-level scoping vs schema-per-tenant.
- **Decision**: Row-level. Every tenant-scoped model has a `tenantId` column. Every query scopes by it. Enforced via `requireTenantScope` middleware + code review.
- **Consequences**:
  - Cheaper migrations (one schema).
  - Faster cross-tenant SuperAdmin queries.
  - Risk: a missing `tenantId` in a `where` clause leaks data. Mitigated by the Claude review checklist and centralized middleware.
  - Future option: row-level security policies in Postgres for defense-in-depth.

---

## ADR-003 — JWT refresh tokens use Redis-backed JTI, not opaque DB lookup

- **Date**: 2026-05-16
- **Status**: Accepted
- **Context**: Need refresh-token revocation without a hot DB write on every refresh.
- **Decision**: Refresh tokens carry a `jti`. The `jti` is stored in Redis with 7-day TTL. Refresh rotates the `jti`. Logout adds the `jti` to a blacklist set.
- **Consequences**:
  - Sub-millisecond refresh + revocation check.
  - Redis outage means refresh fails closed (correct).
  - Lost refresh-token data on Redis loss invalidates active sessions — acceptable for security; users re-login.

---

## ADR-004 — Anthropic Claude as the primary LLM; OpenAI as fallback (not implemented yet)

- **Date**: 2026-05-17
- **Status**: Accepted
- **Context**: AI is the moat. We need consistent JSON output and large context windows.
- **Decision**: Claude 3.5 Sonnet for all AI features. All LLM calls return JSON validated by Zod. Usage logged to `AiUsage` with cost in cents.
- **Consequences**:
  - Single-provider lock-in until the fallback abstraction lands.
  - Tightly couples AI feature behavior to Claude's JSON-mode quality.
  - Cost ceiling enforced per-tenant via `Tenant.aiCreditsPerMonth` (not yet metered against AiUsage — see TASKS).

---

## ADR-005 — Send throttle is per-tenant, Redis-backed, fail-open

- **Date**: 2026-05-17
- **Status**: Accepted
- **Context**: Meta penalizes bursts. Per-tenant monthly quota is a billing requirement.
- **Decision**: `canSendNow(tenantId)` checks (a) Redis sorted-set rolling 1-second cap and (b) Redis monthly counter against `Tenant.messageQuotaPerMonth`. **Fails open on Redis outage** — we'd rather slightly over-send than fail every WhatsApp dispatch when infra is degraded.
- **Consequences**:
  - Bypasses are visible as console warnings.
  - We accept brief quota overshoot during infra incidents.
  - When we adopt the wallet ledger, the wallet check is **in addition to** (not instead of) the throttle.

---

## ADR-006 — Flow runtime stores nodes/edges as JSON strings on `ChatbotFlow`

- **Date**: 2026-05-17
- **Status**: Accepted
- **Context**: Flows have arbitrary shape. Two options: separate `FlowNode` + `FlowEdge` tables, or JSON columns.
- **Decision**: JSON columns. Flows are small (<200 nodes typical), edited atomically, and validated on save.
- **Consequences**:
  - Atomic edits + simple round-trip.
  - No SQL queries by node type — fine; we never need them.
  - Editor positions live at `node.config._editor.position`. Runtime ignores `_editor.*`.

---

## ADR-007 — Provider Abstraction Layer for WhatsApp (planned, not yet shipped)

- **Date**: 2026-05-18
- **Status**: Accepted (design); implementation pending
- **Context**: Blueprint §5.3 requires Meta Cloud + Gupshup + 360dialog + Haptik + Twilio. Today we're hard-wired to Meta Cloud.
- **Decision**: Single `WhatsAppProvider` interface (signature in `ARCHITECTURE.md`). One adapter per provider. A `ProviderRoute` table maps `(tenantId | partnerId) → providerKey`. The factory in `services/whatsapp/index.ts` is the **only** code that knows providers exist.
- **Consequences**:
  - All current `sendWhatsAppText` / `sendWhatsAppTemplate` callers continue to work; the factory is a drop-in.
  - Webhook normalization: each adapter normalizes inbound payloads to our internal `InboundMessage` shape before they touch the rest of the system.
  - Quality-rating / messaging-limit fields on `Tenant` map to the adapter's `getQualityRating` / `getMessagingLimit`.
  - Templates: each provider has its own approval flow. `WhatsAppTemplate.metaTemplateId` becomes `providerTemplateId`.

---

## ADR-008 — Wallet ledger is append-only, balance is derived

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Blueprint §3.5 + §9 require credit transfers, reversals, audit, prepaid/postpaid.
- **Decision**: `Wallet` has a cached `balance`. The truth is `Transaction` rows (`tenantId`, `walletId`, `amountInPaisa` signed, `kind`, `reason`, `actorUserId`, `relatedId`). Balance is recomputed from transactions on demand and reconciled by a daily job.
- **Consequences**:
  - No direct `wallet.update({balance: ...})` is allowed in code (enforced by review).
  - Reversals are new transactions, never edits.
  - Hot read path uses cached balance; reconciliation catches drift.
  - Future: switch to event-sourced wallet projection if we hit contention.

---

## ADR-009 — Custom domain becomes LIVE only after DNS + SSL pass

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Blueprint §4. Risk: serving a tenant's portal on an unverified domain enables hostname-based privilege escalation.
- **Decision**: Status machine `PENDING_DNS → DNS_FOUND → TXT_VERIFIED → SSL_PENDING → SSL_ACTIVE → LIVE`. Edge / proxy refuses to serve a domain unless `status === LIVE`. DNS verification uses real CNAME + TXT lookups against the resolver chain (not just the registrar). SSL via Cloudflare for SaaS.
- **Consequences**:
  - Slower onboarding (minutes, not seconds), but no impersonation surface.
  - Failed states are surfaced in the UI with the exact missing record.

---

## ADR-010 — Single-process workers now; separate worker pod when we shard

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Six background workers run in the API process. Fine for one box; risky if we scale API horizontally.
- **Decision**: For now, workers live in the API. When we run >1 API replica, workers move to a dedicated worker process with Redis-backed leader election. See `docs/10M_SCALE_ARCHITECTURE.md`.
- **Consequences**:
  - Today: simple ops, simple deploy.
  - When sharding: deploy boundary is a refactor of `index.ts` and one new Dockerfile target.
  - Webhook retries and SLA stamping are idempotent today, so duplicate workers wouldn't corrupt state — they'd waste cost.

---

## ADR-011 — Feature flags default to ON, stored sparsely

- **Date**: 2026-05-17
- **Status**: Accepted
- **Context**: We're adding many features behind tenant gates. Need to ship them without forcing a backfill on every tenant.
- **Decision**: `Tenant.featuresEnabled` is a JSON object that **only** stores `false` values. Missing keys default to ON in `getTenantFeatures`. The middleware order is `requireAuth → requireTenantScope → requirePermission → requireFeature → handler`.
- **Consequences**:
  - Existing tenants keep working as we add new features.
  - Storage cost stays tiny.
  - "Plan-based" enablement (e.g. Starter excludes AI) is layered above this — set the `false` keys on tenant create.

---

## ADR-012 — Editor / runtime separation in flow JSON via `_editor` namespace

- **Date**: 2026-05-17
- **Status**: Accepted
- **Context**: React Flow needs node coordinates. The runtime should not depend on them.
- **Decision**: All UI-only fields go under `node.config._editor`. The runtime's `getConfig<T>` helper ignores keys starting with `_`.
- **Consequences**:
  - Editor and runtime evolve independently.
  - If we add a different visual editor, it claims its own subkey under `_editor` or migrates.

---

## ADR-013 — Wallet billing is feature-flagged; cost unit is credits; debits are idempotent

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Per blueprint §3.5, every WhatsApp send and AI call must deduct from the tenant wallet. But forcibly enabling that on existing un-funded tenants would block production sends overnight.
- **Decision**:
  - **Feature flag** `WALLET_BILLING_ENABLED` (default `false`). When off, `assertCanAffordMessage` and `debitMessage` are no-ops. When on, full enforcement.
  - **Unit**: integer **credits**, not paisa. Cost env vars: `WHATSAPP_MESSAGE_COST_CREDITS` (default 1), `AI_CALL_COST_CREDITS` (default 1). This matches `WalletTransaction.amountCredits Int`.
  - **Idempotency**: unique index on `WalletTransaction(walletId, referenceType, referenceId)`. Send debits reference the Meta message id; AI debits reference the `AiUsage` row id. A replay never double-debits.
  - **Failure mode**: debits never fail the send. If the post-send debit errors (e.g. Postgres outage), we log and continue — the message is already on the wire. Reconciliation will catch drift.
  - **Pre-check before send**: refuses the send (402 `INSUFFICIENT_CREDITS`) when wallet can't afford it. Campaign worker treats 402 as `halt + PAUSED` so the rest of the campaign survives a top-up.
- **Consequences**:
  - Safe rollout: flip the flag per tenant via env once their wallet is funded.
  - Slight balance overshoot possible under race; ledger truth captured.
  - Pre-check and debit are wrapped at the **call site**, not the throttle service — keeps `sendThrottle` provider-agnostic and lets billing live with the wallet domain.

---

## ADR-014 — Meta webhook: signature verified over raw body, idempotency on `Message.metaMessageId`

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Two debts closed together. (1) `/webhooks/whatsapp` accepted any POST that passed the GET handshake — a public URL with no authenticity check. (2) Meta retries inbound notifications until we 200, so the same `wamid.*` could legitimately arrive twice and we'd insert it twice, double-trigger flows, and emit duplicate `MESSAGE_RECEIVED` outbound webhooks.
- **Decision**:
  - **Signature**: `express.json({ verify })` stashes the raw bytes on `req.rawBody`. The handler computes `sha256=HMAC(META_APP_SECRET, rawBody)` and compares against `X-Hub-Signature-256` with `crypto.timingSafeEqual`. Mismatch → `403 Forbidden` before any processing.
  - **Fail closed in production**: if `META_APP_SECRET` is unset / placeholder, the verifier returns `false` when `NODE_ENV=production` and `true` in dev. Production simply cannot run without a real secret.
  - **Idempotency**: unique constraint on `Message.metaMessageId`. Each inbound message is checked with `hasProcessedMetaMessage(msg.id)` before any side effect (contact upsert, conversation upsert, flow trigger, outbound webhook emit). The create itself is wrapped in `createInboundMessageOnce` — a P2002 race returns `null` so a duplicate caller bails cleanly.
  - **Logic lives in a service**: `services/whatsappWebhook.service.ts` owns `verifyMetaSignature`, `hasProcessedMetaMessage`, `createInboundMessageOnce`. Route file is a transport layer.
- **Consequences**:
  - Mounting order matters: `webhookRouter` mounts **before** `express.json()` is reused for /api/* — wait, both mounts use the same `verify` hook, so `rawBody` is available globally. No double-parse.
  - Tests cover the five cases that matter: valid sig, missing sig, bad sig, dev fallback, prod fail-closed, duplicate replay, P2002 race. Service mocks Prisma; route stays integration-tested via the live API.
  - We accept that the signature check rejects retries with malformed signatures — Meta itself never sends those, so a 403 is a real attacker, not a flake.
  - This closes the two oldest items on the SECURITY.md debt list.

---

## ADR-015 — BullMQ for durable queues; campaign worker is the first migration

- **Date**: 2026-05-18
- **Status**: Accepted (campaign worker migrated; remaining 5 workers tracked in TASKS Phase A)
- **Context**: All six background workers ran as in-process `setInterval` polls. That model couldn't survive an API process restart (in-flight work was lost), couldn't scale horizontally (every replica would re-do the same scans), and gave no operator visibility into queue depth. The 1M-user scale plan §8 calls out durable queues as the first move.
- **Decision**:
  - **Library**: BullMQ ≥ 5 with `ioredis` (the `bull` v4 dep was vestigial; removed).
  - **Connection**: `lib/queue.ts:getQueueConnection()` returns a `{ url, maxRetriesPerRequest: null }` object. BullMQ owns connection lifecycle; we never expose an IORedis instance.
  - **First migration**: campaign worker. `dispatchCampaign(id)` is unchanged (still the unit of work). The polling loop is replaced by:
    1. A repeatable `scan` job (every 30s via `upsertJobScheduler`) that queries `SCHEDULED` campaigns whose `scheduledFor <= now` and enqueues a `dispatch` job per campaign.
    2. A BullMQ `Worker` with `concurrency: 1` that processes both `scan` and `dispatch` jobs on the same queue.
    3. The campaign API route's "send now" path calls `enqueueCampaign(id)` instead of invoking the dispatcher directly.
  - **Idempotency**: every `dispatch` job uses `jobId: dispatch:<campaignId>`. BullMQ silently drops duplicate adds, so the scan scheduler racing a manual "send now" can never produce two parallel dispatches.
  - **Concurrency**: 1 per worker process. Horizontal scale comes from running `APP_MODE=worker` on multiple boxes. Bumping in-process concurrency would race the per-tenant send throttle.
  - **Retry**: `attempts: 3` with exponential backoff (5s base). `dispatchCampaign` itself is idempotent on `Message.metaMessageId` and `WalletTransaction(walletId, referenceType, referenceId)`, so a retry doesn't double-send or double-debit.
  - **Observability**: `GET /api/v1/admin/queues` returns `{waiting, active, delayed, failed, completed}` per queue. SuperAdmin only.
  - **Failure mode at boot**: if Redis is unreachable, `startCampaignWorker` logs and returns — the API still serves traffic. Matches the prior degraded-mode behaviour.
- **Consequences**:
  - First worker is real; the other five (`appointment`, `flow`, `sla`, `webhook-retry`, `lead-follow-up`) still run in-process. They migrate one at a time per the scale plan (T-082 through T-086) so we never deploy six new failure modes at once.
  - `bull` v4 dropped; nobody else imported it. Reduces install surface.
  - When `APP_MODE=worker` is set in deployment, the worker process consumes the queue without an HTTP listener.
  - Shutdown order is now `stopWorkers() → closeQueues() → prisma.$disconnect + closeRedis`. `closeQueues` awaits in-flight jobs to drain.

---

## ADR-016 — PgBouncer in transaction mode for runtime; direct URL for migrations

- **Date**: 2026-05-18
- **Status**: Accepted
- **Context**: Phase A scale plan wants multi-replica API + worker deployments. A single Postgres only tolerates ~100 connections. With Prisma's default connection pool of 17 per client, 6 replicas already exhausts the budget.
- **Decision**:
  - **Pooler**: `edoburu/pgbouncer:v1.24.1-p1` in docker-compose, listening on `:6432`, transaction-mode (`POOL_MODE=transaction`), `MAX_CLIENT_CONN=1000`, `DEFAULT_POOL_SIZE=25`.
  - **Two URLs**:
    - `DATABASE_URL` → direct upstream (port 5432). Used by Prisma `migrate` / `db push` (session-mode features the transaction-mode pool can't proxy).
    - `DATABASE_URL_POOLED` → through PgBouncer (port 6432, query string `?pgbouncer=true` so Prisma disables prepared statements).
  - **Runtime selection**: `packages/db/src/index.ts` reads `DATABASE_URL_POOLED || DATABASE_URL` and passes the chosen URL via `datasources.db.url` at PrismaClient construction. The schema's `url = env("DATABASE_URL")` is unchanged — migrations still read the direct URL.
  - **Backwards compatible**: dev with no PgBouncer keeps working because `DATABASE_URL_POOLED` is optional.
- **Consequences**:
  - The app can scale to many replicas while the upstream Postgres connection count stays bounded.
  - Transaction mode forbids session-level features (`SET LOCAL` outside a tx, advisory locks across calls, etc). Prisma client doesn't use them; if a future feature needs them, route it through `directUrl`.
  - PgBouncer's `pgbouncer` admin DB requires its own auth and is not exposed via the app user. The compose health check uses `pg_isready` on the upstream behind the pool.
