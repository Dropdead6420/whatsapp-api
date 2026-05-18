# SECURITY.md

NexaFlow handles WhatsApp messaging, customer PII, partner financials, and
credentials for Meta Cloud API. This document is the threat model and the
enforcement story. Update it the same PR you change behaviour.

---

## Threat model (top items)

| Threat | Surface | Primary mitigation |
|---|---|---|
| **Cross-tenant data leak** | Any Prisma query without `tenantId` | Row-level scoping by JWT-derived `tenantId`; review checklist; tests |
| **Privilege escalation by role tampering** | Trusting role/`tenantId` from request body | Always source from JWT (`req.userId`, `req.userRole`, `req.tenantId`) |
| **WABA token theft** | `Tenant.wabaAccessToken` in plain text in DB | Encrypt at rest (planned); secrets never in logs or audit JSON |
| **Refresh-token replay** | Stolen refresh JWT | Per-token `jti` in Redis; logout blacklists; rotation on refresh |
| **Unsigned outbound webhook** | Tenant's external server can't verify origin | HMAC-SHA256 with per-subscription secret, header `X-NexaFlow-Signature` |
| **Spoofed Meta webhook** | Anyone hitting `/webhooks/whatsapp` | `WHATSAPP_WEBHOOK_TOKEN` verification on subscription handshake; future: signature header |
| **Quota / wallet bypass** | Direct send call paths skipping the throttle gate | All send paths route through `assertCanSend` → adapter → `recordSend`; reviewed PR-by-PR |
| **Hostile flow** | Tenant configures WEBHOOK node to scan internal network | 15s timeout; future: deny RFC1918 + cloud-metadata IPs; rate-limit per tenant |
| **Brute force on login** | Public `/auth/login` | Global rate limit; future: per-IP login throttle + Argon2/bcrypt cost tuning |
| **Custom-domain takeover** | Tenant uploads a domain they don't own | DNS verification (CNAME + TXT) is gating; domain not served until `LIVE` |
| **Opt-out violation** | Code path that sends without checking `Contact.optedOut` | Check in `sendWhatsAppText`/`sendWhatsAppTemplate`; STOP keyword handler closes the loop |
| **AI prompt injection** | User-supplied text in templates / conversations | Validate LLM output with Zod; never let LLM output execute code or escape its tool surface |

---

## Multi-tenant isolation (the most important rule)

**Every** Prisma query against these tables must scope by `tenantId`:

> Contact, Conversation, Message, Lead, Campaign, WhatsAppTemplate, ChatbotFlow,
> FlowRun, Appointment, Service, CannedReply, ConversationNote, Webhook,
> WebhookLog, AiUsage, AuditLog, ApiKey, Subscription, Invoice, Domain,
> Wallet, Transaction.

The middleware chain enforces this at the boundary:
`requireAuth → requireTenantScope → requirePermission → requireFeature → handler`.

`requireTenantScope` rejects any authenticated request without `req.tenantId`.
The only legitimate way to skip it is `requireRole(UserRole.SUPER_ADMIN)` for
platform-wide operations (admin routes).

### Things that have caused leaks (or could):

- Sub-resources (`/conversations/:id/notes`): we scope by both **the parent id**
  AND `tenantId`. Don't trust the parent id alone.
- Public endpoints (`/public/booking/:tenantId`): the tenant id in the URL is the
  intended one; the data returned is only what's safe for public booking (active
  services, basic tenant brand). Authentication-bypass is the *feature*; data
  exposure must be deliberate.
- SuperAdmin routes that cross tenants must always log to `AuditLog` so we can
  trace who looked at what.

---

## RBAC and permissions

Five roles in escalation order: `AGENT < TEAM_LEAD < BUSINESS_ADMIN < WHITE_LABEL_ADMIN < SUPER_ADMIN`.

Permissions live in `RolePermissions` in `packages/shared/src/index.ts`. Routes
guard via `requirePermission(Permissions.X)`. Adding a new permission means
adding it there and granting it explicitly per role — never default-allow.

When the Partner Portal ships, partner staff get their own role split
(Partner Owner / Admin / Staff) per blueprint §12. Until then, partners use
`WHITE_LABEL_ADMIN`.

---

## Secrets

- **Never** commit `.env` or any file containing real tokens.
- `.env.example` carries safe placeholders; new env vars go here in the same PR.
- WABA tokens, Anthropic keys, payment-provider keys, webhook signing secrets, and JWT secrets are loaded from env at boot.
- Logs **must not** include tokens. The audit JSON column captures `oldValues` / `newValues`; redact secrets at the call site.
- Future: secrets manager (AWS / Doppler / 1Password) + envelope-encrypted columns for `wabaAccessToken`.

---

## Authentication invariants

- Passwords are bcrypt-hashed with cost 12. We will not store them in any other form.
- Reset / verify tokens are random 32-byte URL-safe strings; only their SHA-256 is stored.
- Token TTLs: access 15min, refresh 7d, email-verify 24h, password-reset 30min.
- Account-takeover attempts that fail password check **log to `AuditLog`** with the IP + UA. The brute-force throttle is the global rate-limiter today (300/15min/IP). Per-account lockout is on the roadmap.

