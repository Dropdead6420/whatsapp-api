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

---

## ADR-017 — WhatsApp provider abstraction (Meta-only adapter as the baseline)

- **Date**: 2026-05-19
- **Status**: Accepted; supersedes the planning entry in ADR-007.
- **Context**: Every send-path call (`whatsapp.routes.ts`, `conversations.routes.ts`, `campaign.service.ts`, `appointment.service.ts`, `leadFollowUp.service.ts`, `flow/nodes.ts`) used to import Meta-specific code directly. Adding Gupshup / 360dialog / Twilio would mean rewriting every one of those sites.
- **Decision**:
  - Define a `WhatsAppProvider` interface in `services/whatsapp/types.ts` with `sendText`, `sendTemplate`, a `key` discriminator (`"meta" | "gupshup" | "360dialog" | "twilio" | "haptik"`), and a `supportsMedia` capability flag.
  - The Meta Cloud API code moves verbatim into `services/whatsapp/providers/meta.ts` as the first adapter — same wire format, same error mapping, no behavior change.
  - `services/whatsapp/index.ts` owns the factory: `getWhatsAppProvider()` returns the active adapter. For now it always returns Meta; step 2 (T-005b) adds a `ProviderRoute` table that lets the factory pick by tenant.
  - The old `services/whatsapp.service.ts` becomes a thin re-exporter so every existing caller keeps working. `verifyMetaWebhookSubscription` stays there because it's provider-agnostic subscription-token policy, not a send-path operation.
  - Result shape is `{ providerMessageId: string }` to leave room for additional metadata later; back-compat wrappers unwrap to a bare string so old call sites compile unchanged.
- **Consequences**:
  - Zero-change refactor — 23/23 tests still pass; the live API boots and shuts down cleanly through the new path.
  - The factory is the **only** code outside `services/whatsapp/` that may know which provider is in use. Reviewers should reject any new direct import from `providers/*` outside that boundary.
  - When step 2 lands, the factory will accept a `tenantId` (or `{tenantId, phoneNumberId}`) so multi-provider routing per tenant becomes a one-line change at every call site that already has the tenant in scope.
  - Webhook inbound is **not** yet provider-aware. Each new BSP will need to normalize its inbound payload to the Meta-shape `MetaWebhookBody` we already parse, OR we'll define a `parseInbound(raw): InboundMessage` method on the interface when the second adapter lands. Deliberately deferred until we have a real second provider to design against.

---

## ADR-018 — ProviderRoute table is the source of truth for BSP routing

- **Date**: 2026-05-19
- **Status**: Accepted; extends ADR-017 (T-005 step 2)
- **Context**: With the provider interface in place (ADR-017), the factory needs to pick the right adapter per send. Hardcoding by tenant ID would defeat the point; we want runtime config that SuperAdmin can update without a deploy.
- **Decision**:
  - New `ProviderRoute` model: `(tenantId, providerKey, phoneNumberId?, isActive, config?)` with a unique constraint on `(tenantId, phoneNumberId)`.
  - `phoneNumberId = NULL` = the **default route** for that tenant. A row with a specific `phoneNumberId` is the **scoped route** that takes precedence when the call site knows which WABA phone to use.
  - `WhatsAppProviderKey` enum: `META | GUPSHUP | DIALOG_360 | TWILIO | HAPTIK`. Adding a new BSP = new enum value + new adapter in `services/whatsapp/providers/`.
  - `config String?` is a JSON blob for provider-specific credentials (Gupshup needs app name + API key; 360dialog needs an API key). It will be **envelope-encrypted on write** using the same `tokenCrypto` we ship for `Tenant.wabaAccessToken` (T-094). For the Meta-only baseline, `config` stays null because Meta credentials still live on the `Tenant` row.
  - Factory lookup order: phone-scoped active row → tenant default active row → Meta fallback. Unknown `providerKey` (e.g. a future provider compiled into a different build) also falls back to Meta with a `console.warn` so operators see misconfig but no traffic drops.
  - All 7 send sites (campaign, appointment, conversation reply, whatsapp routes ×2, lead follow-up, flow MESSAGE node) now pass `tenantId` to the back-compat wrappers. Callers that don't have tenant context still work via the unconditional Meta path.
- **Consequences**:
  - Zero-disruption rollout — no existing tenant has a `ProviderRoute` row, so every send still routes through Meta exactly as before. The first tenant with a Gupshup or 360dialog provider is one row insert away once T-005c lands.
  - 5 new unit tests in `services/whatsapp/index.test.ts` cover the lookup matrix (no selector, no row, phone-scoped match, missing adapter, DB failure). All five pass.
  - The unique constraint on `(tenantId, phoneNumberId)` means deactivating a route is a `isActive: false` flip — never a delete — so audit trails stay intact.
  - Future SuperAdmin UI lands as a CRUD on this table; partner-portal flows pick the same factory by passing the tenant they're operating on.

---

## ADR-019 — Per-tenant provider config carried via `SendContext`; encrypted in `ProviderRoute.config`

- **Date**: 2026-05-19
- **Status**: Accepted; extends ADR-017 + ADR-018 (T-005 step 4 — T-005d)
- **Context**: ADR-018 introduced `ProviderRoute.config` as a String? blob, but the Gupshup adapter shipped in T-005c only read env vars. Two problems with the env-only path: (1) it forces a single set of Gupshup credentials across every tenant, defeating the point of per-tenant routing; (2) it can't survive multi-tenant deployments where each customer brings their own BSP account.
- **Decision**:
  - Extend the `WhatsAppProvider` interface so both `sendText` and `sendTemplate` accept an optional `ctx: SendContext`. `SendContext.config` is the decrypted, JSON-parsed contents of `ProviderRoute.config` for the matching route. Meta's adapter accepts but ignores `ctx`; Gupshup (and future BSPs) read `ctx.config` first and fall back to env vars only when the ctx is missing or incomplete.
  - The factory does the decrypt + parse, then **closure-binds** the context onto the returned adapter (`bindContext(adapter, config)`) so call sites don't see the new arg. The back-compat wrappers (`sendWhatsAppText` / `sendWhatsAppTemplate`) keep their existing signature — call sites pass `tenantId` as before, and the routing + config-binding happens transparently.
  - On disk, `ProviderRoute.config` will be **envelope-encrypted** using the same `tokenCrypto` module that protects `Tenant.wabaAccessToken` (T-094, ADR-014). The decrypt path uses `decryptTokenIfNeeded` so a legacy plaintext blob is read transparently and re-encrypted on next write. The write path (Admin/SuperAdmin CRUD route — to land as T-005e) is the only place encryption fires.
  - Failure modes are deliberately quiet: a malformed JSON blob, a decrypt failure, or a missing required key (e.g. Gupshup with no `apiKey`) does **not** demote the provider. The adapter just falls back to env at send time and operators see the regular Gupshup "not configured" error if env is also unset.
- **Consequences**:
  - Zero-disruption rollout — adapters that don't care about ctx (Meta) ignore it; ones that do (Gupshup) get cleaner per-tenant credentials. Existing tenants with no `ProviderRoute` row are untouched.
  - 4 new unit tests cover ctx-preferred-over-env, partial-ctx fall-through, factory binding through the adapter, and malformed-JSON tolerance.
  - The factory pattern of "return a closure-bound adapter" leaves room for future per-tenant policy injection (rate-limit budgets, trace metadata, retry hints) by extending `SendContext` without touching call sites.
  - **T-005e** (next): SuperAdmin route for `ProviderRoute` CRUD that encrypts `config` on write. Until that lands, per-tenant routes must be inserted manually.

---

## ADR-020 — SuperAdmin CRUD for `ProviderRoute` with encrypt-on-write + redact-on-read

- **Date**: 2026-05-19
- **Status**: Accepted (T-005 step 5 — T-005e). Completes the T-005 series.
- **Context**: ADR-019 introduced `SendContext` + per-tenant `ProviderRoute.config`, but the only way to write a row was a raw Postgres INSERT. That left two doors open: an operator could store plaintext credentials by mistake, and the audit trail captured nothing.
- **Decision**:
  - New SuperAdmin route group `/api/v1/admin/provider-routes` — list / create / patch / delete. Mounted behind `requireAuth` + `requireRole(SUPER_ADMIN)` + `requirePermission(PROVIDER_ROUTE_MANAGE)`. The new permission is added to `RolePermissions[SUPER_ADMIN]` automatically via `Object.values(Permissions)`.
  - **Encrypt on write**: the request body's `config` (a JSON object) is `JSON.stringify`d and passed through `tokenCrypto.encryptToken` before hitting Prisma. The DB column never holds plaintext credentials.
  - **Redact on read**: every list / create / patch response returns `configPreview` — keys present, values masked. Mask format: ≤4 chars → `•••`, 5–8 → `•••${last2}`, >8 → `${first3}•••${last4}`. The raw decrypted blob never leaves the service.
  - **Audit**: every mutation calls `logAudit` with `resource: "ProviderRoute"`. The audit payload includes `configKeys` (the JSON keys of the config blob) but explicitly never the values — even masked. Operators can answer "what shape of credential was stored when?" without leaking the credential.
  - **Conflict handling**: the `(tenantId, phoneNumberId)` unique constraint is surfaced as HTTP 409 before Prisma can throw P2002. `phoneNumberId === null` is the tenant's default route; one per tenant.
  - **Web UI**: `/provider-routes` (SuperAdmin only) — list with masked config previews, "+ New route" form (with a JSON textarea — the only place plaintext exists, in the browser session), toggle-active, delete with confirm. Nav entry added under the Platform group.
