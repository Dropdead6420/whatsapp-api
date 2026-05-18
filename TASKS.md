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

### T-002 — Wire wallet deductions into AI calls
- **Priority**: P0
- **Blueprint**: §3.5, §6
- **Scope**: S (helpers already exist from T-001)
- **Why**: AI credits are listed on `Tenant.aiCreditsPerMonth` but never decremented.
- **Plan**:
  - Use the `assertCanAffordAi` + `debitAi` helpers already in `billing.service.ts`.
  - In `ai.service.ts callLlmJson()`: pre-check before Anthropic call, debit after on the returned `AiUsage.id`.
  - Per-feature cost mapping via `AI_CALL_COST_CREDITS_AUTOPILOT` etc. env vars, or a `Plan.aiCostPerCall` column (defer to a follow-up).
- **Tests**: success debits; failure doesn't; per-feature cost differs.

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
- T-060 Move workers to dedicated process + Redis-backed leader election (ADR-010)
- T-061 Real-time inbox via Socket.io (already in deps; not wired)
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
