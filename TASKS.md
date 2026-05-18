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

_(none — open this column when a slice is in flight)_

---

## Next up

### T-003 — Idempotency on inbound WhatsApp webhooks
- **Priority**: P0 (security debt)
- **Blueprint**: §13 + SECURITY.md
- **Scope**: S
- **Why**: Meta retries on 5xx. We can produce duplicate `Message` rows on replay.
- **Plan**:
  - Add `@unique` on `Message.metaMessageId` (currently optional, no unique index).
  - In the webhook handler, on duplicate-key error, skip silently and still ack 200.
  - Verify `X-Hub-Signature-256` header against `META_APP_SECRET`.
- **Tests**: replaying the same inbound twice produces one row.

### T-004 — Meta Embedded Signup
- **Priority**: P1
- **Blueprint**: §5.1
- **Scope**: L — split into 3 sub-tasks (Claude: plan before assigning)
- **Why**: Manual WABA token paste is a non-starter for non-technical users.

### T-005 — Provider Abstraction Layer
- **Priority**: P1
- **Blueprint**: §5.3 + ADR-007
- **Scope**: L — split into:
  1. Interface + Meta adapter (refactor existing code; no behaviour change)
  2. `ProviderRoute` table + factory
  3. Gupshup adapter (first BSP)
- **Why**: Single biggest architectural lock-in if we keep delaying. Future BSP work is cheap once this lands.

---

## Backlog (planned but not Codex-ready)

### Compliance + safety
- T-010 Tenant suspension at request layer — `Tenant.status !== ACTIVE` blocks every authenticated request, not just login
- T-011 SSRF protection on flow WEBHOOK node — deny RFC1918, link-local, cloud-metadata IPs
- T-012 Per-account login throttle (currently only IP-level)
- T-013 Encrypt `Tenant.wabaAccessToken` at rest

### Wallet
- T-020 Low-balance alerts (email + in-app)
- T-021 Auto-recharge config
- T-022 Postpaid credit line with billing cycle
- T-023 Daily reconciliation worker — recompute balance from ledger sum, alert on drift

### Partner Portal (blueprint §1.2, §7)
- T-030 Partner role split (Owner / Admin / Staff) + `/partner/*` route group
- T-031 Partner dashboard + customer list (filtered by `parentTenantId`)
- T-032 Partner commissions schema + payout report
- T-033 Partner team management
- T-034 Demo workspace template + expiry + conversion (§11)

### White-label polish (blueprint §1.3, §4, §8)
- T-040 Real SSL provisioning (Cloudflare for SaaS)
- T-041 Custom email sender domain UI
- T-042 Branding preview mode (sandboxed iframe)
- T-043 Module enable/disable matrix UI (currently flag toggles per-tenant)

### AI (blueprint §6)
- T-050 Add AI workflow nodes: `AI_CLASSIFY_INTENT`, `AI_SUMMARIZE`, `AI_EXTRACT_DATA`, `AI_TRANSLATE`, `AI_RECOMMEND`, `AI_CHURN_PREDICT`, `AI_COMPLIANCE_CHECK`, `AI_ROUTE_BEST_AGENT`
- T-051 AI Knowledge Base — schema, content sources, RAG index
- T-052 AI Agent Builder — `AiAgent` model + visual builder + runtime
- T-053 SuperAdmin AI — Platform Monitor, Compliance Auditor, Support Copilot, Revenue Intelligence
- T-054 Partner AI — Partner Assistant, Demo Builder, Sales Proposal Generator
- T-055 Template AI generator + approval predictor

### Enterprise / scale (blueprint §14 Phase 6)

Detailed plan lives in [`docs/SCALE_PLAN_1M.md`](docs/SCALE_PLAN_1M.md).
Tasks below are sequenced; do not jump ahead without finishing the prior phase.

**Phase A — Worker fleet + DB pool (50k concurrent / 200 MPS)**
- T-080 Migrate campaign worker to BullMQ (Codex-ready; first move per scale plan §8)
- T-081 PgBouncer in compose + `DATABASE_URL_POOLED` env (Codex-ready)
- T-082 Migrate appointment worker to BullMQ
- T-083 Migrate flow runtime worker to BullMQ (preserves DELAY resume semantics)
- T-084 Migrate SLA worker to BullMQ (or convert to a singleton scheduled job)
- T-085 Migrate outbound webhook retry to BullMQ with native retry/backoff
- T-086 Migrate lead follow-up worker to BullMQ
- T-087 k6 load test harness in `apps/load/` + `auth-burst`, `inbox-poll`, `webhook-storm` scenarios

**Phase B — Auth + Redis + send throttle hardening (100k concurrent / 400 MPS)**
- T-090 Redis verification cache for access-token validation (sub-ms re-validation)
- T-091 Per-account login throttle in Redis (5 fails / 15 min / account)
- T-092 Redis Cluster behind `getRedis()` — shard by key prefix; failover test
- T-093 Send throttle per-WABA-phone-number (today: per-tenant)
- T-094 Envelope-encrypt `Tenant.wabaAccessToken` at rest with a KMS key (supersedes T-013)

**Phase C — Real-time inbox + read replicas (100k concurrent WS)**
- T-100 WebSocket service (`APP_MODE=realtime`) with Socket.io + Redis adapter (supersedes T-061)
- T-101 Postgres read replica(s); route read-only queries to replicas via Prisma datasource
- T-102 Cursor-based pagination for conversation list (replace `skip/take`)
- T-103 Inbox `useInbox` hook: WS subscribe with polling fallback

**Phase D — Storage partitioning + cold path (sustained 1M)**
- T-110 Declarative monthly partitioning for `Message`, `AuditLog`, `AiUsage`, `WebhookLog`
- T-111 Cold-storage archival for messages > 30 days (replica table or OpenSearch index)
- T-112 OpenSearch index for contact + message full-text search; replace `contains` queries
- T-113 CDN config for `/_next/static/*` and the public marketing page
- T-114 *(plan-only this phase, implement if Phase C load test shows wallet contention)* Wallet sharding strategy

**Phase E — Observability + chaos (production-ready 1M)**
- T-120 OpenTelemetry traces (Next → API → DB → Redis → workers → Meta)
- T-121 Sentry integration (api, web, workers)
- T-122 RED metrics per route, per tenant tier (anonymized)
- T-123 Synthetic checks on /health, /api/v1/health, public booking, login flow
- T-124 Chaos drill: kill workers / one Postgres replica / one Redis shard in staging

**Non-scale enterprise**
- T-062 Scheduled report exports (PDF / CSV)
- T-063 API-key management UI

### Tests
- T-070 E2E test for auth flow (signup → verify → login → refresh → logout)
- T-071 E2E test for send-throttle + wallet debit
- T-072 Integration test for flow runtime (DELAY resume, CONDITION branching, WEBHOOK node)

---

## Done (recent)

Collapsed at the end of each calendar month.

### May 2026
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
