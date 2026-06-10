# AdGrowly — GMB-First Roadmap

Sources:
- `AdGrowly_Claude_GMB_First_Planning_Document.pdf` (original GMB-first plan)
- `AdGrowly_Claude_Final_Planning_Old_New_Features.docx` (**final** — old + new features)

GMB-first AI Local Business Growth SaaS, layered onto the existing platform in this
repo (Next.js + Express/Prisma + Postgres + BullMQ).

## Non-negotiable rules (from the final doc)

1. **Launch GMB first.** WhatsApp is **Part 2** with its own architecture (WABA,
   templates, campaigns, inbox, chatbot, workflow, rate engine). GMB MVP plans only
   integration **hooks** (review-request sharing, report sharing, future CRM/CDP).
2. **Everything is Super-Admin-controlled** — plans, features, pricing, API keys,
   prompts, credits, reports, portal menus, CMS, theme, partner access, add-ons.
   **No hardcoded** pricing / features / API keys / AI prompts / plan limits.
3. **Terminology:** say *Customer*, not *Tenant* (presentation-layer label; the DB
   `Tenant` model stays — renaming it is out of scope / Codex-shared).
4. Customer portal shows **only admin-enabled features**.
5. Security throughout: API keys encrypted + backend-only, Google OAuth refresh-safe,
   accurate credit deduction, verified payment webhooks, scheduled-posting retries.

## Reuse map (already shipped — no rebuild)

| AdGrowly need | Reused from this repo |
|---|---|
| API Key Management (OpenAI/Claude/Gemini/image/Google/SMS/WhatsApp/email) | **Secret Vault** + **AI Provider Hub** (`secretVault`, `aiProviderHub`, `aiGateway`) |
| Plan / Pricing / Feature / coupons / add-ons | Product Marketplace, plans, `Currency`/`CurrencyRate`, feature flags |
| Wallet / credits / subscription / invoices | `customer-wallets`, `wallets`, Razorpay/Stripe, invoices |
| Support Desk, Knowledge Base | `supportTicket`, `knowledgeBase` |
| Staff / Roles / Audit Logs / login-as | `UserRole` + `Permissions`, audit log, impersonation |
| Theme Manager (logo/colors/branding) | white-label branding |
| AI Post / Caption Generator + Scheduler | `GmbPost` + `/gmb` posts (`buildGmbCaption`, schedule) |

## Phase 1 — GMB modules (status)

Each module: schema → service → routes → tests (→ UI later), one slice per `code`,
pathspec-committed + pushed, GHCR build part of the deliverable. Tenant-scoped GMB
work gated by `GMB_MANAGE`; Super-Admin work gated by `requireRole(SUPER_ADMIN)`.

- [x] 1. **GMB Location / Business Profile** — anchor entity (`661cb36`)
- [x] 2. **Reputation** — `GmbReview` + AI review replies, generate-then-approve (`cadb106`)
- [x] 3. **Ranking tracker** — tracked keywords + local-rank snapshots + trend (`c14137a`)
- [x] 4. **Insights** — GBP performance snapshots + derived totals/action-rate (`97d2bdd`)
- [x] 5. **Citations** — NAP directory listings + consistency scoring (`a1a5de4`)
- [x] 6. **AI Prompt management** — Super-Admin prompt templates + engine (`9bfe84e`)
- [x] 7. **CMS control** — Super-Admin content blocks + public reader (`c8c8308`)
- [x] 8. **Reports** — aggregation + narrative + action plan / AI monthly report (`9637b9f`)
- [x] 9. **Managed services** — agency packages + engagement lifecycle (`cdd504a`)

**✅ Phase 1 complete — all 9 GMB-first modules shipped and GHCR-green.**

## Phase 2 — new AI features + admin engines (from the final doc)

New items the final doc adds beyond Phase 1. Built slice-by-slice after Phase 1, same
loop. AI features are tenant-scoped (`GMB_MANAGE`) and pull prompts from module 6;
admin engines are `SUPER_ADMIN`.

- [x] 10. **AI Keyword Finder** — local-SEO idea generator + saved sets (`64ed153`)
- [x] 11. **AI Description Optimizer** — analyze + optimize, generate-then-approve (`5ccf61d`)
- [x] 12. **AI Ranking Advisor** — profile-gap score/grade + weekly tasks (`8bdac04`)
- [x] 13. **Credit Engine** — Super-Admin cost-per-action rules + cost map (`0948828`)
- [x] 14. **Google API Monitor** — connection health + API log feed (`04897aa`)
- [x] 15. **AI Image Generator** — prompt builder + request lifecycle (`a5ff452`)
- [x] 16. **Customer Dashboard aggregation** — score + cards + alerts read-model (`960f1d9`)

**✅ Phase 2 complete — all 7 new AI/admin modules shipped. AdGrowly roadmap 16/16.**

## Mapping: final-doc requirements → status

**§2 GMB AI features:** Review Reply ✅(2) · Post Generator ✅(reuse) · Caption
Generator ✅(reuse) · Keyword Finder ⏳(10) · Description Optimizer ⏳(11) · Ranking
Advisor ⏳(12) · Image Generator ⏳(15) · Monthly Report ⏳(8).

**§3 Customer modules:** Dashboard ⏳(16) · Connect GMB ✅(1) · Review Mgmt ✅(2) ·
Keyword Finder ⏳(10) · Content Studio ✅/⏳(posts done; image 15) · Image Generator
⏳(15) · Post Scheduler ✅(reuse) · Ranking Tracker ✅(3) · Reports ⏳(8) ·
Wallet/Credits ✅(reuse) · Subscription ✅(reuse) · Support ✅(reuse) · Settings ✅(1).

**§4 Super Admin modules:** Dashboard ⏳ · Customer Mgmt ✅(reuse) · Plan Mgmt
✅(reuse) · Feature Control ✅(reuse) · Pricing Control ✅(reuse) · API Key Mgmt
✅(reuse) · AI Prompt Mgmt ✅(6) · Credit Engine ⏳(13) · Google API Monitor ⏳(14) ·
Report Templates ⏳(8) · CMS Manager ⏳(7) · Theme Manager ✅(reuse) · Support Desk
✅(reuse) · Staff/Roles ✅(reuse) · Audit Logs ✅(reuse).
