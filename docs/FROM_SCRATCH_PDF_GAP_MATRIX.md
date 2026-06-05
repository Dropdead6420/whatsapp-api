# NexaFlow From-Scratch PDF Gap Matrix

Source: `NexaFlow_AI_Codex_Final_From_Scratch_Implementation.pdf`

Status date: 2026-06-05

## Architecture Alignment

| PDF area | Repo status | Notes / next action |
| --- | --- | --- |
| Modular monolith + workers | Shipped | Next.js web, Express API, Prisma/Postgres, Redis, Docker, and worker processes are present. |
| Auth, roles, audit logs | Shipped | JWT auth, RBAC, tenant scoping, and audit logging are implemented. OAuth/2FA remain backlog hardening. |
| Customer, partner, SuperAdmin scoping | Shipped | Separate partner/customer/admin portals and tenant filters are present. Continue test coverage for cross-tenant isolation. |
| Product marketplace/module access | Shipped | Product and feature gates exist, including partner/customer UI. |
| API secret vault | Shipped | Provider credentials are backend-owned and kept out of frontend responses. Continue rotation polish. |
| AI provider hub + cost/credit engine | Shipped | Provider routing, model mapping, credits, and AI usage are implemented. |
| Wallet self-recharge + payment ledgers | Shipped | Split WhatsApp/AI wallets, payment orders, webhooks, recharge requests, and admin flows exist. |
| WhatsApp rate engine | Shipped | Partner/customer rates, currency, and wallet debit are implemented. |
| No artificial WhatsApp plan message limits | Shipped in this slice | Plan tiers now advertise wallet/rate/provider governed usage, not monthly WhatsApp message quotas. `messageQuotaPerMonth` remains only as an optional safety cap behind `SEND_MONTHLY_SAFETY_CAP_ENABLED=true`. |
| Meta/WABA credentials + provider adapter | Partially shipped | Credentials, quality monitoring, webhooks, and provider adapter exist. Number migration/embedded signup should be expanded. |
| Customer setup wizard + CRM/campaigns/inbox | Shipped | Setup, contacts, campaigns, templates, inbox, compliance, and automation are present. |
| Landing pages, chatbot/workflow builder | Partially shipped | Marketing/pricing and workflow builder exist. Landing pages/AI website builder need polish and expansion. |
| GMB, image, ads, calling integrations | Backlog | Some integration shells exist; production connectors need phased implementation. |
| Multi-currency/language/RTL | Partially shipped | Currency and language foundations exist. More translations and runtime locale coverage remain. |
| Testing/security/deployment | Partially shipped | Docker/VPS deploy flow exists. Need broader e2e, load, security, and backup automation. Repository migrations are not yet from-scratch clean because the historical initial full-schema migration is missing locally; production/VPS deploys use the existing applied schema history. |

## Current Slice

The from-scratch PDF explicitly says NexaFlow must not sell artificial WhatsApp
message caps in platform plans. Meta controls messaging tiers and quality;
NexaFlow controls product access, wallets, rates, add-ons, AI credits, and
permissions.

This slice aligns the product with that rule by:

- removing plan-message-limit copy from pricing and billing surfaces;
- keeping WhatsApp send smoothing for Meta quality protection;
- making monthly send counts telemetry by default;
- preserving `Tenant.messageQuotaPerMonth` only as an optional operational
  safety cap enabled with `SEND_MONTHLY_SAFETY_CAP_ENABLED=true`;
- updating SuperAdmin/partner defaults so new tenants are not silently capped
  by plan-like message allowances.

## Next Recommended Features

1. Expand Meta embedded signup and WABA number migration UX.
2. Add AI website/landing-page builder templates tied to partner/customer portals.
3. Harden multi-currency and multi-language coverage across billing and support pages.
4. Add full Playwright e2e coverage for SuperAdmin, partner, and customer billing.
5. Add load/security checks for wallet debit, webhook delivery, and campaign workers.
6. Restore or regenerate a clean initial Prisma migration so `prisma migrate deploy`
   can build a brand-new database from zero, matching the PDF's from-scratch
   requirement.
