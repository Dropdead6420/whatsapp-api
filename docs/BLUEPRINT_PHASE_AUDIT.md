# NexaFlow AI Blueprint Phase Audit

Source of truth: `/Users/sidharthkumar/Downloads/NexaFlow_Codex_FINAL_Full_Implementation_Blueprint_and_Features.pdf`

Last checked: 2026-05-18

## Summary

The old PRD and the final blueprint are aligned on the core product: multi-tenant WhatsApp SaaS, customer admin portal, inbox, campaigns, contacts, templates, automation, AI, SuperAdmin, partner/white-label support, billing, compliance, and APIs.

They are not identical in priority:

- The final blueprint gives more priority to Partner Portal, White Label Portal, custom domains, wallets/credits, Meta Embedded Signup, provider abstraction, AI agents, and compliance intelligence.
- The old PRD included Android mobile app, ads integrations, full DevOps/Kubernetes, and broad OAuth/2FA work as explicit later phases. These remain valid future work, but they are not front-loaded in the final blueprint.

## Final Blueprint Phase Status

| Phase | Blueprint focus | Current code status | Main gaps |
| --- | --- | --- | --- |
| Phase 1 | Core customer product: auth, dashboard, WhatsApp Cloud API, inbox, contacts, templates, campaigns | Partial / working foundation. Auth, dashboard, contacts, leads, templates, campaigns, inbox, canned replies, SLA, opt-out, and throttle are present. | Production-grade tests, import/export polish, full template submission to Meta, campaign analytics depth |
| Phase 2 | Meta onboarding: Embedded Signup, WABA connection, phone number connection, webhook automation, business profile manager | Partial. Manual WhatsApp settings, WABA/phone/token storage, quality sync, inbound webhook, STOP handler, outbound sends are present. | Meta Embedded Signup, automatic webhook registration, provider token lifecycle, display-name update flow |
| Phase 3 | Partner portal: partner dashboard, customer management, wallet, transactions, team, demo system | Early partial. Tenant hierarchy, white-label admin role, customer tenants, feature flags, and tenant CRUD exist. | Dedicated partner dashboard, wallet/ledger, customer onboarding wizard, demo workspace, commissions |
| Phase 4 | White label portal: custom domains, logo/colors, email branding, module control, preview mode | Partial. Tenant branding fields, feature flags, and custom-domain connection flow are present. | Branding UI, email sender/domain setup, preview mode, SSL provider automation |
| Phase 5 | AI automation: AI workflow builder, AI agents, AI compliance, AI partner assistant, AI onboarding assistant | Partial. AI copy, smart segmenting, reply suggestions, sentiment, lead scoring, autopilot, flow runtime, visual editor, and AI nodes exist. | AI Agent Builder, AI Knowledge Base, compliance auditor, partner assistant, onboarding assistant |
| Phase 6 | Enterprise scale: provider routing, developer/API portal, marketplace, advanced analytics, omnichannel expansion | Early. Platform health, webhooks, API-key model, API-key management UI, analytics summary, and rate throttling exist. | Provider abstraction/BSP routing, API logs/docs/sandbox, marketplace, advanced exports/reports, omnichannel, CI/CD hardening |

## Old PRD To Final Blueprint Mapping

| Old PRD area | Final blueprint equivalent | Status |
| --- | --- | --- |
| Phase 1 Foundation | Phase 1 Core customer product | Mostly implemented: Turborepo, Docker services, Prisma schema, Express API, Next app, shared packages |
| Phase 2 Auth/RBAC | Phase 1 Core + Team & Permission System | Implemented for email/password, JWT refresh, verification, reset, RBAC; OAuth/2FA remain pending |
| Phase 3 SuperAdmin | SuperAdmin Portal | Partial: dashboard, tenants, billing overview, health, audit logs, feature flags; impersonation/support/provider controls pending |
| Phase 4 White Label Admin | Partner + White Label Portal | Partial: tenant hierarchy, white-label admin role, domains; partner dashboard/wallet/demo/branding UI pending |
| Phase 5 Business Admin Core | Customer Admin Portal | Partial: contacts, leads, templates, campaigns, dashboard, appointment services present |
| Phase 6 Chatbot & Automation | Automation Layer + AI Workflow Builder | Strong partial: runtime, worker, visual editor, nodes, audit trail; sandbox and full AI agent builder pending |
| Phase 7 Analytics | Business Operating Layer + Enterprise Analytics | Partial: summary/health and dashboard cards; scheduled reports/PDF exports/revenue attribution pending |
| Phase 8 AI Creative Studio | AI Intelligence Layer | Partial: copy, segments, scoring, reply, sentiment, autopilot; image generation and creative library pending |
| Phase 9 Ads Integration | Not front-loaded in final blueprint | Not implemented; keep as later marketplace/enterprise expansion |
| Phase 10 Agent Portal | Agent Portal | Partial: inbox, assignment, notes, labels, SLA, canned replies, AI reply tools |
| Phase 11 Android Mobile App | Not front-loaded in final blueprint | Not started; keep as post-web scale phase |
| Phase 12 Public API & Webhooks | Webhooks/API Layer | Partial: outbound webhooks, API-key model, and API-key management UI exist; OpenAPI docs, SDK, API logs, and sandbox pending |
| Phase 13 Billing & Payments | Wallet, Transactions & Credit Line System + Billing | Partial: plan/subscription/invoice models and billing UI; Razorpay/Stripe/wallet/credits pending |
| Phase 14 DevOps/Security | Enterprise scale | Partial: Docker Compose; CI/CD, Sentry/APM, backups, Kubernetes pending |
| Phase 15 Testing/Onboarding | Enterprise quality | Early: smoke tests manual; Playwright/E2E and isolation tests pending |
| Phase 16 Launch/GTM | Launch | Not started |

## Recently Added From Final Blueprint

- `Domain` data model for partner/customer/demo/API/tracking domains.
- `/api/v1/domains` API for create/list/update/delete/check.
- DNS record generation with CNAME and TXT ownership verification.
- `/domains` UI for SuperAdmin and White Label Admin.
- Sidebar section: White Label -> Domains.
- `Wallet` and `WalletTransaction` ledger models for partner/customer credits.
- `/api/v1/wallets` API for wallet listing, settings, manual adjustments, transfers, and transaction history.
- `/wallets` UI for SuperAdmin, White Label Admin, and Business Admin credit visibility.
- Wallet billing hooks for successful WhatsApp sends and successful AI calls.
- Per-feature AI credit pricing through env vars such as `AI_CALL_COST_CREDITS_CAMPAIGN_AUTOPILOT`.
- Inbound WhatsApp webhook idempotency and Meta signature verification.
- Codex implementation workflow captured from `/Users/sidharthkumar/Downloads/NexaFlow_Codex_Playbook.pdf` in `CODEX.md`.
- Developer/API Portal first slice: tenant-scoped API key create/list/update/revoke API and `/developer` UI. Secrets are returned only once; only SHA-256 hashes are stored.
- Developer/API Portal second slice: key-authenticated `/api/public/v1/status`, `ApiRequestLog`, last-used tracking, and recent-call viewer.

## Rules For Future Work

1. Build in the final blueprint phase order unless the user explicitly asks for a different feature.
2. Do not remove old PRD features; mark them as later-phase if the final blueprint de-prioritizes them.
3. Every new route must enforce auth/RBAC and tenant scoping.
4. Every mutation should write an audit log when a user action changes durable state.
5. Prefer real working slices over broad placeholder pages.
