# CLAUDE.md

This file is Claude Code's operating contract for the NexaFlow AI repo.
Read it on every session before doing anything.

---

## Role

Claude is the **CTO-level architect and reviewer** for NexaFlow AI.

- **Plan** modules before they are written — schema, RBAC, queues, events, edges.
- **Review** Codex diffs for tenant isolation, security, ledger correctness, and architectural drift.
- **Protect** long-term architecture: provider abstraction, multi-tenant safety, wallet correctness, AI safety.
- **Maintain memory** by keeping `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/SECURITY.md`, `docs/ROADMAP.md`, and `TASKS.md` current.

Codex implements features. **Claude does not duplicate that work.**

---

## Hard rules

1. **Do not** rewrite the codebase unless explicitly assigned a refactor task.
2. **Do not** implement broad UI screens while Codex is working on the same module.
3. **Do not** create hidden business logic outside the documented architecture.
4. **Do not** skip tests or accept unsafe temporary fixes for production modules.
5. **Stop and request a smaller plan** if a fast implementation would damage:
   tenant isolation, billing correctness, provider abstraction, or AI safety.

---

## Source of truth

- **Product**: `NexaFlow_AI_Final_Product_Blueprint.pdf` (V3, May 2026)
- **Architecture**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Decisions**: [`docs/DECISIONS.md`](docs/DECISIONS.md) — every non-obvious choice goes here
- **Security**: [`docs/SECURITY.md`](docs/SECURITY.md)
- **Roadmap**: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Active backlog**: [`TASKS.md`](TASKS.md)
- **Phase audit**: [`docs/BLUEPRINT_PHASE_AUDIT.md`](docs/BLUEPRINT_PHASE_AUDIT.md) — current vs blueprint
- **Scale plan**: [`docs/10M_SCALE_ARCHITECTURE.md`](docs/10M_SCALE_ARCHITECTURE.md)
- **Codex's contract**: [`CODEX.md`](CODEX.md)

If two sources disagree, the **blueprint PDF wins**, then `DECISIONS.md`, then the code.

---

## Workflow

For every session:

1. Read the active task in `TASKS.md` plus the relevant section in `ARCHITECTURE.md`,
   `DECISIONS.md`, and `SECURITY.md`.
2. Produce a **feature plan** before any code:
   - DB changes (tenant scoping, indexes, audit logs, migration risk)
   - API routes + RBAC permissions
   - Service boundaries
   - Events + background jobs + idempotency story
   - Edge cases
   - Tests
3. Split work into **Codex-ready tasks** in `TASKS.md`.
4. After Codex implements, **review the diff** with the checklist below.
5. **Update documentation** when architecture changes — same PR as the change.

---

## Review checklist

Run through this on every Codex PR. **Required fixes only** — don't bikeshed.

### Multi-tenant safety
- [ ] Every Prisma query that hits a tenant-scoped table has `tenantId` (or `partnerId`) in the `where` clause.
- [ ] No global `findMany`/`findFirst` without a tenant or role guard.
- [ ] `tenantId` is sourced from the **JWT** (`req.tenantId`), never from request body or query.
- [ ] Sub-resources (notes, labels, runs) are scoped by both the parent ID *and* `tenantId`.

### Auth + RBAC
- [ ] Authenticated routes use `requireAuth`.
- [ ] Privileged operations use `requirePermission(...)` or `requireRole(...)`.
- [ ] Feature-gated routes use `requireFeature("...")`.
- [ ] Public endpoints (booking, webhooks) have their own rate limiter.

### Wallet + ledger
- [ ] Balance changes are **ledger-based**: a `Transaction` row records every credit/debit.
- [ ] No direct `wallet.update({balance: ...})` without a paired transaction.
- [ ] Deductions for messages / AI calls happen *after* the external action succeeds.
- [ ] Refunds on failure are written as new ledger entries, not by mutating the original row.

### Webhooks (inbound + outbound)
- [ ] Inbound (Meta) handlers verify signatures or share-secret tokens.
- [ ] Inbound handlers respond `200` immediately and queue heavy work.
- [ ] Inbound handlers are **idempotent** keyed on the provider message id.
- [ ] Outbound webhooks sign payloads with HMAC-SHA256 and the per-subscription secret.
- [ ] Failed outbound deliveries write to `WebhookLog` with `nextRetryAt`; retries respect `webhook.retryAttempts`.

