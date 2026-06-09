# AdGrowly — GMB-First Roadmap

Source: **AdGrowly_Claude_GMB_First_Planning_Document.pdf** (AI Local Business Growth
SaaS). This plans the GMB-first modules and their build order, layered onto the
existing platform in this repo (Next.js + Express/Prisma + Postgres + BullMQ).

## Non-negotiable rules (from the PDF)

1. **Launch GMB first.** WhatsApp stays a separate module/phase — the GMB modules
   must stand alone (no WhatsApp dependency in the GMB MVP).
2. **Everything important is Super-Admin-controlled.** Partner controls only what
   Super Admin allows. (Served by RBAC + Product Marketplace + feature flags.)
3. Customer Portal + Super Admin Portal now; Partner Portal later.
4. Multi-currency later (already present); security throughout (RBAC, encrypted
   secrets, audit, scoping — already present).

## Reuse map (already shipped — no rebuild)

| AdGrowly need | Reused from this repo |
|---|---|
| Google API keys, encrypted | **Secret Vault** (`secretVault.service`, `/secret-vault`) |
| AI content + review replies + prompts backbone | **AI Provider Hub + gateway** (`aiProviderHub`/`aiGateway`, fallback + cost) |
| Wallet / credits / payments | `customer-wallets`, `wallets`, Razorpay/Stripe |
| Support tickets, KB | `supportTicket`, `knowledgeBase` |
| Roles / Super-Admin control | `UserRole` + `Permissions` + Product Marketplace |
| Multi-currency | `Currency`, `CurrencyRate` |
| GMB posts (content studio — posts) | `GmbPost` + `/gmb` (shipped) |

## GMB-first module gaps → build order

Each module: schema → service → routes → tests → UI, one slice per step, committed +
pushed, GHCR build part of the deliverable. Gated by `GMB_MANAGE` (Super Admin grants).

1. **GMB Location / Business Profile** — the anchor entity (name, address, place id,
   category, rating, review count, connection + sync state). Reviews / insights /
   ranking all hang off a location. **← first.**
2. **Reputation** — `GmbReview` (rating, author, comment, reply state) + AI review
   replies via the AI gateway (generate-then-approve).
3. **Ranking tracker** — tracked keywords + periodic local-rank snapshots.
4. **Insights** — periodic GMB metric snapshots (views, searches, calls, directions).
5. **Citations** — NAP directory listings + consistency status.
6. **AI Prompt management** — Super-Admin-editable prompt templates (content studio
   + review replies pull their prompts from here).
7. **CMS control** — Super-Admin marketing/site content blocks.
8. **Reports** — GMB report aggregation (extends existing analytics).
9. **Managed services** — agency service packages (reuse Product / add-ons).

## Status

- [ ] 1. GMB Location / Business Profile
- [ ] 2. Reputation (reviews + AI replies)
- [ ] 3. Ranking tracker
- [ ] 4. Insights
- [ ] 5. Citations
- [ ] 6. AI Prompt management
- [ ] 7. CMS control
- [ ] 8. Reports
- [ ] 9. Managed services
