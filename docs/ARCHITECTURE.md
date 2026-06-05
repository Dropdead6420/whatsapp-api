# ARCHITECTURE.md

Living document. Update with the same PR that changes any of these shapes.

---

## One-line summary

NexaFlow AI is a multi-tenant SaaS on **PostgreSQL + Express + Next.js**, with **Redis** for caching, queues, throttling, and rate limiting, and **Anthropic Claude** for AI. Every request is tenant-scoped via a JWT-derived `tenantId`. Background workers handle scheduled campaigns, appointment reminders, flow execution, SLA monitoring, webhook delivery, and lead follow-ups.

---

## System diagram (text)

```
                     ┌───────────────────────────────┐
   Customer browser  │   Next.js 14 (App Router)     │
        ─────────►   │   apps/web                    │
                     │   (SSR + client; React Flow)  │
                     └───────────┬───────────────────┘
                                 │ HTTPS + Bearer JWT
                                 ▼
                     ┌───────────────────────────────┐
                     │   Express API @ :3001         │
                     │   apps/api                    │
                     │   middlewares: auth →         │
                     │     tenantScope → RBAC →      │
                     │     feature flag → handler    │
                     └─┬───────────┬──────────┬──────┘
                       │           │          │
            Prisma ────┘           │          └──── Anthropic
            (Postgres)             │               (Claude API)
                                   │
                                Redis
                       (refresh JTI / blacklist,
                        send-throttle counters,
                        round-robin cursor,
                        rate limiter, cache)

   Background workers (started from apps/api/src/index.ts on listen):
     - campaign.service           — scans SCHEDULED, dispatches
     - appointment.service        — sends confirmations + 24h reminders
     - flow/engine                — resumes WAITING runs at resumeAt
     - sla.service                — stamps slaBreachedAt
     - webhook.service            — retries failed outbound deliveries
     - leadFollowUp.service       — dispatches lead follow-up messages

   Inbound from Meta:
     POST /webhooks/whatsapp → 200 immediately → enqueue async work
       → upsert contact, conversation, message
       → auto-assign agent (round-robin via Redis INCR)
       → opt-out keyword check
       → match keyword flow (start FlowRun)
       → auto-score on first inbound (Claude)
       → emit MESSAGE_RECEIVED outbound webhook
```

---

## Layers

| Layer | Responsibility | Key files |
|---|---|---|
| **Communication** | WhatsApp send/receive, templates, opt-out, throttle | `services/whatsapp.service.ts`, `routes/whatsapp.routes.ts`, `services/sendThrottle.service.ts` |
| **Automation** | Workflow runtime, node registry, scheduler | `services/flow/*`, `routes/flows.routes.ts` |
| **AI Intelligence** | Copy, segmentation, scoring, reply suggest, sentiment, autopilot | `services/ai.service.ts`, `services/segment.service.ts`, `routes/ai.routes.ts` |
| **Business Operating** | CRM, leads, appointments, campaigns, analytics | `routes/{contacts,leads,appointments,campaigns,analytics}.routes.ts` |
| **Partner / White-label** | Tenant hierarchy, branding, domains, wallets *(in progress)* | `routes/{tenants,domains,wallets}.routes.ts`, `services/{domain,wallet}.service.ts` |
| **SuperAdmin** | Platform health, billing, feature flags, audit | `routes/admin.routes.ts`, `services/features.service.ts` |

---

## Multi-tenancy

**Rule**: every tenant-scoped table has a `tenantId` column with an index.
**Every query** that touches one of those tables must include `where: { tenantId: req.tenantId }`.

`tenantId` is **derived from the JWT** in `middleware/auth.ts`. The request body
or query string never sets it. The `requireTenantScope` middleware blocks any
authenticated request that doesn't carry a tenant.

For SuperAdmin operations that intentionally span tenants
(e.g. `/api/v1/admin/tenants`), `requireRole(UserRole.SUPER_ADMIN)` is the
explicit gate. There is no other way to escape tenant scoping.

Tenant hierarchy: `Tenant.parentTenantId` points to the white-label parent (if any).
Future Partner Portal work will use this same column.

---

## Auth

- **Email + password** with bcrypt (cost 12).
- **JWT access tokens** (15-minute TTL, HS256).
- **JWT refresh tokens** (7-day TTL) with `jti` stored in Redis. Logout blacklists the `jti`. Refresh rotates the `jti`.
- **Email verification** via SHA-256-hashed token (24h TTL).
- **Password reset** via SHA-256-hashed token (30min TTL).
- **OAuth + 2FA**: out of scope for the current phase. Schema columns exist; flows are not wired.

