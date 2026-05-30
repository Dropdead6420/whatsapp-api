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