---

## Webhook security

### Inbound (Meta → us)
- Verification handshake honors `WHATSAPP_WEBHOOK_TOKEN`.
- Production: also verify the X-Hub-Signature-256 header (not yet wired — see TASKS).
- Handlers respond 200 immediately, then process async. We MUST be idempotent on the provider message id; today we accept duplicate inserts because there's no unique index on `Message.metaMessageId` — add one when we wire signature verification.

### Outbound (us → tenant's URL)
- Every payload is HMAC-SHA256-signed with the per-subscription secret. Header `X-NexaFlow-Signature: sha256=<hex>`.
- 8-second timeout per delivery attempt.
- Failed deliveries persist to `WebhookLog`; exponential backoff `1m → 5m → 30m → 2h`; gives up after `webhook.retryAttempts` (default 4).
- The retrying worker honors `webhook.isActive` — pausing a subscription stops retries.

---

## WhatsApp / Meta compliance

- Outbound sends respect `Contact.optedOut`. A missed check is a P0 compliance bug.
- `STOP`, `UNSUBSCRIBE`, `CANCEL`, `STOP ALL` (exact, case-insensitive, trimmed) flip `optedOut=true` + stamp `optedOutAt` + deactivate the conversation.
- The send throttle enforces tier-aware per-second smoothing + monthly quota; this protects Meta quality rating.
- Templates submitted to Meta stay in `DRAFT` until the provider returns `APPROVED`. Broadcasts on non-approved templates must be refused at dispatch time (currently only enforced at UI; harden at the worker — see TASKS).
- 24-hour customer-service window: outbound sends outside the window require an approved template (provider already enforces; our worker should refuse early to avoid waste).

---

## Domain takeover prevention

- Custom domains carry CNAME + TXT records. Verification calls real DNS resolvers.
- `Domain.status` machine: a domain is **never** served to traffic unless `LIVE`.
- TXT token is single-use and tied to the tenant; rotating the token invalidates prior verifications.
- The edge proxy must consult `Domain` (or a cached lookup) before serving. Until that's wired, custom domains route to the default app and the brand is fetched server-side by tenant id.

---

## AI safety

- LLM output is **never** executed. We validate against a Zod schema, then use the parsed values.
- Anthropic key absence degrades gracefully — features return clear 400s instead of crashing.
- Per-tenant `aiCreditsPerMonth` will be enforced via the wallet ledger (planned). Until then, `AiUsage` records cost in cents; SuperAdmin sees it.
- AI Agent flows (planned) are bounded by an `allowedActions` list. The agent cannot perform actions outside that list even if the LLM asks for them.

---

## Wallet integrity

- Append-only `Transaction` ledger; `Wallet.balance` is the cached sum.
- All credit changes are wrapped in `prisma.$transaction` with both the wallet update and the ledger insert in the same tx.
- Reversals are **new** ledger entries with the opposite sign and a `relatedTransactionId` pointer.
- Daily reconciliation job recomputes `balance` from ledger sum and alerts on drift > 1 paisa.

---

## Audit logging

The following actions **must** call `logAudit(...)`:

- Auth: login, login_failed, signup, logout, password_reset_request, password_reset_complete, email_verified, impersonate
- Tenants: create, update, suspend, reactivate, delete, branding change
- Permissions / feature flags: any change
- Wallet: every credit / debit / transfer / reversal (in addition to the Transaction row)
- Domains: create, verify, suspend, delete
- Partners (planned): create, suspend, commission change
- WhatsApp settings: WABA token change, display-name change, provider change

Audit captures `userId`, `tenantId`, `ipAddress`, `userAgent`, `action`,
`resource`, `resourceId`, JSON `oldValues` and `newValues`. **Redact secrets**
at the call site — the audit blob is queryable by SuperAdmin and partner staff.

---

## Incident response (short)

1. Suspect a tenant compromise → SuperAdmin sets `Tenant.status = SUSPENDED`. This stops sends (the throttle still passes; the route layer doesn't check status today — **fix this**, see TASKS).
2. Suspect a token leak → rotate `JWT_SECRET`. All sessions invalidate.
3. Suspect a webhook compromise → suspend the subscription in `/webhooks`. Retries stop.
4. Always file an `AuditLog` entry with `action: "INCIDENT"` describing what was done.

---

## What is NOT done yet (security debt)

- **2FA**: schema exists (`User.twoFactorSecret`), flow not wired.
- **OAuth providers**: `OAuthAccount` exists, providers not wired.
- **Per-account login throttle**: only global IP-level limiter today.
- **WABA token encryption at rest**: stored plaintext in DB column.
- **Meta webhook signature verification (`X-Hub-Signature-256`)**: only the GET handshake is verified.
- **Idempotency keys on `Message.metaMessageId`**: no unique index; duplicates possible on Meta replay.
- **Tenant suspension at the route layer**: `Tenant.status` is checked at login but not at every request.
- **Flow WEBHOOK node SSRF protection**: 15s timeout exists; no blocklist for RFC1918 / metadata IPs.
- **Rate limiting per account + per tenant** on AI endpoints.

Each of these is tracked in `TASKS.md`.
