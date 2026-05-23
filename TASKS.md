# TASKS.md

The single, ordered backlog. Edit this file as work moves.

- **Active** = currently being implemented or in PR. Limit: 3.
- **Next up** = top of the queue, planned and Codex-ready (full plan in `docs/`).
- **Backlog** = identified but not planned yet.
- **Done** = shipped; collapsed monthly.

Each task carries: priority (P0 critical / P1 default / P2 nice-to-have),
blueprint reference, scope (S/M/L), and acceptance criteria.

---

## Active

_(none)_

---

## Next up

### T-052 — AI Agent Builder (slice 3: flow node + inbound routing)
- Slice 1 (schema + service + CRUD API + RBAC) shipped 2026-05-23 (ADR-025).
- Slice 2 (`aiAgentRunner.service.ts` + `POST /:id/test` endpoint) shipped 2026-05-23 (ADR-026).
- Slice 3 (next): `AI_AGENT` flow node that takes `{agentId}` from `node.config` and calls `runAgent`; tool-call dispatch table mapping CREATE_LEAD / ADD_TAG / BOOK_APPOINTMENT / TRANSFER_TO_HUMAN / SEND_TEMPLATE / LOOKUP_CONTACT / LOOKUP_ORDER to existing services; inbound-routing fallback in `whatsappWebhook.service` so unhandled DMs auto-dispatch to a tenant's default agent.

### T-051 — AI Knowledge Base ✅ shipped (slice 1 + embedding/retrieval)
- Slice 1 (CRUD + lifecycle) shipped 2026-05-22; embedding + retrieval landed in the same release (`knowledgeBaseEmbedding.service.ts`).
- Schema `KnowledgeBase` + CRUD API + RAG hook for AI agents

### T-060 — Event-driven flow triggers ✅ shipped (2026-05-20)
- **Priority**: P1
- **Blueprint**: Claude FINAL PDF — Workflow triggers
- **Scope**: M — `flowTrigger.service.ts`; triggers `lead_created`, `tag_added`, `appointment_booked`, `message_received`; wired from leads/contacts/appointments/WhatsApp inbound.
- **Follow-up**: T-060b — Flow create/edit UI trigger dropdown + tag filter helper text.

### T-061 — Workflow action nodes SEND_TEMPLATE + CREATE_LEAD ✅ shipped (2026-05-20)
- **Priority**: P1
- **Blueprint**: Claude FINAL PDF — Workflow action nodes
- **Scope**: S — runtime handlers + FlowEditor palette hints.
- **Follow-up**: T-062 logic nodes (WAIT_FOR_REPLY, SWITCH, FILTER); see `docs/WORKFLOW_BUILDER_PLAN.md`.

### T-004 — Meta Embedded Signup ✅ shipped
- **Priority**: P1
- **Blueprint**: §5.1
- **Scope**: L — shipped in two slices:
  1. ~~Backend code-exchange + token encryption + WABA subscribe~~ ✅ (T-004a, ADR-021)
  2. ~~Frontend Connect-with-Meta button + FB SDK lazy load + popup handler~~ ✅ (T-004b)
- **Follow-ups (queued, not blocking)**: token-expiry refresh job; re-subscribe button on settings page; business-profile sync during onboarding.

### T-005 — Provider Abstraction Layer ✅ fully shipped
- **Priority**: P1
- **Blueprint**: §5.3 + ADR-007 (superseded by ADR-017..ADR-020)
- **Scope**: L — shipped in five steps:
  1. ~~Interface + Meta adapter~~ ✅ shipped (T-005a, ADR-017)
  2. ~~`ProviderRoute` table + tenant-aware factory~~ ✅ shipped (T-005b, ADR-018)
  3. ~~Gupshup adapter (first BSP)~~ ✅ shipped (T-005c)
  4. ~~Per-tenant config from `ProviderRoute.config` (decrypted + ctx-bound)~~ ✅ shipped (T-005d, ADR-019)
  5. ~~SuperAdmin CRUD for `ProviderRoute` (encrypt on write, redact on read)~~ ✅ shipped (T-005e, ADR-020)

---

## Backlog (planned but not Codex-ready)

### New product surfaces (per FINAL Architecture PDF, 2026-05-18)