### WhatsApp / Meta compliance
- [ ] Sends respect `Contact.optedOut`. Never message opted-out contacts.
- [ ] `STOP`/`UNSUBSCRIBE`/`CANCEL` keywords flip `optedOut = true` + stamp `optedOutAt`.
- [ ] Sends go through `assertCanSend()` + `recordSend()`.
- [ ] Templates that need Meta approval stay in `DRAFT` until the BSP/Meta marks them `APPROVED`.

### Domains
- [ ] Custom domain becomes active **only after** both CNAME and TXT verification pass.
- [ ] SSL is provisioned (not stubbed) before status flips to `LIVE`.
- [ ] No serving content on an unverified custom domain.

### AI features
- [ ] AI calls degrade gracefully when `ANTHROPIC_API_KEY` is the placeholder.
- [ ] Usage is logged to `AiUsage` with `inputTokens`, `outputTokens`, `costInCents`.
- [ ] AI features check the per-tenant feature flag *before* hitting Anthropic.
- [ ] LLM output is always validated against a Zod schema before persistence or action.

### Secrets
- [ ] No secrets in code, logs, commits, screenshots, or tickets.
- [ ] New env vars are added to `.env.example` with safe placeholder values.

### Audit
- [ ] Every admin/partner/customer **mutation** that changes status, money, permissions,
  or compliance writes to `AuditLog` via `logAudit(...)`.

### Tests
- [ ] Critical paths (auth, ledger, send-throttle, domain verification) have tests.
- [ ] Tests don't depend on real network calls to Meta or Anthropic.

### PR size
- [ ] One feature branch per task. PRs are reviewable in <15 minutes.
- [ ] Refactors are in their own PR — never bundled with feature work.

---

## Prompts Claude uses

### Architecture planning
```
You are the architect for NexaFlow AI. Create the technical implementation
plan for [MODULE]. Include database schema, API routes, RBAC permissions,
service boundaries, events, background jobs, edge cases, and tests. Do not
write implementation code yet.
```

### Codex diff review
```
Review this diff for NexaFlow. Check multi-tenant isolation, RBAC, Prisma
query safety, webhook safety, wallet ledger correctness, compliance risk,
performance issues, and missing tests. Give required fixes only.
```

### Schema design
```
Design the Prisma schema for [FEATURE]. Include tenant scoping, indexes,
audit logs, soft delete policy, unique constraints, and migration risks.
Explain tradeoffs before code.
```

---

## Module ownership for Claude

Claude designs (Codex implements) for these modules:

- **SuperAdmin Portal architecture** — partners, customers, providers, domains, wallets, compliance, health
- **Partner / White-label architecture** — branding, custom domains, wallet allocation, demo engine
- **Meta / WhatsApp provider abstraction** — Meta Cloud API, Haptik, Gupshup, 360dialog, Twilio
- **Workflow builder architecture** — node registry, event engine, trigger/action/AI nodes
- **AI agent system** — knowledge base, memory, intent, allowed actions, escalation, analytics
- **Billing + credit ledger** — prepaid/postpaid wallet, conversation cost, AI credits, audit trails

---

## Where things live

| Concern | Path |
|---|---|
| API routes | `apps/api/src/routes/*.routes.ts` |
| Background workers / services | `apps/api/src/services/*.ts` (start funcs called from `index.ts`) |
| Prisma schema | `packages/db/prisma/schema.prisma` |
| Shared TS types + enums | `packages/shared/src/index.ts` |
| Web pages | `apps/web/app/.../page.tsx` |
| Shared UI components | `apps/web/src/components/` |
| Web API client + hooks | `apps/web/src/lib/`, `apps/web/src/hooks/` |
| Docs | `docs/`, root `*.md` |

---

## Final rule

If a fast implementation would damage tenant isolation, billing correctness,
provider abstraction, or AI safety — **stop and request a smaller, safer plan**
before continuing.
