# ROADMAP.md

Phased plan tied to **`/Users/sidharthkumar/Downloads/NexaFlow_Codex_FINAL_Full_Implementation_Blueprint_and_Features.pdf`** (2026-05-18, canonical) and the prior **Final Product Blueprint V3** (`NexaFlow_AI_Final_Product_Blueprint.pdf`).

The FINAL Architecture PDF is the single product-scope reference for both Claude and Codex. Where it conflicts with the older blueprint, FINAL wins. The two are mostly identical; FINAL adds the **Agent Portal**, **Developer/API Portal**, **Marketplace Templates**, and the **Android Mobile App** as explicit surfaces — all captured in [`TASKS.md`](../TASKS.md).

Each phase lists: section reference, code status (✅ shipped / 🟡 partial / ❌ not started), and the missing slices ordered by blast radius.

Status snapshot: see [`docs/BLUEPRINT_PHASE_AUDIT.md`](BLUEPRINT_PHASE_AUDIT.md) for a finer-grained per-module table.

---

## Phase 1 — Core Customer Product (blueprint §3.3, §3.5.1, §3.5.4 Phase 1)

**Status: ✅ shipped (with polish to do)**

- ✅ Auth, signup, login, refresh, email verify, password reset
- ✅ JWT + Redis-backed refresh JTI store, RBAC, audit logs
- ✅ Multi-tenant Prisma schema, 27 models, 22 enums
- ✅ Contacts (CRUD, lifecycle stages, tags, custom fields JSON, CSV export, bulk import)
- ✅ Inbox (assignment, round-robin, internal notes, canned replies, labels, sentiment chip, AI reply suggestions, SLA worker)
- ✅ Templates CRUD
- ✅ Campaigns (broadcast + scheduled + drip; throttle-aware dispatch; paused-on-quota)
- ✅ Customer admin dashboard with quota progress card

**Polish backlog**:
- E2E tests for auth + send paths
- Campaign analytics depth (revenue attribution, A/B winner picker)
- Template approval webhook handling

---

## Phase 2 — Meta / WhatsApp Onboarding (blueprint §5)

**Status: 🟡 partial — manual WABA config works; Embedded Signup missing**

- ✅ Meta Cloud API outbound (text + template)
- ✅ Inbound webhook with verify-token handshake
- ✅ STOP / UNSUBSCRIBE / CANCEL keyword opt-out
- ✅ Send throttle (per-second/provider smoothing; no artificial plan message caps)
- ✅ Idempotent inbound webhook processing (`Message.metaMessageId @unique`)
- ✅ Meta `X-Hub-Signature-256` verification over the raw request body
- ✅ WABA quality fields on `Tenant` (`wabaQualityRating`, `wabaMessagingLimitTier`, `wabaAccountStatus`, `wabaLastSyncedAt`)
- ✅ `/whatsapp-settings` admin page

**Missing — ordered by importance**:
1. **Meta Embedded Signup** — Facebook OAuth → auto-capture Business ID + WABA ID + Phone Number ID + auto-configure webhook
2. **Provider Abstraction Layer** (ADR-007) — `WhatsAppProvider` interface; Meta Cloud + Gupshup + 360dialog + Haptik + Twilio adapters; `ProviderRoute` table
3. **Business Profile Manager UI** — display name update, profile description, business hours; status fields are already in the schema
4. **Template submission to Meta** with status tracking + approval webhook handling

---

## Phase 3 — Partner Portal (blueprint §1.2, §7)

**Status: 🟡 early — tenant hierarchy exists, partner dashboard does not**

The schema has `Tenant.parentTenantId` for white-label hierarchy. There is no
separate `Partner` model, no partner dashboard, no commission engine.

**Slices in order**:
1. **Partner role + dashboard skeleton** — Partner Owner / Admin / Staff roles; new `/partner/*` route group; partner customer list (filtered to `parentTenantId === current`)
2. **Partner wallet** (depends on §3.5 wallet system below)
3. **Partner commissions + revenue share** — schema for commission rules per partner; payout report
4. **Demo system** — demo workspace template, demo expiry, demo→paid conversion (blueprint §11)
5. **Partner team management** — invite, role assignment, audit

---

## Phase 4 — White-label Portal (blueprint §1.3, §4, §8)

**Status: 🟡 partial — domains + branding shipped; email + module control + preview missing**

- ✅ `Domain` model with 5 portal types, DNS + SSL status machine, CNAME + TXT verification
- ✅ Tenant branding fields (logo, colors, custom CSS, primary domain)
- ✅ `/domains` admin page
- ✅ Per-tenant feature flags

**Missing — ordered by importance**:
1. **Real SSL provisioning** (currently stubbed) — Cloudflare for SaaS or Caddy / Let's Encrypt
2. **Custom email sender domain + SMTP / Resend config UI**
3. **White-label preview mode** — render the customer's portal in a sandboxed iframe
4. **Module enable/disable matrix** — already possible via feature flags; needs a dedicated white-label admin UI
5. **Meta title + meta description + favicon**

---

## Phase 5 — AI Automation Layer (blueprint §6)

**Status: 🟡 strong partial — AI features shipped; AI Agent Builder + Knowledge Base missing**

