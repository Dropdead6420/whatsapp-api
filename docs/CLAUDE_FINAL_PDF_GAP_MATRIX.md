# NexaFlow — Claude FINAL PDF Gap Matrix

**Source**: `/Users/sidharthkumar/Downloads/NexaFlow_Claude_FINAL_Full_Project_Architecture_and_Features.pdf`  
**Compared to repo**: 2026-05-20  
**Status key**: ✅ shipped · 🟡 partial · ❌ not started

Use with [`TASKS.md`](../TASKS.md) (Codex backlog) and [`BLUEPRINT_PHASE_AUDIT.md`](BLUEPRINT_PHASE_AUDIT.md).

---

## Platform portals

| Surface | PDF scope | Status | Gaps |
| --- | --- | --- | --- |
| SuperAdmin Portal | Global dashboard, partners, customers, providers, wallets, compliance, health, audit | 🟡 | Impersonation, compliance center UI, revenue share, auto-suspend rules, provider health drill-down |
| Partner / Reseller Portal | Dashboard, onboarding, wallet, demo, white-label, team, billing, partner AI | 🟡 | No `/partner/*` UI shell; API slices for demo + whitelabel exist; wallet transfers partial; commissions ❌ |
| White Label Portal | Branding, domains, email sender, modules, preview | 🟡 | Domains + branding fields ✅; real SSL, email domain UI, preview iframe ❌ |
| Customer Admin Portal | Inbox, CRM, campaigns, templates, CRM, workflows, AI, bookings, analytics, billing | 🟡 | Core shipped; A/B campaigns, drip depth, template Meta submit, integrations (Shopify, Ads) ❌ |
| Agent Portal | Assigned inbox only, AI replies, notes, tasks, leads | ❌ | T-140 — no `/agent/*` routes |
| Developer / API Portal | Keys, webhooks, logs, SDK, sandbox, metering | 🟡 | T-141A/B shipped; OpenAPI, SDK, full metering chart ❌ |
| Android Mobile App | Inbox, FCM, leads, campaigns, booking, AI reply | ❌ | T-143 |

---

## Meta / WhatsApp (PDF § Meta)

| Feature | Status | Notes |
| --- | --- | --- |
| Embedded Signup | ✅ | T-004 |
| WABA + phone + encrypted token | ✅ | T-094 envelope encryption |
| Inbound webhook + idempotency + signature | ✅ | T-003 |
| Business profile manager UI | ❌ | Schema fields exist; display-name update flow missing |
| Template submit + sync + rejection reasons | 🟡 | CRUD local; Meta submission pipeline incomplete |
| Provider abstraction (Meta, Gupshup, …) | ✅ | T-005; Haptik/360/Twilio adapters ❌ |
| Conversation billing → wallet | 🟡 | T-001 behind `WALLET_BILLING_ENABLED` |
| STOP / opt-out | ✅ | |

---

## No-code workflow builder (PDF § Workflow)

| Area | PDF | Status | Gaps |
| --- | --- | --- | --- |
| React Flow editor | ✅ | `FlowEditor.tsx` |
| Runtime + BullMQ worker | ✅ | DELAY resume, trail, WAITING |
| **Triggers** | message, lead, tag, appointment, payment, webhook, campaign click | 🟡 | keyword ✅; event triggers (lead/tag/appointment/message_received) — **T-060** |
| **Action nodes** | send WA, template, media, CRM, lead, agent, booking, invoice, tag | 🟡 | MESSAGE, ADD_TAG, AGENT_TRANSFER ✅; SEND_TEMPLATE, CREATE_LEAD — **T-061**; rest ❌ |
| **Logic nodes** | IF/ELSE, switch, delay, wait-reply, loop, filter, stop, error | 🟡 | CONDITION, DELAY, END ✅; SWITCH, WAIT_REPLY, LOOP, FILTER, ERROR_HANDLER ❌ |
| **AI nodes** | 9 types | 🟡 | AI_RESPONSE only; T-050 backlog |
| API node | GET/POST/PUT/PATCH/DELETE | 🟡 | WEBHOOK POST/GET + timeout |
| Execution | DLQ, version pin, marketplace | 🟡 | Runs logged; no flow versioning; T-142 marketplace ❌ |

---

## AI layer (PDF § AI)

| Feature | Status |
| --- | --- |
| Campaign autopilot, segmentation, reply, sentiment, lead score, copy | ✅ |
| AI agent builder + knowledge base + compliance auditor | ❌ T-051, T-052, T-053 |
| Partner / SuperAdmin AI assistants | ❌ T-054, T-053 |
| Retention engine, booking assistant depth | 🟡 |

---

## Billing & wallet (PDF § Billing)

| Feature | Status |
| --- | --- |
| Wallet + ledger models + admin UI | ✅ |
| Debit on send + AI | ✅ (feature-flagged) |
| Razorpay / Stripe live integration | ❌ env placeholders only |
| Postpaid credit line, auto-recharge, low-balance alerts | ❌ T-020–T-022 |
| Partner revenue share / commissions | ❌ T-032 |

---

## Scale & ops (PDF § Scale)

| Feature | Status |
| --- | --- |
| PgBouncer, BullMQ workers, Redis cluster, read replica, Socket.io | ✅ Phase A–C code |
| Partitioning, OpenSearch, OTel | 🟡 T-110–T-112, T-120 deferred |
| k6 load + synthetics + Sentry + Prometheus | ✅ |
| CI/CD K8s, backups, chaos in prod | 🟡 runbook only |

---

## Recommended build order (matches PDF phases 0→7)

1. **Finish Phase 1 polish** — E2E auth/send, campaign analytics, template Meta pipeline  
2. **Phase 2 leftovers** — Business profile manager, template approval webhooks  
3. **Phase 3 SuperAdmin** — Impersonation, compliance center, postpaid controls  
4. **Phase 4 Partner** — T-030–T-034 partner portal shell + wallet transfers UI  
5. **Phase 5 Workflow** — T-060 triggers → T-061 actions → T-050 AI nodes → T-142 marketplace  
6. **Phase 6 AI** — Knowledge base + agent builder  
7. **Phase 7** — Agent portal (T-140), mobile (T-143), partitioning (T-110+)

---

## Codex-ready slices added from this PDF

See **Next up** and **Backlog** in [`TASKS.md`](../TASKS.md):

- **T-060** Event-driven flow triggers  
- **T-061** Workflow action nodes: `SEND_TEMPLATE`, `CREATE_LEAD`  
- **T-062** (existing) Scheduled report exports  
- **T-140–T-143** New portals / mobile (already tracked)

Detailed workflow spec: [`WORKFLOW_BUILDER_PLAN.md`](WORKFLOW_BUILDER_PLAN.md).
