# CODEX.md

Codex's operating contract for the NexaFlow AI repo. Companion to [`CLAUDE.md`](CLAUDE.md).

`AGENTS.md` remains the long-form Codex project briefing. This file is the **short rules of engagement**.

---

## Role

Codex is the **implementer**: it builds features, writes tests, and ships PRs.

- Claude designs; Codex implements.
- Codex stays inside the plan in `TASKS.md`. If a task is missing, Codex asks Claude to plan it first.
- Codex never changes core architecture (provider abstraction, multi-tenant scoping, wallet ledger shape, AI safety) without a matching update to `docs/DECISIONS.md`.

---

## What Codex must do on every PR

1. **Read the active task** in `TASKS.md`.
2. **Stay tenant-safe**: every Prisma query that touches tenant data scopes by `tenantId` (or `partnerId`). Never trust `tenantId` from the request body or query string — pull it from `req.tenantId` (JWT).
3. **Audit log every mutation** that affects status, money, permissions, or compliance — use `logAudit(...)`.
4. **Gate AI features** behind `requireFeature(...)` and degrade gracefully when `ANTHROPIC_API_KEY` is the placeholder.
5. **Validate LLM output** with Zod before persisting or acting on it.
6. **Wallet changes are ledger-based**: every credit/debit writes a `Transaction` row. Never overwrite balances.
7. **Webhook handlers** (inbound + outbound) verify signatures, are idempotent on provider message id, and queue heavy work.
8. **Respect opt-out** on every WhatsApp send. Send only after `assertCanSend()`, record after with `recordSend()`.
9. **Write tests** for critical paths (auth, ledger, throttle, domain verification, AI fallback).
10. **Update docs** in the same PR when behaviour or architecture changes.

---

## What Codex must NOT do

- Bypass `requireAuth`, `requireTenantScope`, `requirePermission`, or `requireFeature`.
- Commit secrets, `.env`, or test fixtures with real tokens.
- Hard-code provider-specific logic outside the `WhatsAppProvider` abstraction (when it ships).
- Use `prisma.findMany`/`findFirst` without a tenant guard on tenant-scoped tables.
- Ship UI for a module while another agent is mid-implementation on the same one. Coordinate in `TASKS.md`.

---

## Code conventions

- **TypeScript strict**. No `any` unless explicitly justified in a comment.
- **Zod** for every request body / query parser. Errors are forwarded to the global error handler.
- **Error shape**: `ApiError(code, statusCode, message)`. Don't throw raw `Error` from a route.
- **Routes**: file per resource at `apps/api/src/routes/{name}.routes.ts`, exported as default Router.
- **Services**: stateless modules at `apps/api/src/services/{name}.service.ts`. Background workers expose `start{X}Worker()`.
- **Migrations**: schema-driven via `prisma db push` in dev; `prisma migrate` in CI/prod. Never edit generated SQL by hand.
- **Commits**: imperative-mood title under 70 chars. Body explains *why*, not *what* (the diff is the what).

---

## PR checklist

Before requesting review:

- [ ] `npx tsc --noEmit` clean in `apps/api` and `apps/web`.
- [ ] `npx next build` clean in `apps/web` (no new warnings in app pages).
- [ ] `npx prisma validate` clean.
- [ ] One feature per PR. Refactors split out.
- [ ] New env vars added to `.env.example`.
- [ ] Audit log + RBAC guard added where applicable.
- [ ] `TASKS.md` updated (mark in-progress → done, add follow-ups).

---

## Handoffs

When a task is bigger than ~300 lines of net new code or touches >3 modules,
**stop and ping Claude** for a re-plan in `TASKS.md`. Don't keep shipping
half-done work into one PR.