---

## RBAC

Five roles, escalating: `AGENT < TEAM_LEAD < BUSINESS_ADMIN < WHITE_LABEL_ADMIN < SUPER_ADMIN`.

Permissions are not direct role checks; they go through `requirePermission(...)`
against the `RolePermissions` map in `packages/shared/src/index.ts`. This keeps
permission grants visible in one file rather than scattered across routes.

Tenant feature flags layer on top of permissions. The order is:
`requireAuth → requireTenantScope → requirePermission → requireFeature → handler`.

---

## Provider abstraction (planned)

Today, `services/whatsapp.service.ts` calls Meta Cloud API directly.

The blueprint requires a `WhatsAppProvider` interface so we can also route
through Gupshup / 360dialog / Haptik / Twilio. The interface (per
`DECISIONS.md` ADR-007) will be:

```ts
interface WhatsAppProvider {
  sendText(args): Promise<{ providerMessageId: string }>;
  sendTemplate(args): Promise<{ providerMessageId: string }>;
  createTemplate(args): Promise<{ providerTemplateId: string }>;
  getTemplateStatus(id): Promise<TemplateStatus>;
  updateBusinessProfile(args): Promise<void>;
  updateDisplayName(args): Promise<void>;
  getQualityRating(phoneNumberId): Promise<QualityStatus>;
  getMessagingLimit(phoneNumberId): Promise<MessagingLimit>;
  configureWebhook(args): Promise<void>;
}
```

A `ProviderRoute` table maps tenant → provider. The factory in
`services/whatsapp/index.ts` returns the right adapter. **No call site outside
that factory** should know which provider is in use.

---

## Background workers

All workers start from `apps/api/src/index.ts` after `app.listen`. Each guards
against missing infra (DB / Redis) and degrades to a no-op rather than crashing.

| Worker | Interval | Job |
|---|---|---|
| Campaign | 30s | Dispatch `SCHEDULED` campaigns whose `scheduledFor <= now`. Halts campaign on quota; pauses if no sends succeed. |
| Appointment | 5m | Send confirmation for new `CONFIRMED` appts; send reminders 22–26h before `scheduledAt`. |
| Flow | 30s | Resume `WAITING` runs whose `resumeAt <= now`. |
| SLA | 60s | Stamp `slaBreachedAt` on conversations whose `lastInboundAt + tenant.slaMinutes <= now` and have no later outbound. |
| Webhook retry | 60s | Retry `WebhookLog` rows whose `nextRetryAt <= now`. Exponential backoff 1m → 5m → 30m → 2h. |
| Lead follow-up | 5m | Dispatch lead follow-ups whose `followUpDueAt <= now`. |

A single-instance assumption is acceptable for the current phase. When we
move to >1 API instance, workers move to a separate worker process with leader
election (see `docs/10M_SCALE_ARCHITECTURE.md`).

---

## Data model — core relationships

```
Tenant ── 1:N ── User
       ── 1:N ── Contact ── 1:N ── Conversation ── 1:N ── Message
                         ── 1:N ── Lead
                         ── 1:N ── Appointment ── N:1 ── Service
       ── 1:N ── Campaign ── N:1 ── WhatsAppTemplate
       ── 1:N ── ChatbotFlow ── 1:N ── FlowRun
       ── 1:N ── Webhook ── 1:N ── WebhookLog
       ── 1:N ── Domain
       ── 1:N ── CannedReply
       ── 1:N ── AuditLog
       ── 1:N ── AiUsage
       ── 1:N ── Subscription ── N:1 ── Plan
       ── N:1 ── parentTenant (self-relation, for white-label hierarchy)
```

Conventions:
- All FKs `onDelete: Cascade` from `Tenant`. Deleting a tenant nukes its data.
- Soft-delete via status enums (`TenantStatus`, `UserStatus`, `LeadStatus`, etc.). No `deletedAt` columns.
- JSON columns are stringified (`Contact.customFields`, `Campaign.targetContacts`, `ChatbotFlow.nodes`). Validate with Zod on read.

---

## Flow runtime

A flow is a JSON graph (`{nodes, edges}`) executed by `services/flow/engine.ts`.