- **Consequences**:
  - 7 new service-level tests + the existing factory tests; 44/44 backend tests green.
  - Live smoke ran the full flow: create encrypts (`v1:IGzi0ffJp...` in DB), list returns mask `sk_•••2345`, duplicate POST → 409, non-admin → 403, delete → 200, audit log records both CREATE + DELETE with `configKeys: ["apiKey","appName","source"]` and no values.
  - **Rotation path is now obvious**: PATCH with a fresh `config` re-encrypts the blob (new DEK + IV per encrypt — verified by the random-per-call test from T-094). PATCH with `config: null` clears it; PATCH without the `config` key leaves the existing blob intact (the data object literally doesn't include the key, so Prisma generates no `UPDATE` clause for it).
  - **What's intentionally not in this commit**: an inline "reveal once" flow that returns the freshly-decrypted config to the SuperAdmin so they can verify the stored value. The blast radius of that surface (every load is a credential disclosure path) outweighs the operator convenience until we have a real demand for it. Today the operator copy-pastes from their BSP console at create-time and re-pastes if they need to rotate; the mask preview confirms the shape was stored.

---

## ADR-021 — Meta Embedded Signup: browser-side popup + server-side exchange

- **Date**: 2026-05-19
- **Status**: Accepted (T-004 — closes the manual-WABA-config debt)
- **Context**: The manual `/whatsapp-settings` form needs operators to copy a Meta access token by hand from Business Manager. That's a non-starter for non-technical customers and a credential-leak risk (the raw token sits in a textbox, in the browser DOM, in clipboard history). Embedded Signup is Meta's officially blessed flow: a popup that returns a short-lived code + the chosen WABA / phone-number / business ids, which the server exchanges for a long-lived access token without the browser ever touching the secret.
- **Decision**:
  - **Browser** loads the Facebook JS SDK lazily (only when the operator clicks "Connect with Meta") and calls `FB.login` with the Embedded Signup `config_id` from Meta's developer console. The popup posts a `WA_EMBEDDED_SIGNUP` `MessageEvent` (origin `https://www.facebook.com`) when the user finishes selecting the WABA + phone; the page joins that bundle with the `code` + `business_id` from the FB.login callback and POSTs to `/api/v1/whatsapp/embedded-signup`.
  - **Server** (`services/metaSignup.service.ts`) exchanges the code at `oauth/access_token` for a long-lived token, subscribes our app to the WABA via `POST /<waba_id>/subscribed_apps`, then encrypts the token with the existing `tokenCrypto.encryptToken` (the same envelope encryption from ADR-014) and writes it onto the `Tenant` row alongside `metaBusinessId` / `wabaId` / `wabaPhoneNumber`.
  - **Refuses to start** when `META_APP_ID` / `META_APP_SECRET` are unset or carry the `.env.example` placeholder values. Production never silently no-ops the OAuth step.
  - **Persist-on-subscribe-fail**: if the subscribe step fails after the exchange succeeds, the access token is still persisted so the operator only retries the subscribe step (`POST /config/sync` triggers a refresh; a follow-up task can expose the subscribe call as its own button). The alternative — leaving the tenant un-credentialed — would force a full Embedded Signup re-run on Meta's UI.
  - **Audit log** captures `accessTokenPreview` (masked) + `webhookSubscribed`. The raw token never enters an `AuditLog.newValues` blob.
  - **Schema**: new `Tenant.metaBusinessId String?` — the parent Meta Business Manager id, useful for tenant identification + future business-profile reads. Other Embedded Signup fields reuse existing `Tenant.wabaId` / `wabaPhoneNumber` / `wabaAccessToken`.
- **Consequences**:
  - 5 new service tests cover happy path / unconfigured env / Meta OAuth error / subscribe-fail / unknown tenant. Combined with the existing 44, total is **49/49 green**.
  - The web button gracefully degrades when `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` aren't set — the manual form stays as the fallback path.
  - The token lives encrypted at rest exactly as ADR-014 specified, so this ADR doesn't add new crypto surface area; it just adds a more convenient way to get the token in.
  - **Future T-004 follow-ups** (intentionally deferred): (1) handling of Meta's `token_expires_at` so we proactively refresh long-lived tokens before they expire; (2) re-subscribe button on the WhatsApp settings page for the subscribe-fail case; (3) reading + persisting the business profile (display name, vertical, address) during onboarding.

---

## ADR-022 — WABA token expiry: warn, don't auto-refresh

- **Date**: 2026-05-20
- **Status**: Accepted; closes two of the three deferred T-004 follow-ups (expiry tracking + re-subscribe button).
- **Context**: Meta Embedded Signup mints tokens via `oauth/access_token`. By default these expire in 60 days; only System Users explicitly flagged "never-expires" come back with no `expires_in`. Meta deliberately does **not** expose a refresh endpoint for these tokens — there's no equivalent of `grant_type=refresh_token`. When a token expires, inbound messages stop arriving silently and the next outbound returns `OAuthException`. Customers lose hours-to-days of WhatsApp traffic before someone notices.
- **Decision**:
  - **Persist the expiry** at signup. `exchangeMetaCodeForToken` returns `{ accessToken, expiresAt }`; `expiresAt` is `now + expires_in*1000` when Meta sends one, otherwise null. New `Tenant.wabaTokenExpiresAt DateTime?` + `wabaTokenExpiryWarnedAt DateTime?` columns hold the stamp + warn cooldown.
  - **Warn, never auto-refresh.** No refresh endpoint exists, so the only safe move is to nudge the operator to re-run Embedded Signup. The `wabaTokenExpiry.service` worker scans daily (BullMQ scheduled, every 6h) for tokens within `WABA_TOKEN_EXPIRY_WARN_DAYS` (default 14). For each match not warned in the last 24h it (a) stamps `wabaLastSyncError` so `/whatsapp-settings` surfaces it, (b) emits `TOKEN_EXPIRING` outbound webhook with severity `warning` / `critical` / `expired`, (c) stamps `wabaTokenExpiryWarnedAt` so we don't re-warn every tick.
  - **Severity bands**: `>14d` → no warn; `4–14d` → `warning`; `≤3d` → `critical`; past expiry → `expired`. Same band drives the UI chip color (amber / red / dark-red) and the webhook severity field operators can route on.
  - **Recovery path is two-click**: the warn banner on `/whatsapp-settings` carries a "Re-subscribe webhook" button that POSTs `/api/v1/whatsapp/config/resubscribe` — calls `subscribeWabaToApp` again with the existing decrypted token. Useful when the subscribe step failed during onboarding but the token itself is still valid. For an actually-expired token, the operator clicks "Connect with Meta" instead, which mints a fresh one through the standard T-004 flow.
  - **TOKEN_EXPIRING is a real Prisma enum value** on `WebhookEvent`, not a string-only entry on the webhook union — that way tenants can `events: { has: "TOKEN_EXPIRING" }` against the schema.
- **Consequences**:
  - 4 new tests on `scanWabaTokenExpiry` cover the warn / critical / expired severity paths plus the no-op case. 53/53 backend tests green.
  - Never-expires tokens (no `expires_in` from Meta) write `wabaTokenExpiresAt = null` and the worker filters them out at the SQL level — zero work for tenants on permanent System User tokens.
  - The 24h warn cooldown prevents alert fatigue. If an operator dismisses the chip but doesn't reconnect, we'll re-warn tomorrow.
  - **Still deferred**: the third T-004 follow-up — sync the business profile (display name / vertical / address) from Meta during onboarding. That needs new Tenant columns and is a separate slice.

---

## ADR-023 — WhatsApp business profile: flat columns, auto-sync at onboarding, manual refresh endpoint

- **Date**: 2026-05-20
- **Status**: Accepted; closes the last T-004 follow-up.
- **Context**: After Embedded Signup completes we have the tenant's WABA + phone-number ids but nothing human-readable. The inbox header says "Phone +15551234567" instead of "Cutz & Bangs Coffee". Meta exposes two endpoints to fix this — `GET /<phone_number_id>/whatsapp_business_profile` returns the visible-to-customers profile (about, vertical, description, verified name, websites), and `GET /<waba_id>?fields=name,vertical` returns the WABA-level identity. We want both, and we want them inside the same request the operator just clicked through.
- **Decision**:
  - **Flat columns, not JSON blob.** Four new fields on `Tenant`: `wabaBusinessName`, `wabaBusinessVertical`, `wabaBusinessAbout`, `wabaBusinessProfileSyncedAt`. The inbox header, the analytics dashboard, and the future white-label preview all want to read these without parsing JSON. If Meta later adds new profile fields (address, websites) we'll add columns for the ones we actually display, not collect every field for show.
  - **Phone-number profile wins over WABA profile** for `name` (`verified_name` is what customers see) and `vertical`. WABA-level fields are the fallback when the phone-number profile is empty (common right after onboarding before the operator has filled it in).
  - **Auto-sync at the tail of `completeEmbeddedSignup`.** Fired as a `void`-discarded promise so a transient Meta hiccup doesn't undo the onboarding. The operator can refresh manually if the auto-fetch misses.
  - **Manual refresh endpoint**: `POST /api/v1/whatsapp/config/sync-profile` (`WABA_CONFIGURE` permission) re-runs the same sync logic. Audit-logged with `name` + `vertical` in `newValues` — never the raw token, which lives in `wabaAccessToken` and stays encrypted.
  - **UI surface**: `/whatsapp-settings` gets a "Business profile" sidebar card showing the synced name / vertical / about with a "Sync from Meta" button. The card sits above the existing "Quality Health" panel so connecting the WABA shows immediate human-readable confirmation.
- **Consequences**:
  - 4 new unit tests on `syncWhatsAppBusinessProfile` cover the verified-name-wins path, WABA-name-fallback path, not-connected refusal, and the Meta-error-surface case. 57/57 backend tests green.
  - The `business*` fields stay null for tenants that haven't connected via Embedded Signup or whose phone-number profile hasn't been populated in Meta Business Manager — the UI renders `—` placeholders, no broken layout.
  - We're not yet syncing address, email, or websites. When the white-label preview or the agent inbox header needs them, add columns and extend `fetchPhoneProfile`'s `fields=` query string — no schema migration needed beyond the column adds.
  - T-004 is now **complete-with-no-deferrals**. Future Meta-side enhancements (business hours, vertical taxonomy refresh) land as new ADRs.

---

## ADR-024 — AI flow nodes: typed helpers in `ai.service`, thin handlers in `flow/aiNodes.ts`

- **Date**: 2026-05-20
- **Status**: Accepted; partial implementation of blueprint §6.4 (T-050 first slice — `AI_CLASSIFY_INTENT`, `AI_SUMMARIZE`, `AI_EXTRACT_DATA`)
- **Context**: The flow builder shipped with a single `AI_RESPONSE` node that proxied `suggestReplies`. Customers want richer AI building blocks — intent routing for branching, conversation summarization for agent handoff, structured data extraction for booking flows. Inlining each model call inside its handler (the way Codex's first cut did) duplicates prompt engineering across files and makes the prompts un-testable in isolation.
- **Decision**:
  - **Typed helpers in `services/ai.service.ts`** own the prompts + output validation: `classifyIntent({tenantId, text, intents, context?}) → {intent, confidence, reasoning}`, `summarizeConversation({tenantId, messages, focus?}) → {summary, bullets[]}`, `extractStructuredData({tenantId, text, fields}) → Record<string, string|number|boolean|null>`. Each is a thin wrapper over the existing private `callLlmJson`, picks up wallet billing + `AiUsage` logging for free, and snaps model output back to a deterministic shape (intent → "unknown" when out of list, bullets capped at 7, values coerced or null).
  - **Thin handlers in `services/flow/aiNodes.ts`** unpack `node.config`, call the typed helper, write the result into `ctx.vars`, and pick `node.branches[<intent>] | node.branches.default | node.next` for routing. The `{{var.path}}` interpolation helper is shared so handlers stay one-liners.
  - **Variable splat for extracted data**: `AI_EXTRACT_DATA` writes both `aiExtracted` (the full object) AND `extracted_<field>` (one var per field) so downstream `CONDITION` nodes can branch on individual fields via `{{extracted_email}}` without writing JSON-path expressions.
  - **Intent snapping**: the classifier prompt instructs the model to use the literal "unknown" when nothing fits, AND the post-processing layer rejects any return value that isn't in the allowed list. Both layers must agree — defense in depth against prompt-injection attempts that name a non-existent label.
  - **Editor ergonomics**: `AI_EXTRACT_DATA.config.fields` accepts both `string[]` (shorthand for "extract the customer's X") and `Record<string,string>` (custom descriptions). The handler converts internally so the UI can stay simple.
  - **Default configs** for all 5 new node types ship in the editor's `addNodeOfType` switch — dragging a fresh `AI_CLASSIFY_INTENT` gives `{labels: ["pricing", "support", "booking"], context: ""}` instead of an empty object the operator has to fill in by hand.
- **Consequences**:
  - 9 new unit tests cover the helpers directly with the Anthropic SDK mocked: intent snap-to-unknown, in-list passthrough, empty-input short-circuit, intents-required validation, summary bullet capping + non-string filtering, value coercion (numbers stay numbers, nested objects → JSON string, nulls preserved), empty-text + empty-fields short-circuits. 71/71 backend tests green.
  - The 5 supporting handlers Codex shipped (`AI_TRANSLATE`, `AI_COMPLIANCE_CHECK`, `WAIT_FOR_REPLY`, `SWITCH`, `FILTER`) keep their existing inline implementations — they're either too simple to need typed helpers (translate / compliance) or have no AI surface at all (wait / switch / filter).
  - **Still deferred** from blueprint §6.4: `AI_RECOMMEND`, `AI_CHURN_PREDICT`, `AI_ROUTE_BEST_AGENT`. They each need real data inputs (purchase history, behavioral features, agent skill matrix) that we don't yet wire through the flow ctx — separate slices.

---

## ADR-025 — AI Agent Builder: persisted config first, runtime ships separately

- **Date**: 2026-05-23
- **Status**: Accepted; first slice of T-052 (blueprint §6 — AI Agent Builder)
- **Context**: T-051 shipped the Knowledge Base — tenants now have a place to put their FAQs, policies, and product copy. The next gap is letting tenants point a configurable AI agent at that knowledge so it can auto-handle the easy 80% of inbound conversations. The PDF blueprint sketches a single `AiAgent` entity (persona, model selection, knowledge scope, allowed tools, fallback behavior) plus a runtime that calls the LLM with KB grounding and dispatches tool calls. Shipping all of that in one commit hides bugs: the persistence model, the LLM call loop, and the tool-dispatch surface all have independent failure modes.
- **Decision**:
  - **Slice 1 = persistence only.** `AiAgent` Prisma model + `AiAgentStatus` (DRAFT / ACTIVE / DISABLED / ARCHIVED) + `AiAgentFallback` (ESCALATE_TO_HUMAN / SEND_TEMPLATE / SILENT) + service CRUD + `/api/v1/ai-agents` REST + `AI_AGENT_MANAGE` permission + `aiAgents` feature flag. **No runtime ships in this slice.** Tenants can configure agents from the API today; nothing reads those rows yet. Slice 2 wires the actual run loop into the flow runtime + inbound message handler.
  - **Provider + model allowlist enforced at write time.** `aiAgent.service.validateModelChoice` rejects unknown providers and rejects models that don't belong to the chosen provider's list. If a tenant PATCHes `provider: "anthropic"` against a record whose existing `model` is `gpt-4o-mini`, the service folds the existing model into the validation step and rejects the patch — we never persist a (provider, model) pair we can't actually call. This means slice 2's runtime doesn't have to defensively handle "valid row, unsupported combo".
  - **`knowledgeScope` is a JSON column, not a join table.** The shape is `{categories: string[], tags: string[], topK: number}`. A tenant typically has 1–4 agents, each scoped to a small slice of the KB — a join table would be a 1:N where N <= 30 and would cost an extra query on every retrieve. JSON keeps reads cheap; the trade-off is no referential integrity on category/tag values, but those are already free-form strings on `KnowledgeBaseEntry`.
  - **Lifecycle transitions are explicit and idempotent.** `publishAgent` (→ ACTIVE), `disableAgent` (→ DISABLED), `archiveAgent` (→ ARCHIVED, terminal). Re-publishing an ACTIVE agent or re-archiving an ARCHIVED one is a no-op return, not a 4xx — operators script these and we want re-runs to succeed. ARCHIVED is terminal: you can't publish or disable from it, mirroring how `KnowledgeBaseEntry` handles archived rows.
  - **Cross-field validation on fallback.** When `fallbackBehavior=SEND_TEMPLATE` the row must also carry a `fallbackTemplateId`. Checked at both `createAgent` and `updateAgent` (where the patch is merged against the existing row before the check). Runtime never has to handle a "fallback set, template missing" partial.
  - **Same permission gate as KB.** `AI_AGENT_MANAGE` joins `KNOWLEDGE_BASE_MANAGE` on the BUSINESS_ADMIN + TEAM_LEAD role lists; SUPER_ADMIN gets it automatically via `Object.values(Permissions)`. The thinking: anyone who can curate the KB should be able to configure the agent that consumes it.
- **Consequences**:
  - **15 new unit tests** in `aiAgent.service.test.ts` cover validation (bad provider / mismatched model / fallback-template guard), normalization (tag dedup, topK cap, tool allowlist), and lifecycle idempotence (publish-when-already-ACTIVE, archive-when-already-ARCHIVED, archived-blocks-publish). Total backend: **16 files, 92 tests green**.
  - The model is intentionally permissive on `persona` length (8k chars) — long instructions are how customers steer agent voice. We'll cap at the runtime layer if we see prompts blowing past the model's effective system-message budget; persisting the full string today keeps the door open for prompt-engineering UX (diff viewer, A/B test) without a column change.
  - **Slice 2 (next)**: `aiAgentRunner.service.ts` — takes a `{tenantId, agentId, conversation}` and returns `{reply, toolCalls?, escalated?}`. Wires `retrieveKnowledge` from T-051 in as the grounding step. Slice 3: an `AI_AGENT` flow node + an inbound-routing hook so unhandled DMs auto-dispatch to a tenant's default agent.
  - **Not yet built**: visual builder UI. The API surface is enough for Codex / hand-curated configs and unblocks slice 2 work in parallel.

---

## ADR-026 — AI Agent runtime: stateless `runAgent` returns a result, never sends a message

- **Date**: 2026-05-23
- **Status**: Accepted; second slice of T-052 (blueprint §6 — AI Agent Builder)
- **Context**: Slice 1 (ADR-025) shipped the configurable `AiAgent` row. The runtime needs to take that config + a live conversation and produce something the caller can act on. The obvious shortcut is to make `runAgent` *also* send the WhatsApp reply, update the conversation, and dispatch tool calls — one function call, fully autonomous. That hides too much logic from the caller and entangles three different concerns (LLM call, side-effect dispatch, transport). When the inbound webhook handler eventually wraps this in slice 3, it needs to apply per-conversation rules (`autoReplyEnabled`, agent-on-call, business-hours gating) BEFORE deciding whether to send. The runtime can't make that call alone.
- **Decision**:
  - **`runAgent` is stateless: in = `{tenantId, agentId, conversation, context?}`, out = `{reply, toolCalls, citations, escalated, escalationBehavior, reason, modelUsed, providerUsed}`.** It does the LLM call, debits the wallet, and returns the result. It never touches `Message`, `Conversation`, the WhatsApp provider, or any tool side-effect. The flow node in slice 3 owns "now actually send this reply", the inbound handler owns "should we have called the agent at all", and a future test-drive UI can reuse the same function without setting up a real conversation.
  - **Tool calls are surfaced, not executed.** If the model returns `{"tool":"CREATE_LEAD","arguments":{...}}` and the tool key is in `agent.tools`, `runAgent` returns it as a structured `AgentToolCall`. Executing the lead creation is a separate concern — slice 3 will route tool calls to existing services (`leads.service.createLead`, `appointments.service.bookAppointment`, etc.) with the right permission checks. Keeping execution out of the runtime lets us version the tool surface without touching prompts.
  - **`AgentRunResult.reason` is a discriminated union so the caller doesn't have to inspect `reply === null` heuristically.** Values: `ok`, `fallback_no_active_agent`, `fallback_empty_user_message`, `fallback_no_llm_configured`, `fallback_llm_error`. The flow node + inbound handler branch on this to pick the right fallback (escalate to human, send template, stay silent).
  - **Provider routing falls back cross-vendor rather than 500-ing.** If an agent is configured `provider: "openai"` but only the Anthropic key is set, the runtime swaps to Anthropic and uses `claude-3-5-haiku-latest` (small + cheap, matches the spirit of "smaller side of OpenAI's lineup"). The swap is reflected in `result.providerUsed` and `result.modelUsed` so operators see what actually happened. The alternative — hard-failing — would make a single misconfigured env var take down agents that were working fine before, which is the opposite of graceful degradation.
  - **KB grounding loops categories.** When `knowledgeScope.categories` lists multiple categories (FAQ + POLICY + SERVICE), the runner calls `retrieveKnowledge` once per category with `perCat = ceil(topK / N)`, merges, re-sorts by score, and clamps to `topK`. Single-query multi-category would be more efficient at the SQL layer but the retrieval helper doesn't support it yet — and the loop is the simplest thing that keeps each category represented when one has dramatically more entries than the others. **KB failure is non-fatal**: a `retrieveKnowledge` throw is caught, logged, and the agent runs ungrounded rather than escalating, because "model answers from persona alone" is a strictly worse experience than "agent down".
  - **Wallet debit only on successful LLM response.** `assertCanAffordAi` runs BEFORE the LLM call (cheap pre-check; can throw 402). `aiUsage.create` + `debitAi` run AFTER on the happy path only. A model 503 means the operator pays $0, not the round-trip cost. The pre-check is critical because Anthropic still bills on attempted retries, and we don't want a tenant whose wallet is at $0.01 to rack up debt during a transient outage.
  - **Tool-JSON extraction is permissive.** Both Claude and GPT occasionally wrap JSON in markdown fences (` ```json ... ``` `). The extractor unwraps fenced blocks AND accepts a bare `{"tool":...}` response. Anything else falls through as plain text. If the model returns a tool the agent's allowlist doesn't include, we surface the raw JSON as text rather than silently swallowing — operators need to see the misbehavior to fix their persona.
- **Consequences**:
  - **15 new unit tests** in `aiAgentRunner.service.test.ts` cover the 404 path, all five `reason` codes, the cross-vendor provider fallback, KB-failure-non-fatal, tool-call extraction (allowlist match, allowlist mismatch, fenced JSON), the multi-category KB merge, and the wallet-debit-on-error guarantee. Total backend: **17 files, 107 tests green**.
  - The `POST /api/v1/ai-agents/:id/test` endpoint is the first consumer. It just calls `runAgent` and returns the structured result — letting an operator iterate on a persona without spawning real conversations. Wallet is debited exactly as if the run was real, so persona-tuning costs are visible.
  - **Slice 3 (next)**: an `AI_AGENT` flow node that takes `{agentId}` from `node.config` and uses `runAgent`, plus an inbound-routing fallback in `whatsappWebhook.service` that routes unhandled DMs to a tenant's default agent. Tool-call execution (CREATE_LEAD, BOOK_APPOINTMENT, ADD_TAG, TRANSFER_TO_HUMAN, SEND_TEMPLATE, LOOKUP_CONTACT, LOOKUP_ORDER) lands in the same slice as a dispatch table that maps the tool key to the existing service function.
  - **Not yet built**: streaming responses. WhatsApp messages aren't streamed anyway (a message is a single HTTP post), so this is fine for the current product. When/if we add a "preview as agent types" feature in the operator UI, the runner gains a `stream?: true` mode that yields chunks; the call sites in slice 3 stay on the non-streaming default.

---

## ADR-027 — AI Agent flow node + tool dispatch: wire-not-glue

- **Date**: 2026-05-23
- **Status**: Accepted; third slice of T-052 (blueprint §6 — AI Agent Builder)
- **Context**: Slice 2 (ADR-026) gave us `runAgent` — a stateless function that returns a structured result. To make agents actually do work in production, two pieces have to land: (a) something that lets operators invoke `runAgent` from inside a workflow, and (b) something that turns the runner's `toolCalls[]` into real CRM writes. The naive shape is one mega-node that does the LLM call AND sends the WhatsApp reply AND executes tools AND escalates — but that bundles four concerns whose failure modes belong to different operator decisions.
- **Decision**:
  - **AI_AGENT writes a variable; it does NOT send WhatsApp.** The node calls `runAgent`, writes `result.reply` to `aiAgentReply` (or a configurable var name), and routes. Operators wire `AI_AGENT → MESSAGE` to actually send the reply. This keeps the existing throttle / wallet / WABA-config / opt-out checks centralized in `MESSAGE` instead of duplicating that gauntlet inside the agent node. Two-node-chain is a tiny UX cost; the architectural cleanliness is worth it.
  - **Tools are dispatched inside the AI_AGENT node, not as a separate `EXECUTE_TOOL` node.** Tool calls are tightly coupled to the agent invocation (same conversation, same model context, same security boundary) — splitting them across nodes would make every flow that uses tools at least 3 nodes long, and would let operators forget to wire the dispatch. The trade-off: when a tool fails, the AI_AGENT trail captures `{tool, ok:false, error}` and the run *continues* rather than failing. Tool failure ≠ flow failure. Operators who want to branch on tool success can read `aiAgentToolResults` from a downstream `CONDITION` node.
  - **Three branch outcomes, only one branch name.** The runner's five `reason` codes collapse to two operational outcomes:
    - **continue** (`reason: "ok"` or `"fallback_empty_user_message"`) → `node.next`. The "empty user message" case looks like an escalation but isn't actionable for the human — there's literally nothing to forward.
    - **escalate** (`reason: "fallback_no_active_agent"`, `"fallback_no_llm_configured"`, `"fallback_llm_error"`) → `node.branches.escalated` (or `node.branches.fallback` as a synonym) when set; falls back to `node.next` otherwise. Editor surfaces one branch ("escalated") to keep the visual graph readable; operators who need finer routing read `aiAgentReason` from a downstream `SWITCH` node.
  - **Tool dispatch lives in its own service.** `aiAgentTool.service.ts` is the registry. Each tool is a function `(ctx, args) → {ok, result?, error?}`; no throws into the caller. The registry pattern matches `flow/nodes.ts` — adding a new tool is a single function + a registry entry. Permission gate is defense-in-depth: the dispatcher independently verifies `ctx.allowedTools` before calling the impl, even though the runner already filtered. A custom caller (a future direct-dispatch endpoint, or a unit test) can't accidentally bypass the agent's allowlist.
  - **Model arg-name forgiveness.** `CREATE_LEAD` accepts both `description` (schema) and `notes` (training-data preference); `BOOK_APPOINTMENT` accepts both `scheduledAt` (schema) and `startAt` (model habit). The runtime normalizes — operators don't have to write the persona telling the model "use the exact arg name 'scheduledAt'". Cost is two `??` operators per tool; benefit is far fewer prompt-tweaking cycles.
  - **`LOOKUP_ORDER` returns a controlled not-implemented response.** There's no Order model in the schema yet (e-commerce integrations are a separate slice). Returning `{ok: true, result: {found: false, reason: "..."}}` lets the model gracefully tell the customer "I can't look up orders yet" instead of escalating. When Shopify/WooCommerce integration lands, the function body fills in, the tool key stays the same, and personas don't change.
  - **`SEND_TEMPLATE` resolves but doesn't send.** Reasoning: actually firing a WhatsApp template message means going through WABA config, send-throttle, wallet-billing, conversation upsert — all of which live in the existing `SEND_TEMPLATE` flow node. Duplicating that here would double the surface area and the chance for the two paths to drift. The dispatcher resolves the template (verifies it exists in the tenant, returns the template id), and the response note explicitly tells operators to wire `AI_AGENT → SEND_TEMPLATE` for the actual send.
- **Consequences**:
  - **27 new unit tests** (17 in `aiAgentTool.service.test.ts`, 10 in `aiAgentFlowNode.test.ts`) cover: allowlist defense-in-depth, schema-field mapping for each tool, tenant-scope refusal, conversation-build from prisma.message vs triggerText, all three branch outcomes, tool dispatch accumulation, tool failure surfacing in trail. Total backend: **19 files, 134 tests green** (+27).
  - **Editor work deferred to a follow-up commit**: the React Flow editor palette needs an `AI_AGENT` entry with sensible defaults (`{agentId: "", replyVar: "aiAgentReply"}`) + an agent picker that lists active agents from `/api/v1/ai-agents`. Out of scope for the runtime slice but trivial — half a file change in `FlowEditor.tsx`.
  - **Inbound-routing fallback** (originally also in slice 3 scope) deferred to slice 4 — it needs an `isDefault` flag on `AiAgent` and a tenant-level setting for "auto-reply when no flow triggers", both of which warrant their own ADR. The flow-node path shipped here is enough to start using agents in production: an operator just sets up a flow with a keyword trigger or an `EVENT: message_received` trigger and drops in an `AI_AGENT → MESSAGE` chain.

---

## ADR-028 — Inbound auto-reply: opt-in, one default per tenant, last-resort fallback

- **Date**: 2026-05-23
- **Status**: Accepted; fourth slice of T-052 (blueprint §6 — AI Agent Builder). Closes the "agent answers every inbound DM" loop.
- **Context**: Slices 1-3 let an operator configure an `AiAgent`, run it from a flow node, and dispatch tool calls. To make agents useful for tenants who *don't* want to author flows, we need a default-on-inbound path: when a customer DMs the WhatsApp number and no keyword/event-triggered flow matches, an "always-on" agent should answer. The naive design is to attach the agent at the WhatsApp-config level (`Tenant.defaultAgentId`) — but that conflates "this agent is the default" with "this agent runs every inbound", and tenants need to be able to stage the rollout (configure the agent quietly, then flip the switch).
- **Decision**:
  - **Two independent toggles**, both required for auto-reply to fire:
    1. **`AiAgent.isDefault: Boolean`** — exactly one agent per tenant carries this flag. Service enforces the one-of invariant inside a `prisma.$transaction` that calls `updateMany({where: {tenantId, isDefault: true, id: {not: agentId}}, data: {isDefault: false}})` THEN `update({where: {id: agentId}, data: {isDefault: true}})`. Both writes in the same transaction means there's no observable window where two agents are default — concurrent writes serialize via the conflicting row's lock.
    2. **`Tenant.aiAgentAutoReply: Boolean`** — master switch. Default false; tenants opt in explicitly. Flipping this on without a default agent set is a deliberate no-op (the webhook checks both) so an operator can stage: set up the agent in DRAFT → publish to ACTIVE → mark default → flip auto-reply. Each step is reversible without breaking the others.
  - **Only ACTIVE agents can be marked default.** Marking a DRAFT/DISABLED/ARCHIVED agent as default would silently fail at the webhook (the inbound fallback path requires `status: "ACTIVE"`), and tenants would be confused why their "default" isn't answering. Refusing at write time forces the operator to publish first, which is the actual intent.
  - **Fallback is last-resort, not first-resort.** The trigger order is keyword flow → `message_received` flow → AI auto-reply. An operator who's authored explicit scripted flows keeps that exact UX; the AI is the "if nothing else, answer politely" net. The opposite order (AI first, flows as fallback) would make agent rollout terrifying — every existing flow would suddenly get pre-empted.
  - **`dispatchFlowTriggers` now returns the run count** so `dispatchInboundMessageFlows` can branch on "did anything actually fire". The previous fire-and-forget signature couldn't distinguish "we had no matching flows" from "we tried and they all errored", which would have let auto-reply double-fire on transient errors. Existing callers (`lead_created`, `tag_added`, `appointment_booked` triggers) ignore the return value — backwards compatible.
  - **Tool dispatch runs in the background during inbound auto-reply.** The customer's WhatsApp experience is "send message → get reply", which means the agent's text reply MUST land before the CREATE_LEAD round-trip completes. Tool calls fire via `void Promise.all(...)`, errors are logged, and the reply send proceeds. This is the only path where tools fire-and-forget — the `AI_AGENT` flow node still awaits each dispatch synchronously, because the flow author knows what they're doing.
  - **The inbound handler reuses the MESSAGE-node send gauntlet** (`canSendNow` throttle, `assertCanAffordMessage` wallet check, `decryptTokenIfNeeded`, `sendWhatsAppText`, `recordSend`, `debitMessage`, OUTBOUND Message row with `aiGenerated: true`). Duplicating ~40 lines is the lesser evil for now; the cleaner alternative (extract `sendOutboundText` helper) is a separate refactor that touches both call sites. Marked TODO; not blocking.
  - **`InboundAutoReplyResult.reason` is a 10-variant union** so the test surface and any future observability (Prometheus counter per reason) doesn't have to grep error strings. Variants: `ok_sent`, `skipped_autoreply_off`, `skipped_no_default_agent`, `skipped_contact_opted_out`, `skipped_no_waba`, `skipped_throttled`, `skipped_unfunded`, `skipped_token_decrypt_failed`, `skipped_agent_escalated`, `skipped_agent_empty_reply`, `send_failed`.
- **Consequences**:
  - **22 new unit tests** across `aiAgentInbound.service.test.ts` (12 — every reason code + tool-dispatch + conversation synthesis), `aiAgent.service.test.ts` extension (7 — setDefault transactional demote, idempotence, ACTIVE-only refusal, clearDefault, getDefaultAgent), and `flowTrigger.service.test.ts` extension (3 — keyword path doesn't trigger AI, event-trigger fires preempts AI, fall-through to AI when nothing matched). Total backend: **20 files, 156 tests green** (+22).
  - **New routes** on `/api/v1/ai-agents`: `GET/PATCH /settings` (tenant auto-reply toggle), `POST /:id/set-default`, `POST /:id/clear-default`. All audit-logged.
  - **The "skip reason" log line is gated behind `AI_AGENT_LOG_SKIPS=true`** since the most common case (auto-reply off) would otherwise spam logs at info on every inbound for every non-opted-in tenant. Operators flip the env var when debugging.
  - **T-052 is feature-complete for the API/runtime surface.** What remains is editor palette wiring for `AI_AGENT` and a small operator UI for "make agent default + flip auto-reply" — frontend work. The blueprint §6 AI Agent Builder line item now has end-to-end runtime coverage.

---

## ADR-029 — Compliance Firewall checks before WhatsApp sends

- **Date**: 2026-05-30
- **Status**: Accepted; first automation-first PDF module (T-080)
- **Context**: NexaFlow now sends WhatsApp content from multiple paths: campaigns, drip sequences, flow nodes, direct text replies, direct template sends, and AI-assisted replies. The automation-first roadmap calls for a Compliance Firewall that gives operators a fast safety layer before outbound sends without making hot chat paths slow or brittle. The platform already had opt-out and send-throttle gates; this adds content risk review.
- **Decision**:
  - **Persist every review as `ComplianceCheck`.** Rows are tenant-scoped and store `scope`, `refId`, content hash, verdict, score, violations, rewrite, mode, created-by user, and override metadata. This gives operators an audit trail for both automated worker decisions and manual checks from `/compliance`.
  - **Default mode is `ASSISTED`.** `MANUAL` records verdicts without blocking, `ASSISTED` allows `PASS`, pauses/requires override for `REVIEW`, and hard-blocks `BLOCK`; `AUTOPILOT` allows only `PASS`. The mode is stored sparsely in `Tenant.complianceMode` JSON, with optional per-scope overrides.
  - **Heuristics always run first.** The deterministic pass checks hard policy phrases, aggressive urgency, public short links, all-caps density, currency storms, and punctuation spikes. Optional AI review can raise the risk score or supply a rewrite, but a missing/failed LLM falls back to the heuristic verdict and records that in `reasoning`.
  - **Cache by tenant + scope + content hash for 24 hours.** Re-running the same content should not re-bill the LLM. When the caller changes `refId` or mode, the service clones the cached verdict into a new row so the audit trail still points at the current entity.
  - **Workers may use AI; hot HTTP send paths stay heuristic-only.** Campaign and drip background sends can afford the extra review latency and use the AI reviewer. Conversation replies, direct text sends, campaign creation previews, drip creation previews, and direct template sends use heuristic-only checks so agents and admins do not wait on an LLM in the request path.
  - **Direct template sends must resolve a local template row.** Sending a Meta template by name without a local `WhatsAppTemplate.bodyText` would bypass content review. The `/whatsapp/send-template` route now requires the local template and checks that body before billing, throttle, WABA, or message creation.
  - **Override is narrow.** Only `REVIEW` verdicts in `ASSISTED` mode can be overridden, and the route requires `COMPLIANCE_REVIEW` plus a reason. `BLOCK` remains a hard stop.
- **Consequences**:
  - New UI surface: `/compliance` with mode selector, manual checker, recent checks table, rewrite/reasoning display, and REVIEW override.
  - New enforcement points: campaign worker pauses/fails before the first send, drip worker fails enrollment before the step send, reply/direct text routes return 409 and do not call WhatsApp, direct template sends require a local checked template.
  - Feature flag `complianceFirewall` and permission `COMPLIANCE_REVIEW` gate the module. Business admins and team leads can review/override; agents can trigger reply checks but cannot override.
  - Follow-up: add route-level integration tests once the Express test harness is expanded. Core service behavior is covered by unit tests and the full API test suite.

## ADR-030 — Partner AI sales tools: generate-then-approve, never auto-persist, deterministic fallback

- **Date**: 2026-05-30
- **Status**: Accepted; PRD-v2 §6 Sprint 3 slices 3–4 (AI Demo Builder + AI Proposal Generator)
- **Context**: The automation-first roadmap adds two partner-facing AI tools that turn a one-line prospect brief into something sellable: the **Demo Builder** (brief → a tailored demo workspace: contacts, templates, campaign, AI agent persona) and the **Proposal Generator** (brief → a structured sales proposal: exec summary, pain points, recommended plan + pricing, ROI, timeline). Both are tempting to build as one-shot "brief in, provisioned artifact out" calls. That couples an LLM — which is non-deterministic and occasionally unavailable — directly to irreversible writes (a live tenant, a saved proposal) and gives the partner no chance to review what the model produced before it becomes real.
- **Decision**:
  - **Two-step generate-then-approve.** Generation endpoints (`POST /partner/demo/blueprint`, `POST /partner/proposals/generate`) are pure: they call the LLM, sanitize, and return JSON. They never touch the DB. A separate approve step (`POST /partner/demo/create-with-blueprint`, `POST /partner/proposals`) takes the partner-reviewed payload and persists/provisions. The partner is always the gate between the model and any irreversible action.
  - **The AI output shape *is* the persisted input shape.** `generateDemoBlueprint` returns the exact `DemoSeedPlan` that `createDemoTenant({ seedPlan })` already accepts; `generateProposalDraft` returns the `GeneratedProposal` that `createProposal` accepts. No translation layer, and the partner can hand-edit any field client-side before approving.
  - **Deterministic fallback, never an empty state.** Every generator has an industry-aware fallback used when the LLM throws or the platform has no Anthropic key. The result is tagged `source: "ai" | "fallback"` so the UI and audit log can tell them apart. An AI response that comes back empty is treated as a failure and swapped for the fallback.
  - **Billed to the partner tenant.** Both generators bill through the existing `runTenantLlmJson` plumbing (`assertCanAffordAi` + `debitAi`) against the partner tenant — the partner is the consumer of the tool, not the (not-yet-existent) prospect.
  - **Server-side validation before any write.** Routes validate the approved payload with Zod (length caps, enum guards, E.164-ish phone limits) independently of what the model claimed, so a hand-edited or replayed blueprint can't smuggle oversized or malformed data into a tenant.
  - **Proposal lifecycle is guarded.** `Proposal.status` moves DRAFT → SENT → ACCEPTED/DECLINED; the service rejects illegal regressions (e.g. ACCEPTED → DRAFT) while allowing ACCEPTED ↔ DECLINED correction, and stamps `sentAt` once on first SEND. `shareToken` is reserved on the row for a future public read-only view — no unauthenticated route is exposed in this slice.
- **Consequences**:
  - New endpoints under `/api/v1/partner/demo` (blueprint, create-with-blueprint) and `/api/v1/partner/proposals` (generate, create, list, get, status). All gated by `CLIENT_CREATE` + a partner-role assertion.
  - New `Proposal` model + `ProposalStatus` enum + migration `20260530190000_proposal`; new audit actions `PROPOSAL_GENERATED` / `PROPOSAL_CREATED` / `PROPOSAL_STATUS_CHANGED`.
  - Unit tests cover the proposal fallback paths and the status-transition guard; the demo blueprint reuses the existing demo provisioning test surface.
  - Follow-up: a public `/p/:shareToken` proposal view and a "send proposal over WhatsApp" action are deferred to a later slice (both expand a proposal's audience and need their own explicit-consent + branding handling).

## ADR-031 — Retention Engine: score from Contact-row signals, not per-contact message fan-out

- **Date**: 2026-05-30
- **Status**: Accepted; PRD-v2 §7 Sprint 4 slice 1 (customer AI Retention Engine)
- **Context**: The customer-facing automation layer needs a retention/win-back engine that tells a business *which of their contacts are slipping away* and what to do about it. The accurate-but-naive design scores each contact by querying their message history (last inbound, reply cadence, conversation recency). For a tenant with tens of thousands of contacts that's tens of thousands of aggregate queries per scan — the scan would either hammer the DB or never finish. The CustomerHealthScore engine (ADR-adjacent, Sprint 3) sidesteps this at the *tenant* level by reading a handful of counts; the retention engine operates at the *contact* level where fan-out is the dominant cost.
- **Decision**:
  - **Score from cheap Contact-row signals only.** `Contact.lastInteractionAt`, `optedOut`, `lifecycleStage`, and `aiScore` are already maintained by the inbound/CRM pipelines. The whole scan is a single `findMany` per tenant — no per-contact message queries — so it scales to large books. The trade-off (no fine-grained reply-cadence signal) is acceptable for a tiering engine and revisited only if accuracy demands it.
  - **Deterministic, explainable tiers.** Recency windows map to ACTIVE (≤14d) / COOLING (≤30d) / DORMANT (≤90d) / LOST (>90d); opt-out is terminal LOST with score 0 regardless of recency. The 0-100 score is a weighted composite (recency 0.6, lifecycle 0.25, intent 0.15) with a per-signal `factors` breakdown persisted on each row so the customer sees *why* a contact landed where it did.
  - **Pure scoring function, isolated and unit-tested.** `scoreContact(contact, now)` is exported and side-effect-free; the persistence/scan/serve layers wrap it. Tests pin the tier boundaries, the opt-out floor, the null-`lastInteractionAt` fallback to `createdAt`, and the lifecycle/intent weighting.
  - **Idempotent daily upsert.** One row per `(tenantId, contactId, dayKey)` UNIQUE so a repeated scan updates in place. Reads serve the latest persisted `dayKey`; `refresh=true` recomputes and persists on demand (the same pattern as the partner customer-health surface). Tier totals come from a `groupBy` over the full day so the tier filter never distorts the counts.
  - **Bounded scan worker.** A 6-hour `setInterval` worker scans the 25 most-recently-active BUSINESS tenants, ≤2000 contacts each, `unref`'d so it never holds the process open. Gated behind the new `retentionEngine` feature flag; the route requires `CONTACT_READ`.
- **Consequences**:
  - New `ContactRetentionScore` model + `RetentionTier` enum + migration `20260530200000_contact_retention`; new `retentionEngine` feature flag; `GET /api/v1/retention` (refresh + tier filter + summary) and a `/retention` customer page.
  - Slice 2 layers on top without schema churn: LLM-written win-back copy per DORMANT contact, and an autopilot action that auto-enrolls DORMANT contacts into a designated win-back `DripSequence` (the enrollment plumbing already exists).
  - Follow-up: if tier accuracy proves too coarse, add a periodic job that denormalizes reply-cadence onto the Contact row so the engine can read it without fan-out.

## ADR-032 — Retention autopilot: Manual/Assisted/Autopilot gate, enroll into existing drip, idempotent + opt-out-safe

- **Date**: 2026-05-30
- **Status**: Accepted; PRD-v2 §7 Sprint 4 slice 2 (win-back autopilot)
- **Context**: Slice 1 (ADR-031) tiers contacts but takes no action. Slice 2 closes the loop: act on DORMANT contacts. The risky shortcut is to build a bespoke win-back sender that blasts messages directly. That duplicates the drip engine's scheduling/throttle/compliance path and — worse — lets an automation send WhatsApp messages to a customer's contacts with no human gate and no re-send protection. Sending on behalf of a business is exactly the kind of irreversible, audience-expanding action that needs an explicit opt-in and strong guardrails.
- **Decision**:
  - **Reuse the drip engine; never build a parallel sender.** Autopilot does one thing — it *enrolls* DORMANT contacts into a partner-chosen `DripSequence` via the existing `enrollContact`. All actual sending, delay scheduling, throttle, and compliance checks stay in the one drip path that's already tested and audited. The retention engine decides *who*, the drip engine owns *how*.
  - **Manual / Assisted / Autopilot gate (the PRD-v2 cross-cutting toggle).** Stored on a per-tenant `RetentionConfig` row, default `MANUAL`. MANUAL = recommendations only, no enrollment. ASSISTED = the run surfaces a candidate count for operator approval but enrolls nothing. AUTOPILOT = candidates are enrolled, capped by `maxEnrollPerRun` (default 50, hard-capped at 500) so a first run on a large dormant book can't fan out thousands of sends.
  - **Idempotent and opt-out-safe by construction.** Candidates are filtered to non-opted-out contacts not already enrolled in the win-back sequence (any status), so a re-scan never re-spams someone who already went through win-back. `enrollContact` independently re-checks opt-out and ACTIVE-sequence status, so even a stale filter or race can't double-send. A non-ACTIVE win-back sequence short-circuits with a clear reason instead of failing per-contact.
  - **Config validated + audited.** `winbackSequenceId` is checked to belong to the tenant before persisting (no pointing at another tenant's drip) and is `SetNull` on sequence delete. Mode changes and real (non-dry-run) autopilot runs write audit rows. The route requires `DRIP_SEQUENCE_MANAGE` to change config or run; reads need `CONTACT_READ`.
  - **Worker self-gates.** The 6-hour retention scan calls `runRetentionAutopilot` per tenant after scoring; it cheaply no-ops unless the tenant is in AUTOPILOT with an ACTIVE sequence. An autopilot error is caught and never aborts the rest of the scan.
- **Consequences**:
  - New `RetentionConfig` model + `RetentionMode` enum + migration `20260530210000_retention_config`; routes `GET/PUT /api/v1/retention/config` and `POST /api/v1/retention/autopilot/run` (with `dryRun`).
  - 7 new unit tests cover the mode gate, the not-configured / not-ACTIVE short-circuits, opt-out + already-enrolled filtering, the enroll cap, and dry-run.
  - Follow-up: LLM-written win-back copy (a generate-then-approve preview like the proposal/demo tools) and per-contact "enroll now" from the retention table are the next adds; both reuse this config + the drip path.

## ADR-033 — LLM win-back copy: generate-only, opt-out is a hard 400, never auto-send

- **Date**: 2026-05-30
- **Status**: Accepted; PRD-v2 §7 Sprint 4 slice 3 (LLM win-back copy)
- **Context**: Slice 1 scored contacts and slice 2 enrolled them into a partner-chosen drip. Operators still need help with the *words*: the "what should I actually say to Priya who's been quiet 45 days?" problem. The tempting design is a one-click "draft and send" that runs the LLM, writes the message, and dispatches over WhatsApp. That couples a non-deterministic model directly to an irreversible outbound message to a customer's customer — exactly the move ADR-030 banned for partner sales tools, and the stakes are higher here because the *recipient* is a third party who hasn't opted into AI-written outreach. The right shape is the same one that worked for proposals and demos: generate-then-approve.
- **Decision**:
  - **Generation-only endpoint, no send.** `POST /retention/winback-copy` returns a `{message, variants, source}` draft. The operator reviews, edits, and pastes into a template, campaign, or drip. There is no "send this now" option in this slice; if outreach is wanted, the existing drip auto-enroll (slice 2) handles delivery with all its compliance/throttle plumbing intact.
  - **Opt-out is a hard 400.** Even though the response is just text, drafting outreach to an opted-out contact normalizes a workflow where the next click sends. The service rejects with a 400 before the LLM is called, and the UI hides the suggest button on opted-out rows. Cheaper than the LLM, and the audit trail is cleaner.
  - **Same fallback pattern as ADR-030.** A deterministic, name-personalized fallback message is returned (tagged `source: "fallback"`) whenever the LLM errors, the platform has no API key, or the model returns nothing usable. The UI is never empty. When the LLM only returns `variants`, the first is promoted to `message` so the response shape stays consistent.
  - **Billed to the tenant.** Uses the existing `runTenantLlmJson` plumbing — `assertCanAffordAi` + `debitAi` against the customer tenant, recorded on `aiUsage`. Spend is capped, audited, and matched to the tenant whose customers benefit.
  - **Sanitized output, bounded prompt.** Message and each variant clamped to 1000 chars; up to 3 variants kept; empty strings filtered. System prompt forbids ALL-CAPS, fake urgency, and multi-emoji spam — guardrails the model can still violate, but the operator-review step is the real safety net.
  - **Surface only on at-risk rows.** The `/retention` table shows "✦ Suggest win-back copy" on COOLING / DORMANT / LOST rows (not ACTIVE) and not on opted-out rows. Result panel shows the message, alternates as a collapsed `<details>`, copy buttons, and a regenerate button. A "Generation only — nothing has been sent" footer keeps expectations clear.
- **Consequences**:
  - New service export `generateWinbackCopy` + `POST /api/v1/retention/winback-copy` route; gated by the existing `retentionEngine` feature flag and `CONTACT_READ`. No new schema, no migration, no audit action — text drafts aren't stored, only the `aiUsage` debit row is.
  - 6 new unit tests pin: AI happy path with variant sanitization, opt-out 400 with no LLM call, 404 cross-tenant scoping, LLM-throw fallback, empty-response fallback, variants-only promotion to `message`.
  - Follow-up: a "save as template" / "save as drip step" shortcut on the draft panel would close the loop without inventing a new sender; both are pure DB writes against existing tables.

## ADR-034 — White-label domain health: append-only samples + 3-strike escalation, never auto-heal

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §5 Sprint 5 slice 1 (white-label automation)
- **Context**: Partner-owned white-label domains can drift between manual checks — a registrar tweak knocks the CNAME out, a Let's Encrypt cert lapses, or a CDN swap mangles SSL — and today the platform only re-verifies when an operator clicks "Verify domain". The tempting shortcut is one of (a) "check on every request", (b) "self-heal by re-issuing the cert / rewriting DNS", or (c) "alert on every single failing probe." (a) inflicts DNS work on the hot path and depends on a flaky network call; (b) gives the platform credentials and authority over the partner's registrar, which we don't and shouldn't have; (c) drowns the SuperAdmin queue with single-tick blips from DNS caches or transient network failures.
- **Decision**:
  - **Append-only `DomainHealthSample` ledger.** Each scan tick writes one row per domain with `outcome` (OK / DNS_DRIFT / SSL_FAILED / UNREACHABLE), the three booleans (cname/txt/ssl), a latency, and a short error. The `Domain` row is updated in-place for its authoritative state; samples drive trend display and the escalation streak. Old samples are pruned to a 14-day window.
  - **Scoped to "should-be-healthy" domains only.** The scan picks `LIVE / SSL_ACTIVE / TXT_VERIFIED / SSL_PENDING`. Domains still in `PENDING_DNS` / `DNS_FOUND` are skipped — they haven't reached the verified bar yet and the operator owns that onboarding flow. The monitor isn't an onboarding tool.
  - **3-consecutive-fails escalation, with SSL as the exception.** DNS_DRIFT and UNREACHABLE need 3 consecutive non-OK samples (>= 12 hours of sustained drift at the 6h cadence) before a PlatformActionItem opens — protects the triage queue from registrar-cache blips and transient network failures. SSL_FAILED escalates on the first observation because a cert outage is immediately customer-visible and the operator needs to act now, not in 12 hours.
  - **Deterministic, no LLM.** Domain health is a binary functional question — the cert is valid or it isn't, the CNAME resolves or it doesn't. Adding an LLM here would just add latency and cost without changing the operator's decision.
  - **Never auto-heal.** No code path re-issues a cert, rewrites DNS, suspends a tenant, or pages the partner. The drift is surfaced as a `DOMAIN_HEALTH_DEGRADED` PlatformActionItem (HIGH severity), the Domain row's `lastError` is updated, and the partner / SuperAdmin acts. The platform doesn't own the partner's registrar or DNS provider, so taking write actions there is out of scope.
  - **Scoped read endpoints.** `GET /partner/domains/health` lists the partner's own domains with recent samples + current failing streak. `POST /partner/domains/health/refresh` runs one scan tick on demand so a partner who just fixed a registrar record doesn't wait 6 hours for the next pass. Both gated by `CLIENT_CREATE` + the partner-tenant role check (same as the rest of the partner surface).
  - **`dedupeKey = code:domainId:dayKey`.** A sustained outage upserts the same PlatformActionItem instead of stacking duplicates; if a resolved item drifts again the next day, it re-opens.
- **Consequences**:
  - New `DomainHealthSample` model + `DomainHealthOutcome` enum + migration `20260530220000_domain_health`; new `PlatformActionCode.DOMAIN_HEALTH_DEGRADED` enum value (added via `DO $$ ALTER TYPE ... $$` so partial re-applies don't fail).
  - 6-hour scan worker wired into `index.ts` next to wallet-risk / platform-monitor / customer-health / retention; `unref`'d so it never holds the process open.
  - 8 unit tests on `decideEscalation` pin every transition: OK no-op, SSL fast-track, single/double drift no-op, 3-strike escalation, OK-breaks-streak, sustained 4+ strikes stays HIGH.
  - Follow-up: a partner-facing `/partner/domains` UI card that lists each domain's health, last sample, and a "refresh now" button reusing this endpoint; an LLM "what does this error mean / how do I fix it" hint over the deterministic `lastError` (generate-then-approve pattern from ADR-030/033).

## ADR-035 — Domain-error explainer: read-only LLM hint over a deterministic playbook fallback

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §5 Sprint 5 slice 3 (white-label automation)
- **Context**: The Sprint 5 slice 1 monitor produces machine-friendly outcomes (`DNS_DRIFT`, `SSL_FAILED`, `UNREACHABLE`) and a short deterministic `lastError`. Partners (often non-technical) still ask "OK but what do I actually click?" The tempting design is an LLM that *fixes* it — auto-trigger a registrar API call, re-issue a cert, suspend the affected tenant. That makes the LLM a decision-maker over partner infrastructure we don't own, and one model hallucination away from breaking a live customer portal. The cheap-but-empty alternative — just append generic copy like "contact your DNS provider" — doesn't justify the AI line on the bill.
- **Decision**:
  - **Generate-then-approve, read-only.** `explainDomainError` returns a `{summary, steps[]}` diagnosis. No write-back, no auto-heal, no audit row, no triggered side effect. The partner reads the steps and runs them themselves — same shape as ADR-030 (sales tools), ADR-033 (win-back copy).
  - **Deterministic per-outcome playbook fallback that does the real work.** Each `DomainHealthOutcome` has a hand-written `{summary, steps[]}` that quotes the partner's actual `cnameHost / cnameValue / txtHost / txtValue` verbatim. That playbook is what runs when no API key is configured, when the LLM errors, when it returns nothing usable, AND when the latest sample is OK or absent (so we don't waste AI credits explaining a healthy domain). The LLM is a polish layer over a usable deterministic answer.
  - **Tenant-scoped lookup on the route.** The Domain is loaded with `findFirst({ id, partnerTenantId })` — a partner can never call `/partner/domains/d_other/explain` and have it succeed, regardless of what tenantId is on the JWT. 404 otherwise. Same partner-scope pattern as the win-back copy endpoint (ADR-033).
  - **Strict system prompt: never invent record values.** The model is told to quote only the four exact strings provided (cnameHost, cnameValue, txtHost, txtValue). The route never sends the LLM other partners' DNS values, and the response is clamped (summary ≤400 chars, ≤8 steps × ≤500 chars each) so a bad model response can't drown the UI.
  - **Billed to the partner tenant.** Same `runTenantLlmJson` plumbing — `assertCanAffordAi` + `debitAi`. The partner pays for what they consume.
  - **Healthy-domain short-circuit before the LLM.** `if (!latest || outcome === OK) return fallback;` Prevents idle "Explain" clicks on a green row from burning AI credits, and prevents type-narrowing surprises from `outcome: DomainHealthOutcome | "UNKNOWN"`.
- **Consequences**:
  - New service export `explainDomainError` + `POST /api/v1/partner/domains/:domainId/explain`. No schema change — diagnoses aren't persisted, only the `aiUsage` debit row is. "✦ Explain this error" button appears only on rows with a non-zero failing streak and a non-OK last outcome.
  - 8 new unit tests pin: cross-partner 404 (verified by call args), no-samples fallback (no LLM call), OK-sample fallback (no LLM call), LLM happy path with empty-step sanitization, LLM-throw fallback to deterministic, empty-LLM-response fallback, partner-scope on the where clause, and DNS_DRIFT fallback embedding the exact cname/txt values.
  - Follow-up: extend to other auto-monitored failures (wallet risk, compliance violations) with the same generate-then-approve shape — each one already has a deterministic explanation surface to fall back on.

## ADR-036 — Webhook failure spike monitor: deterministic three-tier classifier + one auto-heal action (disable)

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §9 Sprint 6 slice 1 (SaaS reliability — first self-heal)
- **Context**: `WEBHOOK_FAILURE_SPIKE` has been declared on the PlatformActionCode enum since Sprint 2 but had no signal source. Outbound webhooks to tenant endpoints accumulate failures silently — the dispatcher keeps trying, the tenant's endpoint stays dead, and AI credits + provider quota burn on retries until somebody notices. The tempting fix is one of (a) "ML model that predicts failure", (b) "send a Slack alert when any single failure happens", or (c) "delete dead webhooks." (a) is overkill — failure-rate windows are unambiguous; (b) drowns SuperAdmins in noise from transient blips; (c) loses the partner's configuration and means they have to re-set everything up after fixing their endpoint.
- **Decision**:
  - **Pure classifier, three deterministic tiers.** `classifyWebhookHealth({ total, failures })` is the only piece of logic. Below the 10-event volume gate it returns null — too small a sample to act on. 50%+ failure rate → HIGH. 80%+ → URGENT. 95%+ on ≥20 events → URGENT *and* auto-disable. No LLM, no fancy windowing — a 24h rolling count is the signal, full stop.
  - **One auto-heal action, and it's reversible: flip `Webhook.isActive=false`.** The dispatcher already gates on `isActive`, so flipping the bit stops retries immediately and costs nothing. The Webhook row stays — partner can re-enable manually after fixing their endpoint, and all their config (URL, events, secret, retry settings) is intact. Auto-disable runs once: if a webhook is already inactive, the scan skips the write so we don't churn `updatedAt` every 6 hours.
  - **Volume gate before rate gate.** The auto-disable specifically requires `total >= 20` so a webhook with 5 fast failures during a brief outage doesn't get disabled. Standard HIGH/URGENT items still raise at 10+ events so operators can investigate flaky endpoints before they cross the catastrophic threshold.
  - **Two `groupBy` queries + one resolve.** `WebhookLog` has no `tenantId` column, so we group by `webhookId` for totals and failures separately, then resolve `{ tenantId, url, isActive }` in a single `findMany` keyed by the candidate ids. Bounded fan-out: only webhooks crossing a threshold trigger the resolve query. Failure detection includes `statusCode >= 400`, `statusCode IS NULL` (dispatcher never got a response), and `error IS NOT NULL` — every failure mode the dispatcher records.
  - **One PlatformActionItem per webhook per day.** `dedupeKey = WEBHOOK_FAILURE_SPIKE:webhookId:dayKey` upserts the same row across scans so a sustained outage doesn't stack duplicates. The `context` carries `{webhookUrl, failureRate, failures, total, autoDisabled}` so an operator gets full context in one click.
  - **Per-gatherer try/catch.** Same pattern as wallet/compliance/provider: a flaky webhook scan can't kill the rest of `runDailyScan`. Failure surfaces in logs; the count just doesn't appear in this scan's output.
- **Consequences**:
  - New gatherer `gatherWebhookFailureSignals` + exported `classifyWebhookHealth` in `platformMonitor.service.ts`. `ScanResult.webhookItems` added; SuperAdmin refresh response shape extended; platform-monitor page TypeScript type updated to match.
  - 10 unit tests pin every transition: below-volume null, exactly-9 null, <50% null, 50%+ HIGH, 80%+ URGENT-not-disable, 95%+ at vol<20 URGENT-not-disable (volume gate enforced), 95%+ at vol≥20 URGENT+disable, 100% on 100 events URGENT+disable, 60%-on-100 HIGH not URGENT (rate gates everything), zero-failures null.
  - No schema change. The auto-disable mutation is the first true self-heal action in the platform; future slices (e.g. auto-cap a runaway AI burner) can follow the same pattern: do one thing, reversibly, and surface it loudly in the action item.
  - Follow-up: an LLM "explain this webhook failure" hint (ADR-035 pattern) over the `lastError` from the most recent failed `WebhookLog`; an `AI_USAGE_SPIKE` gatherer that uses the same three-tier shape against `AiUsage.costInCents` rolling sums.

## ADR-037 — AI usage spike monitor: 24h-vs-7d-baseline classifier, alert-only (no auto-throttle)

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §9 Sprint 6 slice 2 (SaaS reliability — second monitor, deliberately no self-heal)
- **Context**: `AI_USAGE_SPIKE` joins `WEBHOOK_FAILURE_SPIKE` as a PlatformActionCode declared in Sprint 2 but never wired. AI spend is the platform's largest variable cost and the most likely runaway-bill vector (a misconfigured Flow, an infinite loop in an AI Agent, a bot scraping endpoints). The obvious twin to the webhook auto-disable in ADR-036 would be to auto-throttle AI for the tenant — but the cost/benefit doesn't line up the same way, and the design decision is *not* to auto-act here.
- **Decision**:
  - **Alert-only, deliberately no auto-throttle.** Unlike webhook outages, an AI spend "spike" is often intentional: a campaign push, a partner running a bulk classification job, a new AI Agent going live. Auto-throttling would silently break Flows, AI Agents, and Campaign Autopilot — a much wider blast radius than a single webhook. The wallet's existing `assertCanAffordAi` (with `creditLimit` for postpaid) is the real circuit breaker for runaway cost. This monitor's job is to surface the anomaly to the operator, who decides.
  - **Unit-independent baseline: 24h spend ÷ 7-day rolling daily average.** The schema has two AI cost units (`Tenant.aiCreditsPerMonth` in "credits", `AiUsage.costInCents` in actual cents). Comparing across them is awkward and breaks for tenants without a budget configured. The own-history baseline sidesteps both problems: works for every tenant, naturally skips new tenants with no history, and adapts automatically as a tenant's normal usage grows.
  - **Pure three-tier classifier with an absolute floor.** `classifyAiUsageSpike({ spend24hCents, sevenDayAvgCents })`:
    - `spend24hCents < 500` (≈$5) → null. Don't escalate "I spent $0.50 on a 10x spike vs my $0.05/day baseline." Volume floor protects from noise on tiny tenants.
    - `sevenDayAvgCents <= 0` → null. No baseline, can't decide.
    - `multiplier >= 5` → URGENT.
    - `multiplier >= 3` → HIGH.
    - else → null.
  - **Two `groupBy` queries + one resolve.** Same shape as the webhook gatherer: groupBy by tenantId for 24h sum, groupBy for 7d sum, merge in memory, classify, resolve tenant names for only the candidates that crossed a threshold. The 7d window overlaps the 24h window deliberately — the average is over the longer span, so a sustained high day is still the spike even if it's pulling its own baseline up.
  - **Same dedupeKey pattern: per-tenant per-day.** `AI_USAGE_SPIKE:tenantId:dayKey`. One row per tenant per day; sustained burn upserts the same row across scans.
  - **Per-gatherer try/catch.** Same pattern as the rest: a flaky AI usage scan can't break the others.
- **Consequences**:
  - New gatherer `gatherAiUsageSpikeSignals` + exported `classifyAiUsageSpike` in `platformMonitor.service.ts`. `ScanResult.aiUsageItems` added; SuperAdmin refresh response shape extended; platform-monitor page TypeScript type updated to match.
  - 11 unit tests pin: below-floor null (even at 30x), no-baseline null, negative-baseline null (defensive), 2x null, exactly-3x HIGH, between HIGH, exactly-5x URGENT, above-5x URGENT, floor-trumps-multiplier null, flat-spend null, 10x URGENT.
  - This establishes the **alert-only counterpart** to ADR-036's auto-disable. The platform now has two reliability monitors with clear different blast-radius rules: webhooks self-heal because the blast radius is one URL and the action is reversible; AI usage alerts because the blast radius is the tenant's whole AI surface and the action would be irreversible mid-burst.
  - Follow-up: a "compare to a 30-day baseline + per-feature breakdown" deeper-dive panel on the SuperAdmin platform-monitor page when an `AI_USAGE_SPIKE` item is clicked — pure read enrichment, no behavior change.

## ADR-038 — SuperAdmin platform-monitor LLM summary: prioritize across codes, never mutate items

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §9 Sprint 6 slice 3 (SaaS reliability — LLM polish on the deterministic triage queue)
- **Context**: The platform-monitor page lists open `PlatformActionItem` rows grouped by severity, but a SuperAdmin staring at a queue of 50 mixed items still has to manually decide what to do first. The deterministic gatherers (wallet/compliance/provider/webhook/AI usage) are good at *flagging* but bad at *grouping* — e.g. three `WEBHOOK_FAILURE_SPIKE` items for the same tenant are really one customer-side outage. The tempting design is an LLM that *also acts* — auto-resolves duplicates, auto-snoozes seemingly-fixed ones, auto-pings the owning partner. Bad: items have downstream effects (e.g. an auto-disabled webhook waiting on the partner to acknowledge), and a misread by the model would let a real outage drop out of the queue silently.
- **Decision**:
  - **Generate-only prioritization. No mutations, ever.** `runPlatformMonitorSummary` returns a `{headline, actions[], worstItems[], totals, byCode, source}` envelope. The SuperAdmin reads it and decides — no item is ack'd, resolved, or snoozed by the LLM call. Same shape and rationale as ADR-030 (partner sales tools), ADR-033 (win-back copy), ADR-035 (domain error explainer).
  - **Deterministic baseline always runs.** The totals, byCode counts, and severity-ranked worstItems are computed unconditionally from the open queue. The LLM reasons *over* that — it doesn't replace the math. If the LLM is unavailable or returns empty, the fallback is "Triage: {item.title}" per worst-by-severity item, so a SuperAdmin always has a usable action list.
  - **Hard itemId validation.** Every `itemId` the model returns is filtered against the actual set of open items before being persisted in the response. A model hallucinating a "ghost_42" item id never leaks to the UI. Tested explicitly: when LLM returns `["real_1", "ghost_2", "fabricated_3"]`, the response carries only `["real_1"]`.
  - **Billed to the SuperAdmin's own tenant.** The route requires `req.tenantId` and routes to `runTenantLlmJson({ tenantId: req.tenantId, ... })` — the same `assertCanAffordAi` + `debitAi` plumbing every other LLM caller uses. SuperAdmin platform-level operations bill against the platform tenant's wallet; partners who carry their own platform pay their own bill.
  - **Worst-items budget capped at 10 in the prompt.** The model sees the 10 highest-severity items (and total counts/codes for the rest), so a 200-item queue doesn't blow the input window. Sorting is severity-asc first, then `createdAt` desc — pin URGENTs to the top, newest URGENT first.
  - **Actions capped at 3, headline at 22 words.** Same constraint as the AI Partner Assistant (ADR — implicit in `runPartnerAssistantSummary`). Three actions is the "what should I do right now" budget; a 10-item suggestion is just the list again.
- **Consequences**:
  - New service export `runPlatformMonitorSummary` + `POST /api/v1/admin/platform-monitor/summary` (SUPER_ADMIN only via the existing requireRole middleware). No schema change.
  - "✦ Daily summary" button on the SuperAdmin platform-monitor page renders a dismissable card with `{headline, ordered actions[], item-id chips, source tag}` and a "Prioritization only — nothing has been resolved or dismissed" footer.
  - 8 unit tests pin: empty-queue fallback (no LLM call), totals/byCode aggregation, LLM happy path with source: "ai", invented-itemId filtering, LLM-throw deterministic fallback, blank-headline-+-zero-actions fallback, severity-then-recency sort into worstItems, 3-action cap.
  - This is the third "generate-then-approve summary" the platform has now: partner-portfolio (customerHealth), customer-retention (already deterministic, slice 2's autopilot dispatches), and platform-triage (here). Same envelope, same fallback discipline.
  - Follow-up: schedule this summary to run nightly (BullMQ scheduled job) and PUSH it to the SuperAdmin's devices via `sendToTenant` — turns the summary from on-demand into a morning briefing. That's the next slice if the priority is incident response time.

## ADR-039 — Scheduled summary push: every 24h, but only push when there's URGENT or HIGH

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §9 Sprint 6 slice 4 (the ADR-038 follow-up — scheduled morning briefing)
- **Context**: ADR-038 shipped the on-demand LLM summary. To get incident response time down, the SuperAdmin needs the briefing pushed to their phone without having to remember to log in and click the button. The naive design is "schedule the summary every 24h and push the result every time." On healthy days that becomes a daily empty notification that operators learn to ignore — exactly the failure mode the wallet-risk push and the customer-health push were designed to avoid (escalation-on-change, not daily-recap). The other tempting wrong shape is "push only when something *new* lands" — but that fights with the existing per-gatherer dedupeKey logic that re-opens stale items on the next day. We want a calendar-paced briefing without the noise.
- **Decision**:
  - **Schedule the *build* every 24h, but gate the *push* on URGENT/HIGH presence.** The BullMQ scheduler fires `runScheduledPlatformSummary` once a day. Inside, the summary is built (cheap, reuses slice 3's `runPlatformMonitorSummary`) and the push only goes out when `totals.URGENT > 0 || totals.HIGH > 0`. On clean mornings the operator gets no notification — exactly right; the platform is healthy. On busy mornings they get one digest with the LLM-prioritized top-3 actions in the body.
  - **Pick the platform tenant deterministically.** `findPlatformTenantId` returns the oldest active DIRECT tenant. Stable across reboots, doesn't get confused by SuperAdmin impersonation of partners, works on multi-DIRECT test envs. If there's no DIRECT tenant at all, the job returns `{pushed:false, reason:"No active DIRECT tenant found."}` and the next 24h tick tries again.
  - **One BullMQ scheduler, second job name on the same worker.** The platform-monitor worker already runs the 6h scan; the summary scheduler slots in as a second `upsertJobScheduler` with name `"summary"` and `{ every: 24h }`. Adds zero new infrastructure — same queue, same Redis connection, same `trackWorker` lifecycle. The worker fn switches on `job.name` to dispatch to `runDailyScan` or `runScheduledPlatformSummary`. Both stop together on shutdown.
  - **Every failure mode returns the same shape, never throws.** No DIRECT tenant, summary build errors, FCM dispatcher throws — each path returns `{pushed:false, reason, ...}`. Tested explicitly: 8 cases including `findFirst` rejecting, `sendToTenant` rejecting, and the LLM-build path rejecting. A flaky FCM service account or a Redis-disconnected platform doesn't take down the scheduler.
  - **Push payload is operator-actionable in the lock-screen preview.** Title is `Daily ops summary: N urgent · M high`, body is the LLM headline (or fallback) clamped to 140 chars. `data` carries `{type: "PLATFORM_MONITOR_SUMMARY", urgentCount, highCount, totalOpen, source}` so the mobile app can deep-link to `/platform-monitor` on tap. Doesn't include any sensitive tenant data — operators can see counts on the lock screen, real triage happens in-app.
- **Consequences**:
  - New service exports `runScheduledPlatformSummary` + `findPlatformTenantId`; `PlatformMonitorJobData` union extended with `{ kind: "summary" }`. Second `upsertJobScheduler` added to `startPlatformMonitorWorker`. No schema change, no new queue, no new env var.
  - 8 unit tests pin: no-DIRECT-tenant skip, clean-queue skip, MEDIUM/LOW-only skip, single-URGENT push, only-HIGH push, push-dispatcher-throws graceful, summary-build-throws graceful, deterministic oldest-DIRECT selection. The push-payload title and `data.type` are asserted explicitly.
  - This closes the SuperAdmin morning-briefing loop: scoring (wallet risk, compliance, provider, webhook, AI usage, customer health, domain health, retention) → triage queue (platform-monitor items) → prioritization (slice 3 LLM summary) → push (this slice). The platform now self-narrates its own daily incident posture without an operator having to log in first.
  - Follow-up: a "Sent at" timestamp on the SuperAdmin's UI showing when the last scheduled push went out, with a "send me one now" button that triggers the same `runScheduledPlatformSummary` ad-hoc — useful for verifying FCM setup and after long quiet stretches.

## ADR-040 — Last-run view + manual trigger: read BullMQ's own state, don't invent a parallel one

- **Date**: 2026-05-31
- **Status**: Accepted; PRD-v2 §9 Sprint 6 slice 5 (the ADR-039 follow-up — operator verification)
- **Context**: ADR-039 ships the morning-briefing push but creates a new failure mode: a SuperAdmin who configures FCM for the first time, or returns from a long quiet stretch, has no way to tell whether "no push today" means "the platform is healthy" or "FCM is broken." They need both a *view* (did the last scheduled run happen, and what did it do?) and a *trigger* (can I force one now to verify the pipeline?). The wrong shape would be to add a new `LastScheduledRun` table or abuse the audit log — both create a parallel source of truth that can drift from what BullMQ actually did.
- **Decision**:
  - **BullMQ's completed-jobs storage IS the source of truth.** `getLastSummaryRun()` calls `queue.getJobs(["completed"], 0, 50)`, filters to `summary` jobs, and picks the freshest by `finishedOn`. The job's `returnvalue` is already the `ScheduledSummaryResult` the worker returned, so the UI gets the same shape whether it came from a scheduled tick or a manual trigger. No schema change, no parallel state to keep in sync.
  - **Manual trigger enqueues a job; it does not run inline.** `triggerSummaryNow()` calls `queue.add(...)` with `kind: "summary"`. The existing worker picks it up and runs `runScheduledPlatformSummary` exactly the same way the scheduler would. The result lands in completed jobs and surfaces via the next `/last-run` poll. Two payoffs: one code path produces all summary runs (no special "manual" branch), and the manual run is visible in BullMQ's UI/queue dashboards just like the scheduled ones.
  - **Idempotent within a 5-second window.** `jobId: summary-manual-${Math.floor(Date.now() / 5000)}` collapses double-taps to one job — the operator's accidental re-click can't burn two LLM calls. The bucket is short enough that a deliberate "I clicked it once, then again 10 seconds later" still produces two jobs.
  - **Read endpoint failures are non-fatal.** `getLastSummaryRun` catches and returns `null` on any Redis/queue error. The page just doesn't render the banner — the rest of the platform-monitor surface is independent.
  - **Audit only the manual trigger, not the read.** `POST /send-now` writes an audit row with `resource: "PlatformSummaryRun"`, `newValues: { trigger: "manual", jobId }`. The scheduled runs already log to BullMQ; auditing every 24h tick would just be noise. Operator-initiated actions get the audit row.
- **Consequences**:
  - New service exports `getLastSummaryRun` + `triggerSummaryNow`. Two new routes: `GET /api/v1/admin/platform-monitor/summary/last-run` (SUPER_ADMIN, audit-free read) and `POST .../send-now` (SUPER_ADMIN, audited).
  - UI: "Last scheduled push: 3h ago · Delivered · 2 urgent · 1 high" status line under the header on `/platform-monitor`, plus a "📲 Send me one now" button next to "✦ Daily summary" and "Refresh now". After clicking send-now, the page polls last-run once after 1.5s so the timestamp updates without a manual reload.
  - 9 unit tests on the queue inspection logic with a mocked queue: empty queue → null, no summary jobs in completed → null, freshest-by-finishedOn (not list order), skips jobs without `finishedOn`, queue-throws → null, ignores "scan" jobs even when newer, enqueue with bucketed jobId, double-tap dedup within 5s window, null jobId returned cleanly.
  - This is the platform's first instance of "lean on the queue's own state instead of mirroring it." The same shape applies to anywhere else we'd want to expose "when did X last run / let me run it now" — campaign dispatchers, wallet reconciliation, retention scan, etc.