- ✅ AI Campaign Autopilot (closes loop into scheduled campaigns + follow-up sequence)
- ✅ AI Smart Segmentation (NL → filter)
- ✅ AI Lead Scoring (manual + auto on first inbound)
- ✅ AI Reply Suggestions
- ✅ AI Sentiment
- ✅ AI Copy Generator
- ✅ AI Lead Follow-up recommendations + dispatch worker
- ✅ Flow Builder runtime (9 nodes: START, END, MESSAGE, CONDITION, DELAY, ADD_TAG, AGENT_TRANSFER, AI_RESPONSE, WEBHOOK)
- ✅ Visual flow editor (React Flow)

**Missing — ordered by importance**:
1. **AI Workflow nodes** to complete blueprint §6.4 — `AI_CLASSIFY_INTENT`, `AI_SUMMARIZE`, `AI_EXTRACT_DATA`, `AI_TRANSLATE`, `AI_RECOMMEND`, `AI_CHURN_PREDICT`, `AI_COMPLIANCE_CHECK`, `AI_ROUTE_BEST_AGENT`
2. **AI Knowledge Base** — `KnowledgeBase` model + content sources (FAQs, services, products, policies, hours, locations); RAG / vector index
3. **AI Agent Builder** (§6.5) — `AiAgent` model with name, role, tone, knowledge ref, allowed actions, escalation, business hours, language, memory, fallback; visual config UI; runtime that hooks into the flow engine
4. **SuperAdmin AI** (§6.1) — Platform Monitor, Compliance Auditor, Support Copilot, Revenue Intelligence
5. **Partner AI** (§6.2) — Partner Assistant, Demo Builder, Sales Proposal Generator
6. **Template AI** (§10) — generator, approval predictor, rejection-reason explainer

---

## Phase 6 — Enterprise Scale (blueprint §14 Phase 6)

**Status: 🟡 early — analytics + webhooks shipped; routing + omnichannel + marketplace not started**

- ✅ Platform health endpoint
- ✅ Outbound webhooks with HMAC + retries
- ✅ Analytics summary endpoint
- ✅ API-key model
- ✅ `/api/v1/api-keys` management API + `/developer` API keys UI
- ✅ `ApiRequestLog`, API-key authentication middleware, and `/api/public/v1/status` sandbox endpoint

**Missing — ordered by importance**:
1. **Provider routing** — same as Phase 2 item #2; allows BSP failover per tenant
2. **Advanced analytics** — revenue attribution per campaign / agent / flow, scheduled PDF exports
3. **Omnichannel expansion** — beyond WhatsApp; SMS via Twilio, web chat, future Instagram DM
4. **Developer/API Portal polish** — SDK/docs, richer sandbox testing, usage metering
5. **Marketplace** — third-party flow templates / AI agents / canned replies
6. **CI/CD hardening** — load tests, blue/green deploys, leader election for workers (ADR-010)

---

## Wallet / Credit Ledger (blueprint §3.5 + §9)

**Status: 🟡 ledger + first deduction hooks shipped; lifecycle automation pending**

This is cross-cutting — listed separately because it touches every phase.

- ✅ `Wallet` + `Transaction` schema
- ✅ `wallet.service.ts` for credit/debit/transfer (append-only ledger per ADR-008)
- ✅ `/wallets` admin page
- ✅ WhatsApp send debits wired into 7 outbound paths
- ✅ AI call debits wired into shared `callLlmJson()` with `AiUsage` idempotency
- ✅ Global + per-feature AI credit pricing via env vars

**Missing — ordered by importance**:
1. **Low-balance alerts** + auto-suspend on quota = 0 + auto-recharge config
2. **Postpaid credit line** with billing cycle + auto-invoice
3. **Daily reconciliation worker** — recompute `balance` from ledger sum, alert on drift
4. **Compensating credits** for accepted sends that later hard-fail at the provider

---

## Compliance Infrastructure (blueprint §13)

**Status: 🟡 opt-out + throttle done; risk scoring + suspension workflows missing**

- ✅ Opt-in / opt-out tracking + re-opt-in UI with consent warning
- ✅ STOP keyword handling
- ✅ Rate limit + send throttle
- ✅ Audit logs on mutations

**Missing**:
1. Template rejection-rate monitor
2. Spam-complaint monitor (depends on Meta inbound webhook surface)
3. Suspicious bulk-send detection
4. Phone-number quality-rating alerts (data is collected; alerting not wired)
5. Suspension workflows (warn → throttle → block → suspend) with SuperAdmin alerts

---

## What is intentionally NOT on the roadmap

Per blueprint §14, the following are **deferred**:

- **Mobile native app** — not in V3 priorities
- **Google Ads integration** — not in V3 priorities
- **AI image generation** — not in V3 priorities
- **Shopify deep sync** — not in V3 priorities
- **Voice AI / IVR** — not in V3 priorities

These remain valid future work but are explicitly out of the current six phases.

---

## How a phase becomes "done"

A phase is done when:
1. All items in this file are ✅.
2. `docs/BLUEPRINT_PHASE_AUDIT.md` agrees.
3. Tests cover the critical paths.
4. `docs/DECISIONS.md` has ADRs for every non-obvious choice made along the way.
5. Claude has reviewed the final state and signed off in the audit doc.