- **Node registry** (`services/flow/nodes.ts`): each node type is a `NodeHandler` with `run(node, ctx)`. Adding a node type = adding one entry.
- **Execution**: `executeFlowRun(runId)` walks the graph until END or DELAY. 50-node loop guard.
- **State**: every step appends to `FlowRun.trail` (JSON audit). Variables live in `FlowRun.context` (JSON, merged per-step).
- **Suspension**: DELAY/wait nodes set `status=WAITING` + `resumeAt`. The Flow worker re-enters at the stored `currentNodeId`.
- **Trigger sources**: WhatsApp inbound keyword match (`findFlowForInbound`), manual test-run, future event triggers.

Position data for the visual editor lives at `node.config._editor.position`.
The runtime ignores keys prefixed with `_editor`.

---

## Send-throttle

Every WhatsApp send must pass `canSendNow(tenantId)` and follow up with
`recordSend(tenantId)`. This protects Meta quality rating and enforces per-tenant
wallet/rate governance.

- **Per-second cap**: Redis sorted set of recent send timestamps; rejects when the rolling 1-second window exceeds `SEND_PER_SECOND_LIMIT` (default 20).
- **Monthly telemetry**: Redis counter keyed by `send:{tenantId}:month:{YYYY-MM}`. This is reported for operators and can be promoted to an explicit safety cap only when `SEND_MONTHLY_SAFETY_CAP_ENABLED=true`; plan tiers do not impose artificial WhatsApp message limits.
- **Fails open**: if Redis is unavailable, sends proceed (logged warning). Better degraded than blocked at the infra layer.

---

## Webhooks

- **Inbound from Meta** at `/webhooks/whatsapp`. Verified by `WHATSAPP_WEBHOOK_TOKEN`. Responds 200 immediately. All work is async.
- **Outbound to tenant subscribers**: HMAC-SHA256 signed in `X-NexaFlow-Signature`. Per-subscription secret revealed once on create. Failed deliveries persist to `WebhookLog` with exponential backoff.

Events currently emitted: `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `LEAD_CREATED`,
`CONVERSATION_ASSIGNED`, `APPOINTMENT_BOOKED`. Other event types are reserved in the
enum but not yet wired (see `TASKS.md`).

---

## Wallet ledger (in progress)

Per blueprint §3.5 and §9. Status: **schema + service shipping; deduction
hooks not wired into send/AI paths yet**.

Invariants:
- Every credit / debit writes a `Transaction` row.
- `Wallet.balance` is the cached sum of transactions; rebuilders exist.
- Conversation cost is deducted **after** the Meta API accepts the send.
- AI credits are deducted **after** Anthropic returns success.
- Failures write a compensating `Transaction` (positive), never reverse the original.

Three wallet types: SuperAdmin platform wallet, Partner wallet, Customer (tenant) wallet.
Credit transfer flows: SuperAdmin → Partner → Customer. Reversals always go to a new transaction.

---

## Domain connection

Per blueprint §4. Status: **DNS verification shipped; SSL provisioning stubbed.**

Status machine:
`PENDING_DNS → DNS_FOUND → TXT_VERIFIED → SSL_PENDING → SSL_ACTIVE → LIVE`

Failure transitions: `FAILED`, `SUSPENDED`. Domain is never served to traffic
unless `status === LIVE`. The DNS check (`services/domain.service.ts`) uses real
`node:dns/promises` CNAME + TXT lookups. SSL via Cloudflare for SaaS is the next slice.

---

## Frontend architecture

- **Next.js 14 App Router**. Mostly client components (the app is dashboard-heavy).
- **Auth state**: client-only via `tokenStore` in `localStorage` + the `useAuth` hook.
- **Features state**: `/api/v1/auth/me` returns `{user, features}`. The `DashboardShell` hides nav items whose `feature` flag is `false`.
- **Forms**: small inline `useState`. No global form library. Draft fields use `useAutoSave` (debounced `localStorage`).
- **Real-time**: not yet wired. Inbox polls. Socket.io is in deps but unused.

---

## Where to look when a thing breaks

| Symptom | First file to open |
|---|---|
| Login fails | `routes/auth.routes.ts`, `services/auth.service.ts`, `lib/redis.ts` (JTI store) |
| Webhook silent | `apps/api/src/index.ts` (mount), `routes/whatsapp.routes.ts` |
| Message not sent | `services/sendThrottle.service.ts` (gate), `services/whatsapp.service.ts` (Meta call) |
| Flow stuck | `FlowRun.status` in DB. `WAITING` + past `resumeAt` ⇒ worker not ticking. |
| Outbound webhook missing | `services/webhook.service.ts`, `WebhookLog` table |
| Tenant data leaking | search for `findMany({where:` without `tenantId` |
| Feature 403 | `features.service.ts`; `Tenant.featuresEnabled` JSON |
