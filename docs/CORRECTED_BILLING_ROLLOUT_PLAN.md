# Corrected Billing Architecture — Rollout Plan

Source of truth: **NexaFlow_Claude_Final_Corrected_Billing_Architecture.pdf**.

The correction that drives everything below: WhatsApp usage must be billed by a
**rate engine** — deducted on delivered/chargeable usage × message category
(Marketing / Utility / Authentication / Service) × destination market × provider
× partner/customer rate — **not** fixed fake message bundles. AI credits live in a
**separate AI Credit Wallet** and are never mixed with the WhatsApp Usage Wallet.
Provider ownership and credit source are recorded per customer. Terminology is
**Customer**, not Tenant.

This document is the ordered plan to land that architecture. It is kept honest
with the codebase: each item lists the concrete files and its current state.

---

## Status legend

- ✅ **Shipped** — merged on `codex/nexaflow-v2-platform`, Docker build green.
- 🔜 **Next** — unblocked, no collision, ready to build.
- ⛔ **Deferred** — blocked on coordination (see note); do not start blind.

---

## What already exists (foundation)

These landed earlier and are the substrate the plan builds on:

- **Rate engine** — `apps/api/src/services/rateEngine.service.ts`
  - Pure `calculateWhatsAppQuote` (cost breakdown in **micros**, BigInt).
  - `quoteWhatsAppUsage({ persist })` — creates a `QUOTED` `UsageEvent`,
    idempotent on `(tenantId, idempotencyKey)`. **Has zero callers today.**
  - Rate selection: active row for `(countryCode, category, providerKey)` within
    the effective window; country falls back to `DEFAULT`; newest
    `effectiveFrom` wins.
- **Schema** — `packages/db/prisma/schema.prisma`
  - `WhatsAppRateTable`, `PartnerRateRule`, `UsageEvent` (full micros breakdown +
    `partnerMarkup` + `currencyRateMicros`).
- **Multi-wallet** — `WalletType { WHATSAPP_USAGE, AI_CREDIT, PARTNER_CREDIT }`,
  `Wallet` composite key `(tenantId, type)`; `billing.service.ts` `debitMessage`
  (WHATSAPP_USAGE) and `debitAi` (AI_CREDIT) are already wallet-typed.

---

## The five corrected-billing gaps

### 1. ⛔ Wire the rate engine into real sends — **the centerpiece**

Replace the fixed-cost `debitMessage()` debit with a rate-engine quote +
WHATSAPP_USAGE debit on every chargeable send, writing one `UsageEvent` per
event with the full cost breakdown.

- **Why it matters:** until this lands, the rate engine, rate table, partner
  rate rules, partner models, and `UsageEvent` are all inert. This is the single
  highest-value gap.
- **Surface (8 call sites today):** `whatsapp.routes.ts` (×2),
  `conversations.routes.ts` (×2), `campaign.service.ts`, `appointment.service.ts`,
  `aiAgentInbound.service.ts`, `dripSequence.service.ts`, `leadFollowUp.service.ts`,
  `flow/nodes.ts` (×2) — all call `assertCanAffordMessage` + `debitMessage`.
- **Work:** thread `(countryCode, category, providerKey)` through each call site;
  call `quoteWhatsAppUsage({ persist: true })`; debit WHATSAPP_USAGE by
  `walletDebitCredits`; settle the `UsageEvent` on delivery webhook.
- **Why deferred:** `billing.service.ts` + `rateEngine.service.ts` are the
  **concurrent assistant's active lane**. Rewriting `debitMessage` semantics
  across 8 hot-path call sites here would collide. **Coordinate ownership before
  starting** — ideally the same author who owns `rateEngine.service.ts` lands the
  send-path wiring, consuming the control-plane this plan already shipped.

### 2. ✅ SuperAdmin rate-table control (CRUD + UI + audit)

- Backend: `rateAdmin.service.ts` (validate/normalize via the engine's own
  `normalizeCountryCode`/`normalizeCurrency`/`toMicros`; overlap guard so two
  active rows can't shadow each other; `supersedePrevious`) +
  `routes/admin-rates.routes.ts` (`/api/v1/admin/rates`, SUPER_ADMIN, audited,
  BigInt-safe). Commit `f02e148`.
- Frontend: `apps/web/app/rates/page.tsx` — filterable table + add-rate form
  (amounts → micros) + deactivate; nav under Platform · Billing. Commit `8439e86`.

### 3. ✅ Partner Models A / B / C

- `enum PartnerModel { RESELLER, BRING_YOUR_OWN_META, HYBRID }`,
  `ProviderOwnership`, `CreditSource` + `Tenant.partnerModel`,
  `partnerMarginEnabled`, `providerOwnership`, `creditSource`.
- `partnerModel.service.ts` — `assertValidPartnerModelConfig`
  (RESELLER → NexaFlow-owned only; BRING_YOUR_OWN_META → partner-owned only;
  HYBRID → any; partner-funded credit requires `partnerMarginEnabled`) +
  `defaultCustomerConfigFor`.
- Wired into SuperAdmin tenant create/patch (partner fields) and partner
  customer-create (per-customer provider/credit, validated + audited).
  Commit `c4a7682`.

### 4. 🔜 FX / multi-currency conversion control

`UsageEvent.currencyRateMicros` defaults to `1.0` (1_000_000) — there is no FX
source yet. Plan (clean, additive, low-collision):

- **Schema:** `CurrencyRate { baseCurrency, quoteCurrency, rateMicros (BigInt),
  effectiveFrom, effectiveTo?, isActive, source, notes }` + migration.
- **Service:** `currency.service.ts` — pure `convertMicros(amount, rateMicros)`
  + `findActiveRate(base, quote, at)` (same effective-dating + overlap discipline
  as `rateAdmin.service`). Export pure helpers for tests.
- **Admin:** `/api/v1/admin/currency-rates` CRUD (SUPER_ADMIN, audited) + a
  `/currency-rates` page mirroring `/rates`.
- **Hook (coordinate with gap 1):** resolve `currencyRateMicros` from the active
  `CurrencyRate` for `rate.currency → wallet.currency` inside `quoteWhatsAppUsage`.
  The model/service/admin are independent and can land first; the engine hook
  lands with gap 1.

### 5. ✅ This document — the full ordered plan.

---

## Recommended execution order

1. **Gap 4 model + service + admin CRUD + UI** (independent of gap 1; ship now).
2. **Gap 1**, owned by the rate-engine author: wire `quoteWhatsAppUsage` into the
   8 send sites, debit WHATSAPP_USAGE, settle `UsageEvent` on the delivery
   webhook, and resolve `currencyRateMicros` from gap 4. This flips the whole
   architecture from inert to live.
3. **Reconciliation pass:** usage analytics over real `UsageEvent` rows; verify
   AI debits never touch WHATSAPP_USAGE; partner markup lands in
   `partnerMarkupMicros`.

## Guardrails carried throughout

- Costs in **micros** (BigInt); serialize to strings at the API edge.
- Idempotency: `UsageEvent (tenantId, idempotencyKey)` + `WalletTransaction
  (walletId, referenceType, referenceId)`.
- Effective-dating + overlap guard so the engine never sees ambiguous active rows.
- Every SuperAdmin mutation audited.
- AI Credit Wallet and WhatsApp Usage Wallet stay strictly separate.
