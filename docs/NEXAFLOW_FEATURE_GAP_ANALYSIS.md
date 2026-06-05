# NexaFlow AI — Feature Gap Analysis & Build Roadmap

Source of truth: **NexaFlow_CLAUDE_Complete_Feature_Planning_Final.pdf** (the "Complete
Planning Document"). This file audits the entire scope in that PDF against what is
actually implemented in this repo (as of the audit date) and lays out the build order
for the genuine gaps.

## Non-negotiable architecture rules (PDF §5)

These apply to every new module below. Treat as a checklist on each slice:

1. **No artificial WhatsApp message limits in plans.** Meta governs messaging
   quality/limits; NexaFlow monetises via usage margin + AI-credit margin.
2. **WhatsApp Usage Wallet and AI Credit Wallet stay separate.** (Done — `WalletType`.)
3. **A disabled product is hidden in the UI _and_ blocked in the API.**
4. **All stored API keys / provider credentials must be encrypted at rest.**
5. **Every customer-owned query is `customerId`-scoped** (here: `tenantId`).
6. **Every partner-owned query is `partnerId`-scoped** (here: parent tenant).
7. **Every sensitive action writes an audit log.**
8. **SuperAdmin controls** product access, rate engine, AI providers, secrets,
   payment gateways and partner permissions.

> Terminology note from the PDF: prefer **Customer** over **Tenant** in user-facing
> copy. The data model keeps `Tenant`/`tenantId` internally; UI strings say "Customer".

## Scope audit (PDF §2) — 28 items

Legend: ✅ done · 🟡 partial · ❌ missing

| # | Scope item | Status | Evidence / gap |
|---|-----------|--------|----------------|
| 1 | SuperAdmin / Partner / Customer / Agent / White-Label portals | ✅ | `UserRole`, `/tenants`, `/partner/*`, `/dashboard/*`, `/agent/*` |
| 2 | Product Marketplace, module enable/disable per partner/customer | 🟡 | `features.service.ts` (`featuresEnabled` JSON + SuperAdmin toggle), `/partner/products`, `/services`. Gap: no unified catalog + consistent API-block middleware across **all** products. |
| 3 | SuperAdmin editable pricing (plans, add-ons, WA rates, margins, AI credits, GMB/website/ads/calling) | 🟡 | Plans/rates/margins/AI credits done (`pricing`, `/rates`, `planCatalog`). Add-on pricing for GMB/website/ads/calling pends those modules. |
| 4 | Partner models: Reseller / BYO-Meta / Hybrid | ✅ | `PartnerModel`, `partnerModel.service.ts` |
| 5 | Customer self-recharge wallet | ✅ | `customer-wallets.routes.ts`, `/wallets`, Razorpay+Stripe |
| 6 | WA Usage Wallet + AI Credit Wallet separated | ✅ | `WalletType`, `billing.walletTypes.test.ts` |
| 7 | Correct WhatsApp rate engine (category+country+provider+currency+markup+tax) | ✅ | `rateEngine.service.ts`, `WhatsAppRateTable`, `PartnerRateRule` |
| 8 | Free-Forever, no artificial message limits | ✅ | Rule honored; monetised via usage/AI margin |
| 9 | **API Secret Vault** (Meta/AI/payment/SMTP/partner/customer keys, encrypted) | ❌ | No secret/credential model or crypto service. `apiKey.service.ts` is *outbound* public-API keys only. **GAP — Phase 3.** |
| 10 | **AI Provider Hub** (OpenAI/Claude/Gemini/DeepSeek/Grok/custom + image/video/voice + fallback + cost manager) | 🟡/❌ | `ai.service.ts` single-provider; `AiUsage` tracks cost; `AiAgentFallback` enum exists. No provider catalog/registry, no multi-provider routing/cost-manager. **GAP — Phase 4.** |
| 11 | Meta/WABA (Continue-with-Meta, BM, WABA, number, migration, webhooks, quality, limit display) | ✅ | `metaSignup`, `whatsappConfig`, `number-migrations`, `wabaTokenExpiry`, `/whatsapp-settings` |
| 12 | CRM + CDP unified profile (WA, Meta Ads, Google Ads, website, landing, GMB, call, appointment, e-comm) | 🟡 | `Contact`/`Lead`, `appointments`, Meta/Google Ads connections. Unified CDP timeline + website/GMB/call/e-comm sources partial. |
| 13 | Inbox (assigned, team, AI replies, translation, summary, notes, SLA, handoff) | ✅ | `conversations` AI helpers, `sla.service.ts`, `ConversationNote`, `agentRouter` |
| 14 | Campaigns (broadcast, schedule, drip, template, segments, cost, compliance, analytics) | ✅ | `campaigns`, `drip-sequences`, `segment.service.ts`, `compliance` |
| 15 | Templates (create, translate, approval, rejection, AI gen, approval predictor) | ✅ | `templates`, `ai.templates.test.ts` |
| 16 | **Landing Page Builder + AI Single-Page Website Builder** | ❌ | No model/route/page. **GAP — Phase 10.** |
| 17 | No-code Chatbot Builder | ✅ | `ChatbotFlow`, `/dashboard/chatbot-builder`, flow editor |
| 18 | Workflow Builder | ✅ | `flows`, `EnhancedFlowEditor`, `FlowNodeType` |
| 19 | **GMB AI Manager** (posts, captions, images, review replies, scheduling, reports, local SEO) | ❌ | None. **GAP — Phase 11.** |
| 20 | Ads Automation (Meta, Google, TikTok-later, lead sync, CPL, AI copy, audience/budget) | 🟡 | `meta-ads`/`google-ads` connections + audiences + lead forms. AI copy / budget suggestions partial. |
| 21 | **Calling + Virtual Number** (web/app call, number provider, logs, AI summary, transcription, AI caller) | ❌ | None (existing "provider routing" is WA send-routing). **GAP — Phase 11.** |
| 22 | Integrations (Shopify, Woo, Sheets, Calendar, Razorpay, Stripe, PayPal, PayU, Zapier, Make, n8n, custom) | 🟡/❌ | Razorpay+Stripe done; `/dashboard/integrations` is a 12-line stub. Rest missing. **GAP — Phase 11.** |
| 23 | Developer Hub (API keys, webhooks, sandbox, logs, OpenAPI, SDK, rate limits) | ✅ | `/developer`, `api-keys`, `webhooks`, `openApi.service.ts`, `public-api` |
| 24 | Multi-currency (INR/USD/CAD/AED/GBP/EUR/AUD/SGD + FX snapshots) | ✅ | `Currency`, `CurrencyRate`, `currency.service.ts` |
| 25 | Multi-language (13 langs + RTL) | 🟡 | i18n foundation + 15 pages localized; backend (Codex) + remaining pages ongoing |
| 26 | Support tickets, KB, FAQ manager, AI resolver, escalation | 🟡 | `SupportTicket`, `knowledgeBase`, `aiSupportResolver`. Dedicated FAQ manager partial (KB covers most). |
| 27 | Analytics (revenue, profit, AI cost, usage, campaigns, inbox, CRM, GMB, ads, landing, partner, customer) | 🟡 | `analytics` + export/PDF/schedule. GMB/landing analytics pend those modules. |
| 28 | Security (RBAC, 2FA, encrypted secrets, idempotency, webhook sig, audit, rate limits, isolation) | 🟡 | RBAC/audit/webhook-sig/idempotency/rate-limits ✅. **2FA ❌**, encrypted secrets ❌ (→ Phase 3 vault). |

## Genuine gaps → build order

Following the PDF's own Planning Order (§3). Each module ships in small slices
(schema → service → routes → tests → UI), every slice committed + pushed, GHCR build
treated as part of the deliverable. Backend & schema slices coordinate with the
concurrent Codex assistant (fetch + scoped `git add`).

1. **API Secret Vault** (Phase 3) — *foundational, unblocks #2.* Encrypted at-rest
   provider credentials (AES-256-GCM), scoped PLATFORM/PARTNER/CUSTOMER, masked reads,
   test-connection, rotation, audit. Rule #4.
2. **AI Provider Hub** (Phase 4) — provider catalog + per-scope selection, fallback
   chain, cost manager on top of `AiUsage`. Consumes vault keys from #1.
3. **2FA** (Phase 13 security, pulled early — small + high-value) — TOTP enrol/verify,
   recovery codes, enforced at login.
4. **Product Marketplace hardening** (Phase 2) — unified product catalog + one
   `requireProduct()` API guard + consistent UI hiding. Closes rule #3.
5. **Landing Page + AI Website Builder** (Phase 10).
6. **GMB AI Manager** (Phase 11).
7. **Calling + Virtual Number** (Phase 11).
8. **Integrations expansion** (Phase 11) — Shopify/Woo/Sheets/Calendar/PayPal/PayU/
   Zapier/Make/n8n/custom connector + real `/integrations` UI.
9. **CDP unification + GMB/landing analytics + FAQ manager** (Phases 9/12 polish).

## Status

- [ ] 1. API Secret Vault
- [ ] 2. AI Provider Hub
- [ ] 3. 2FA
- [ ] 4. Product Marketplace hardening
- [ ] 5. Landing/Website Builder
- [ ] 6. GMB AI Manager
- [ ] 7. Calling + Virtual Number
- [ ] 8. Integrations expansion
- [ ] 9. CDP / analytics / FAQ polish