The FINAL PDF locks in four surfaces we hadn't tracked as explicit slices. None are blocking the current scale plan; they queue behind T-004 / T-005.

- T-141 **Developer / API Portal** — SDK/docs, richer sandbox, usage metering chart (T-141A/B shipped).
- T-143 **Android mobile app** — Phase 7 of the FINAL PDF. Inbox, notifications (FCM), replies, lead pipeline, quick campaigns, booking calendar, AI reply button. Read-only on the API side; no new backend surface beyond push token registration.

### Compliance + safety
- T-010 Tenant suspension at request layer — ✅ already enforced in `requireAuth` auth-context cache
- T-011 SSRF protection on flow WEBHOOK node — ✅ shipped (`ssrfGuard.ts`)
- T-012 Per-account login throttle (currently only IP-level)
- T-013 Encrypt `Tenant.wabaAccessToken` at rest

### Wallet
- T-020b Low-balance email alerts (in-app banner shipped on dashboard)
- T-021 Auto-recharge config
- T-022 Postpaid credit line with billing cycle
- T-023 Daily reconciliation worker — recompute balance from ledger sum, alert on drift

### Partner Portal (blueprint §1.2, §7)
- T-030b Partner role split (Owner / Admin / Staff enum) — optional; WHITE_LABEL_ADMIN + TEAM_LEAD used for now
- T-031 Partner commissions schema + payout report
- T-032 Partner commissions schema + payout report
- T-033 Partner team management
- T-034 Demo workspace template + expiry + conversion (§11)

### White-label polish (blueprint §1.3, §4, §8)
- T-040 Real SSL provisioning (Cloudflare for SaaS)
- T-041 Custom email sender domain UI
- T-042 Branding preview mode (sandboxed iframe)
- T-043 Module enable/disable matrix UI (currently flag toggles per-tenant)

### AI (blueprint §6)
- T-050b Remaining AI workflow nodes — ✅ shipped (RECOMMEND, CHURN_PREDICT, ROUTE_BEST_AGENT)
- T-051 AI Knowledge Base — schema, content sources, RAG index
- T-052 AI Agent Builder — `AiAgent` model + visual builder + runtime
- T-053 SuperAdmin AI — Platform Monitor, Compliance Auditor, Support Copilot, Revenue Intelligence
- T-054 Partner AI — Partner Assistant, Demo Builder, Sales Proposal Generator
- T-055 Template AI generator + approval predictor

### Enterprise / scale (blueprint §14 Phase 6)

Detailed plan lives in [`docs/SCALE_PLAN_1M.md`](docs/SCALE_PLAN_1M.md).
Tasks below are sequenced; do not jump ahead without finishing the prior phase.

**Phase A — Worker fleet + DB pool (50k concurrent / 200 MPS)** ✅ code complete; load test pending

Phase A is shipping code complete; a live k6 run against staging is the
remaining gate before Phase B opens. See `apps/load/README.md`.

**Phase B — Auth + Redis + send throttle hardening (100k concurrent / 400 MPS)** ✅ code complete; load test pending

A live k6 run at 100k concurrent / 400 MPS is the remaining gate before Phase C opens.

**Phase C — Real-time inbox + read replicas (100k concurrent WS)** ✅ code complete; load test pending

A live WS load run at 100k concurrent and an inbox-poll k6 scenario against a replica setup are the remaining gates before Phase D opens.

**Phase D — Storage partitioning + cold path (sustained 1M)** 🟡 planned + T-113 shipped

Detailed plan in [`docs/PHASE_D_STORAGE_PLAN.md`](docs/PHASE_D_STORAGE_PLAN.md). Migration-mode swap from `prisma db push` → `prisma migrate` is the prerequisite for T-110/T-111/T-112.

- T-110 Declarative monthly partitioning for `Message`, `AuditLog`, `AiUsage`, `WebhookLog` — needs migration-mode swap first
- T-111 Cold-storage archival for messages > 30 days (depends on T-110)
- T-112 OpenSearch index for contact + message full-text search; replace `contains` queries
- T-114 Wallet sharding strategy (plan-only — implement only if Phase C load shows real contention)

