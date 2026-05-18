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