**Phase E — Observability + chaos (production-ready 1M)** 🟡 T-121/T-122/T-123/T-124 shipped; T-120 deferred
- T-120 OpenTelemetry traces (Next → API → DB → Redis → workers → Meta) — deferred until span data becomes load-bearing; Sentry traces + Prometheus give us enough for now

**Non-scale enterprise**
- T-062 Scheduled report exports (PDF / CSV)

### Tests
- T-070 E2E test for auth flow (signup → verify → login → refresh → logout)
- T-071 E2E test for send-throttle + wallet debit
- T-072 Integration test for flow runtime (DELAY resume, CONDITION branching, WEBHOOK node)

---

## Done (recent)

Collapsed at the end of each calendar month.

### May 2026
- ✅ **T-052 AI Agent Builder slice 2** — `aiAgentRunner.service.ts` (stateless `runAgent` → `{reply, toolCalls, citations, escalated, escalationBehavior, reason, modelUsed, providerUsed}`), KB grounding looped across multiple `knowledgeScope.categories`, cross-vendor provider fallback (configured-but-wrong key swaps to the other provider rather than 500-ing), wallet debit only on successful LLM response, permissive tool-JSON extraction (fenced + bare), `POST /api/v1/ai-agents/:id/test` endpoint for operator persona iteration. 15 new tests; 17/17 files, 107/107 tests green. See ADR-026.
- ✅ **T-052 AI Agent Builder slice 1** — `AiAgent` Prisma model (status DRAFT/ACTIVE/DISABLED/ARCHIVED, fallback ESCALATE/SEND_TEMPLATE/SILENT), `aiAgent.service.ts` with provider+model allowlist enforced at write-time, `/api/v1/ai-agents` CRUD + lifecycle endpoints (publish/disable/archive/delete) behind `aiAgents` feature flag + new `AI_AGENT_MANAGE` permission. KB-scope is a JSON column (no join table for 1–4 agents × ~30 entries). 15 new service tests; 16/16 files, 92/92 tests green. See ADR-025.
- ✅ **T-051 AI Knowledge Base** — schema (KnowledgeBaseEntry + category/status enums), CRUD + lifecycle service, `/api/v1/knowledge-base` routes, `KNOWLEDGE_BASE_MANAGE` permission, `knowledgeBase` feature flag, `/knowledge-base` dashboard page. Embedding service (`knowledgeBaseEmbedding.service.ts`) with OpenAI + local-hash fallback, BullMQ worker, retrieval helper wired into AI nodes for grounding. SSRF guard utility shared between webhook nodes + future KB ingest URLs.
- ✅ **T-011 SSRF guard** for flow WEBHOOK nodes — blocks private IPs, localhost, metadata hosts; DNS verify with timeout.
- ✅ **T-060b Flow trigger UI** — dropdown + keyword/tag editor on `/flows` detail panel.
- ✅ **T-050b AI workflow nodes** — `AI_RECOMMEND`, `AI_CHURN_PREDICT`, `AI_ROUTE_BEST_AGENT`.
- ✅ **Business profile manager** — `PATCH /whatsapp/config/profile` pushes about/vertical to Meta; edit form on `/whatsapp-settings`.
- ✅ **T-020 wallet low-balance alert** — `GET /wallets/alerts` + dashboard banner.
- ✅ **Developer API usage chart** — `GET /api-keys/usage-summary` + 7-day bar on `/developer`.
- ✅ **T-030 Partner portal** — `/api/v1/partner/*` (dashboard, customers CRUD, team list/invite) + `/partner/*` UI (dashboard, customers, team). WHITE_LABEL_ADMIN lands on `/partner/dashboard`.
- ✅ **T-140 Agent portal** — `/agent/inbox`, `/agent/leads`; API auto-scopes conversations/leads to assignee for `AGENT`; `AgentShell` nav.
- ✅ **T-050 / T-062 workflow nodes** — `AI_CLASSIFY_INTENT`, `AI_SUMMARIZE`, `AI_EXTRACT_DATA`, `AI_TRANSLATE`, `AI_COMPLIANCE_CHECK`, `WAIT_FOR_REPLY`, `SWITCH`, `FILTER` + inbound resume via `flowWait.service.ts`.
- ✅ **T-142 Marketplace templates** — `FlowTemplate` model, seed (6 industries), `GET/POST /api/v1/flow-templates`, install UI on `/flows`.
- ✅ **T-060 Event-driven flow triggers** + **T-061 SEND_TEMPLATE / CREATE_LEAD nodes**. `flowTrigger.service.ts` fires flows on `lead_created`, `tag_added`, `appointment_booked`, and `message_received` (after keyword pass). New workflow nodes registered in runtime + FlowEditor hints. See `docs/WORKFLOW_BUILDER_PLAN.md` and `docs/CLAUDE_FINAL_PDF_GAP_MATRIX.md`.
- ✅ **T-004 Meta Embedded Signup**. New `Tenant.metaBusinessId` column; `services/metaSignup.service.ts` exchanges the FB.login code at `oauth/access_token`, subscribes the WABA to our app, and persists the long-lived token via the T-094 envelope-encryption path. New `POST /api/v1/whatsapp/embedded-signup` route (gated by `WABA_CONFIGURE`) wires that into the request layer with audit logging that masks the token. Frontend `/whatsapp-settings` adds a "Connect with Meta" button above the manual form — lazy-loads the FB SDK, opens the Embedded Signup popup, joins the `WA_EMBEDDED_SIGNUP` `MessageEvent` payload with the FB code + business id, and POSTs to the backend. Gracefully degrades when `NEXT_PUBLIC_META_APP_ID` / `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` aren't set. 5 new service tests; 49/49 green. Live smoke verified: 400 "not configured" without `META_APP_*`, 400 validation on malformed body, 401 unauthenticated, 200 path is gated behind real Meta credentials. See ADR-021.
- ✅ **T-005e SuperAdmin CRUD for `ProviderRoute`**. New `/api/v1/admin/provider-routes` route group (SuperAdmin only) — list / create / patch / delete. `config` is JSON.stringified + envelope-encrypted on write via `tokenCrypto.encryptToken`; responses return only `configPreview` with masked values. New `PROVIDER_ROUTE_MANAGE` permission (auto-granted to SUPER_ADMIN). Audit log captures every mutation with `configKeys` but no values. Nav entry added under Platform → Provider Routes; admin page at `/provider-routes` with create form + toggle-active + delete. 7 new service tests; 44/44 total green. Live smoke verified: encrypt-in-DB, mask-on-list, 409 on duplicate, 403 on non-admin, audit trail intact. See ADR-020.
- ✅ **T-005d Per-tenant config from `ProviderRoute.config` via `SendContext`**. `WhatsAppProvider` methods now accept an optional `ctx: SendContext` carrying the decrypted, JSON-parsed route config. Factory does the decrypt (via `tokenCrypto.decryptTokenIfNeeded` — legacy plaintext passes through) + binds it onto a closure-wrapped adapter, so call sites don't change. Gupshup adapter prefers `ctx.config` over env; partial config falls through to env. 4 new unit tests + 2 new factory tests. See ADR-019. T-005e (SuperAdmin CRUD UI that encrypts on write) is the natural follow-up.
- ✅ **Login UX hardening**. The login page now maps `ApiClientError.code` to specific user-facing copy (`INVALID_CREDENTIALS`, `TOO_MANY_REQUESTS`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN`), and surfaces a "Can't reach the server" message — not a credential error — when fetch itself fails. Adds a contextual hint below the main message for the throttled and unverified cases. Closes the bug where every failure looked like a wrong password.
- ✅ **T-005c Gupshup adapter (first non-Meta BSP)**. `services/whatsapp/providers/gupshup.ts` implements the `WhatsAppProvider` interface against Gupshup's form-encoded `/wa/api/v1/msg` + `/wa/api/v1/template/msg` endpoints; registered in the factory's `ADAPTERS` map. Credentials read from `GUPSHUP_API_KEY` / `GUPSHUP_APP_NAME` / `GUPSHUP_SOURCE` env (per-tenant config from `ProviderRoute.config` follows as T-005d). 4 unit tests with mocked fetch + a new factory test for Gupshup routing. 33/33 tests pass.
- ✅ **T-005b ProviderRoute table + tenant-aware factory**. New `ProviderRoute` model + `WhatsAppProviderKey` enum (META / GUPSHUP / DIALOG_360 / TWILIO / HAPTIK). `getWhatsAppProvider({tenantId, phoneNumberId?})` consults the table: phone-scoped row → tenant default → Meta fallback. All 7 send sites now pass `tenantId`; existing tenants see zero routing change (no rows = Meta). 5 new factory unit tests cover the lookup matrix. See ADR-018.
- ✅ **T-005a Provider abstraction (Meta-only baseline)**. New `services/whatsapp/` with `WhatsAppProvider` interface + `metaProvider` adapter + `getWhatsAppProvider()` factory. Old `services/whatsapp.service.ts` becomes a thin re-exporter — every existing send-path caller keeps working unchanged. ADR-017 documents the contract. 23/23 tests still pass; live API boots + shuts down clean. Unblocks T-005b (`ProviderRoute` table) and T-005c (Gupshup adapter).
- ✅ **T-124 Chaos drill runbook**. `docs/CHAOS_DRILL_RUNBOOK.md` — 5 scenarios (kill worker, kill replica, kill Redis shard, saturate Anthropic, cold-cache restart) with expected behavior + page-if thresholds. Staging-only; quarterly cadence.
- ✅ **T-123 Synthetic checks**. `apps/load/scenarios/synthetic-checks.js` — k6 script that probes `/live`, `/api/v1/health`, `/api/v1/ready` (verifies postgres+redis), public booking, and the login pipeline (deliberately bad password → canonical 401). Designed for cron from any external runner (Cloudflare Workers, Datadog, GH Actions). k6 exits non-zero on regression.
- ✅ **T-122 RED metrics via prom-client**. `nexaflow_http_requests_total`, `nexaflow_http_request_duration_seconds`, `nexaflow_http_request_errors_total` labeled by `{method, route, status_class}`; default Node.js + process metrics also exposed. Route labels use Express's matched-route path with a cardinality-strip fallback that requires BOTH letters and digits so words like "conversations" stay verbatim while CUIDs/UUIDs collapse to `/:id`. Exposed at `GET /api/v1/admin/metrics` (SuperAdmin only). Verified live with 8+ request samples.
- ✅ **T-121 Sentry integration**. `lib/observability.ts:initSentry()` wires `@sentry/node` v8 when `SENTRY_DSN` is a live URL; no-ops on placeholder / unset. Error handler forwards 500-class to `captureException`; `unhandledRejection` + `uncaughtException` also captured. `SENTRY_TRACES_SAMPLE_RATE` default 0.1. `sendDefaultPii: false` — request bodies never leave the box.
- ✅ **T-113 CDN cache headers**. `next.config.js` declares `Cache-Control` for `/_next/static` (immutable, 1y), `/_next/image` (1d + SWR 7d), the marketing root (s-maxage 5min + SWR 1d), and public image/text files (1h + SWR 1d). Dashboard pages stay uncached. The CDN itself (Cloudflare / Vercel) is operationally configured; this is the origin-side contract.
- ✅ **Phase D storage plan**. Consolidated `docs/PHASE_D_STORAGE_PLAN.md` covering T-110 monthly partitioning (rollout order, SQL skeleton, partition-maintenance worker design), T-111 cold-storage archival, T-112 OpenSearch search, and T-114 wallet sharding. Implementation gated on a migration-mode swap from `db push` to `prisma migrate` (separate small task).
- ✅ **Bug-fix pass on Phase A-C work**. realtime.ts cast-LHS → canonical assignment; conversations cursor pagination dropped a dead null branch and now treats a null cursor.lastMessageAt defensively as `now()`; apiKeyAuth.ts notes the missing per-key rate-limit enforcement so the next reader sees the gap.
- ✅ **T-141B Developer/API Portal API usage logs + sandbox endpoint**. Added `ApiRequestLog`, API-key auth middleware using stored hashes, `/api/public/v1/status` key-authenticated sandbox endpoint, last-used updates, per-request logging, and recent-call viewer in `/developer`.
- ✅ **T-141A Developer/API Portal API key management**. Added tenant-scoped `/api/v1/api-keys` create/list/update/revoke routes behind `developerPortal` + `api_keys:manage`, a `/developer` Business Admin UI, one-time plaintext secret reveal, SHA-256 stored hashes only, audit logs for create/update/delete, and unit tests for key generation/hash/list/revoke behavior.
- ✅ **T-103 `useInbox` hook: WS subscribe + polling fallback**. New `apps/web/src/hooks/useInbox.ts` owns fetch + Socket.io subscription + 15s polling fallback when WS is offline. The inbox page exposes a "Live"/"Polling" pill so operators can see realtime state at a glance. Re-fetches on `message:received`, `message:sent`, `conversation:updated`, `conversation:assigned`.
- ✅ **T-102 Cursor pagination on /conversations**. Base64-url `{lastMessageAt, id}` composite cursor; `?cursor=...` skips the O(N) `skip/take` + `COUNT()` path. Legacy `?page=X` still works, response includes both forms during the transition. Bad cursors → 400. Verified live.
- ✅ **T-101 Read-replica routing via `prismaRead`**. New client in `@nexaflow/db` reads from `DATABASE_URL_READ` when set, aliases to the primary otherwise. `/conversations` list, `/analytics`, and `/admin/audit-logs` route through the replica.
- ✅ **T-100 Socket.io realtime layer**. `/realtime` endpoint, JWT-authenticated via `authService.verifyAccessToken` + the T-090 auth-context cache. Per-tenant rooms auto-joined; per-conversation rooms opt-in via `conversation:subscribe`. `@socket.io/redis-adapter` for cross-replica fan-out. Inbound webhook + agent reply both emit. Verified live: valid JWT connects in 13ms, missing/invalid rejected explicitly.
- ✅ **T-094 Envelope-encrypt `Tenant.wabaAccessToken` at rest**. AES-256-GCM with a per-record DEK encrypted under a KEK derived from `TENANT_TOKEN_ENCRYPTION_KEY` via HKDF. On-disk format `v1:<base64>`, version-prefixed for future KMS swap. Backwards compatible — legacy plaintext is passed through and re-encrypted on next write. 4 new unit tests; closes the WABA-token plaintext debt in SECURITY.md.
- ✅ **T-093 Send throttle per-WABA-phone-number**. Adds a second sliding-window check keyed by phone-number id; `SEND_PER_PHONE_PER_SECOND_LIMIT` default 80. Wired through all 6 send paths.
- ✅ **T-092 Redis Cluster behind `getRedis()`**. Cluster transport via `REDIS_CLUSTER_URLS`; tenant-scoped keys hash-tagged so multi-key ops stay on one slot. New `pingRedis()` replaces the cluster-incompatible `redis.ping()` in readiness checks.
- ✅ **T-091 Per-account login throttle (5 fails / 15 min)**. Email is sha256-hashed before being used as a Redis key. Pre-check happens before bcrypt so locked-out attackers can't burn CPU. Closes the per-account throttle debt in SECURITY.md.
- ✅ **T-090 Redis-cached auth context (sub-ms re-validation)**. requireAuth now consults a 60s Redis cache of `{userStatus, role, tenantId, tenantStatus, revokedAt}` and rejects suspended users/tenants without a DB hit on the hot path. Verified live: cache miss = 45ms, cache hits = 4–6ms.
- ✅ **T-087 k6 load harness in `apps/load/`** — 3 scenarios (`auth-burst`, `inbox-poll`, `webhook-storm`) with thresholds aligned to the Phase A target (50k concurrent / 200 MPS).
- ✅ **T-082..T-086 Remaining workers → BullMQ**. Appointment, flow, SLA, webhook retry, and lead follow-up workers all migrated off `setInterval` polling. Scan-style workers (appointment / flow / sla / lead-followup) use repeatable scan jobs every 30–60s; the webhook retry worker uses BullMQ-native `attempts` + a custom backoff strategy preserving the existing 1m/5m/30m/2h schedule. Flow worker uses `updateMany where status=WAITING` to atomically claim runs across replicas. `/admin/queues` reports depth for all 6 queues. See ADR-015.
- ✅ **T-081 PgBouncer + `DATABASE_URL_POOLED`**. `edoburu/pgbouncer:v1.24.1-p1` added to docker-compose on `:6432` in transaction mode. `packages/db/src/index.ts` reads `DATABASE_URL_POOLED || DATABASE_URL` at runtime; schema's `env("DATABASE_URL")` continues to drive `prisma migrate`. Backwards compatible — dev keeps working without the pool. See ADR-016.
- ✅ **T-080 Campaign worker migrated to BullMQ**. `dispatchCampaign(id)` is now a queue job; a repeatable `scan` job runs every 30s and enqueues due `SCHEDULED` campaigns with `jobId: dispatch:<id>` for natural dedup. Producer side covered by 2 unit tests; live boot verified the scheduler registers in Redis (`bull:campaign-dispatch:repeat:scan`) and shutdown drains cleanly in <1s. Added `GET /api/v1/admin/queues` for depth visibility. Bull v4 dep dropped (it was unused). See ADR-015.
- ✅ **T-003 Inbound WhatsApp webhook idempotency + signature verification**. `Message.metaMessageId` is unique, webhook raw body is preserved, `X-Hub-Signature-256` is verified with constant-time HMAC when `META_APP_SECRET` is configured, production fails closed without a real secret, duplicate provider message ids skip all downstream side-effects, and duplicate-key races return `null` instead of re-processing.
- ✅ **T-002 Wallet debits wired into AI calls** (shared `callLlmJson()` pre-checks via `assertCanAffordAi`, logs `AiUsage`, then debits idempotently via `debitAi(AiUsage.id)`). Supports global `AI_CALL_COST_CREDITS` and per-feature overrides like `AI_CALL_COST_CREDITS_CAMPAIGN_AUTOPILOT`. Tests cover success debit, provider failure no-debit, and feature override pricing.
- ✅ **T-001 Wallet debits wired into 7 WhatsApp send paths** (whatsapp routes ×2, conversation reply, campaign worker, appointment worker, lead follow-up, flow MESSAGE node). Feature-flagged via `WALLET_BILLING_ENABLED` (default off). Idempotent via unique index on `WalletTransaction(walletId, referenceType, referenceId)`. Pre-check returns 402; campaign worker treats 402 as PAUSED. See ADR-013.
- ✅ Domain Connection: schema, API, DNS verification, `/domains` page (blueprint §4)
- ✅ Wallet + Transaction schema + service skeleton (blueprint §3.5)
- ✅ Outbound webhooks: signed delivery + retry worker + 7 event types (blueprint §6.4)
- ✅ Visual flow editor (React Flow) with 9 node types + drag-add palette + JSON config drawer
- ✅ Flow runtime: engine, DELAY worker, audit trail, keyword trigger on WhatsApp inbound
- ✅ Conversation labels + SLA worker + first-response timer (blueprint §6.1 inbox)
- ✅ Canned replies + internal notes
- ✅ Send-rate throttle (per-second + monthly quota) (blueprint §13)
- ✅ Opt-out: STOP keyword handler + re-opt-in UI with consent warning
- ✅ Appointment booking: services, public booking page, reminders, confirmations
- ✅ AI Campaign Autopilot: end-to-end (audience filter, message variants, send time, follow-up sequence)
- ✅ AI Smart Segmentation, Lead Scoring, Reply Suggestions, Sentiment, Copy Generator
- ✅ Per-tenant feature flags (11 keys) + SuperAdmin toggle UI + nav-level hiding
- ✅ Tenant CRUD + branding (logo, colors, custom CSS) + Subscriptions view
- ✅ SuperAdmin: platform health, billing overview, audit logs page
- ✅ Auth foundation: signup, login, refresh, email verify, password reset, auto-resend on unverified signup
- ✅ Multi-tenant Prisma schema + Express API + Next.js scaffold
- ✅ Documentation infrastructure: CLAUDE.md, CODEX.md, docs/{ARCHITECTURE,DECISIONS,SECURITY,ROADMAP}.md, TASKS.md

---

## Rules for this file

1. **One task per line item.** No combined work.
2. **Active is capped at 3.** Anything more means context loss.
3. **Codex picks from "Next up" only.** If a task isn't there with a plan, ping Claude.
4. **Mark done with the date** in the May 2026 / June 2026 section.
5. **Move items between sections** in the same PR that ships the work.
