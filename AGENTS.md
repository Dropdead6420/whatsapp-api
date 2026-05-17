# AGENTS.md - NexaFlow AI Project Context

**Project**: NexaFlow AI - AI-Powered WhatsApp Marketing & Automation SaaS Platform
**Version**: 0.1.0
**Status**: Foundation Phase (Phase 1)
**Last Updated**: May 2026

## 🎯 Executive Summary

NexaFlow AI is a **full-stack, multi-tenant SaaS platform** combining WhatsApp Business API, AI-powered marketing automation, and white-label reseller capabilities.

**Scope**: FULL LAUNCH with all 5 portals (SuperAdmin, White Label, Business, Agent, Mobile App), AI Creative Studio, Ads integration, and complete DevOps.

**Stack**: Next.js 14 + Node.js/Express + PostgreSQL + Redis + Elasticsearch + Codex API + Meta WABA

**Timeline**: ~30 weeks (7 months) across 16 implementation phases

**First Pilot**: Your own salon (Cutz & Bangs) - appointment booking + WhatsApp reminders

---

## 🏗 Architecture Overview

### 5 User-Facing Interfaces

1. **SuperAdmin Portal** (You)
   - Tenant management, white-label setup, platform analytics
   - Billing, subscriptions, API health monitoring
   - Support, audit logs, feature flags

2. **White Label Admin Portal** (Resellers/Agencies)
   - Custom branding and domain mapping
   - Client (business) management
   - Reseller billing & revenue sharing
   - Team management

3. **Business Admin Portal** (Primary Dashboard)
   - WhatsApp broadcast campaigns
   - Contact management & CRM
   - Lead pipeline (Kanban with AI scoring)
   - Chatbot flow builder
   - AI creative studio (copywriter + image gen)
   - Meta Ads + Google Ads integration
   - Analytics & reporting

4. **Staff/Agent Portal**
   - Live chat inbox with team routing
   - Lead management
   - Task execution
   - AI reply suggestions

5. **Android Mobile App** (React Native + Expo)
   - Full chat management
   - Push notifications
   - Offline support
   - Campaign quick-send

### Backend Services

- **Express API**: Multi-tenant request context, RBAC middleware, rate limiting
- **PostgreSQL**: Multi-tenant schema isolation via Prisma middleware
- **Redis**: Session storage, rate limiting, job queue (BullMQ)
- **Elasticsearch**: Fast contact/conversation search
- **Socket.io**: Real-time chat, notifications, live updates

### External Integrations

- **Meta WhatsApp API**: WABA for messaging
- **Anthropic Codex**: AI copywriting, intent detection
- **OpenAI**: Fallback LLM, embeddings
- **Stable Diffusion/DALL-E**: Image generation
- **Razorpay/Stripe**: Payment processing
- **AWS S3**: File storage (media, templates)

---

## 📊 Database Schema (Key Models)

### Multi-Tenant Core
- `Tenant`: Accounts (DIRECT, WHITE_LABEL, BUSINESS types)
- `User`: SUPER_ADMIN, WHITE_LABEL_ADMIN, BUSINESS_ADMIN, TEAM_LEAD, AGENT roles
- `Team`: Groups of agents within a business

### CRM & Contacts
- `Contact`: PhoneNumber, tags, custom fields, AI score
- `Lead`: Status (NEW→QUALIFIED→NEGOTIATION→CLOSED), deal value, assignee
- `Conversation`: WhatsApp threads with contact
- `Message`: Inbound/outbound messages with media, delivery status

### Marketing Automation
- `Campaign`: Broadcast (status: DRAFT→SCHEDULED→RUNNING→COMPLETED)
- `WhatsAppTemplate`: Meta-approved templates with variants
- `ChatbotFlow`: Visual flow builder nodes (MESSAGE, CONDITION, ACTION, WEBHOOK)
- `Webhook`: Custom integrations with event triggers

### AI & Content
- `AiUsage`: Track Codex/OpenAI/image gen usage and costs
- `AuditLog`: All mutations (who, what, when, IP address)

### Billing
- `Plan`: STARTER, GROWTH, PRO, ENTERPRISE, CUSTOM with feature flags
- `Subscription`: Active subscriptions tied to Razorpay/Stripe
- `Invoice`: Generated invoices with payment tracking

---

## 🔄 16 Implementation Phases

### Phase 1: Foundation (Week 1-2) ⭐ CURRENT
- [ ] Monorepo setup (Turborepo, workspaces)
- [ ] Docker Compose (PostgreSQL, Redis, Elasticsearch)
- [ ] Prisma schema (all models)
- [ ] Shared packages (@nexaflow/db, @nexaflow/shared, @nexaflow/ui)
- [ ] Backend scaffolding (Express, middleware)
- [ ] Next.js web app scaffold
- [ ] Environment configuration

### Phase 2: Authentication & Authorization (Week 2-3)
- [ ] JWT token system with refresh
- [ ] NextAuth.js (email/password + OAuth: Google, GitHub, Apple)
- [ ] 2FA (TOTP via Google Authenticator)
- [ ] Email verification & password reset
- [ ] RBAC middleware (5 roles with permission system)
- [ ] Audit logging for auth events

### Phase 3: SuperAdmin Portal (Week 3-5)
- [ ] Dashboard (platform stats: messages, tenants, MRR, churn)
- [ ] Tenant CRUD & impersonation
- [ ] Feature flag management per tenant
- [ ] White-label config UI (domain, branding, colors, CSS)
- [ ] Billing UI (plans, subscriptions, invoices, dunning)
- [ ] WhatsApp API credentials management
- [ ] Support ticket & audit log viewers
- [ ] Platform health dashboard

### Phase 4: White Label Admin Portal (Week 5-7)
- [ ] Brand & domain configuration
- [ ] Client (business) CRUD with plan allocation
- [ ] Bulk client onboarding (CSV upload)
- [ ] Team member management
- [ ] Revenue dashboard (MRR, profit margins)
- [ ] Custom pricing per client
- [ ] Invoice generation & delivery
- [ ] Client analytics aggregation

### Phase 5: Business Admin - Core Features (Week 7-10)
- [ ] Dashboard (KPIs, recent campaigns, team activity)
- [ ] Broadcast campaign builder
- [ ] Contact management (CRUD, import/export, tagging, segmentation)
- [ ] Lead Kanban pipeline with AI scoring
- [ ] Template library with Meta approval tracking
- [ ] A/B test builder
- [ ] Campaign analytics (delivery, read, click, conversion tracking)

### Phase 6: Chatbot & Automation (Week 10-13)
- [ ] Visual flow builder (drag-drop nodes)
- [ ] AI intent detection (Codex-powered NLU)
- [ ] Condition builder (tags, custom fields, variables)
- [ ] Action nodes (send message, create lead, call webhook)
- [ ] Appointment booking flow template
- [ ] Webhook integration builder
- [ ] Flow testing sandbox
- [ ] Conversational AI (reply suggestions, sentiment analysis, auto-translate)

### Phase 7: Analytics & Reports (Week 13-15)
- [ ] Campaign analytics (sent, delivered, read, clicked, converted)
- [ ] Lead analytics (conversion rate, lifecycle, funnel)
- [ ] Contact analytics (growth trends, engagement)
- [ ] Revenue attribution (messages→leads→sales)
- [ ] Scheduled report delivery
- [ ] CSV/PDF export
- [ ] Elasticsearch integration for fast search

### Phase 8: AI Creative Studio (Week 15-17)
- [ ] AI copywriter (prompt builder, variant generation with Codex)
- [ ] Tone selection (professional, friendly, casual)
- [ ] Copy scoring (estimated CTR, urgency, clarity)
- [ ] AI image generation (Stable Diffusion/DALL-E with style selection)
- [ ] AI ad copy (Meta Ads, Google Ads templates)
- [ ] Creative library & version history
- [ ] One-click apply to campaigns

### Phase 9: Ads Integration (Week 17-19)
- [ ] Meta Ads account connection (OAuth)
- [ ] Google Ads account connection (OAuth)
- [ ] Campaign creation UI for both platforms
- [ ] Audience targeting from NexaFlow contacts
- [ ] Budget allocation & performance analytics
- [ ] Conversion tracking & ROAS calculation
- [ ] Unified ads dashboard

### Phase 10: Staff/Agent Portal (Week 19-21)
- [ ] Live chat dashboard (inbox, conversation list, thread view)
- [ ] AI reply suggestions button
- [ ] Quick actions (tag, assign, resolve, escalate)
- [ ] Assigned leads in Kanban
- [ ] Task management & execution
- [ ] Mobile-friendly responsive design
- [ ] Push notification system

### Phase 11: Android Mobile App (Week 21-24)
- [ ] React Native Expo setup
- [ ] Authentication flow (email + OAuth)
- [ ] Chat dashboard (message list, send, AI reply button)
- [ ] Lead Kanban (drag-drop on mobile)
- [ ] Push notifications (Firebase Cloud Messaging)
- [ ] Offline message queueing & sync
- [ ] Contact quick-search
- [ ] Team directory & agent status

### Phase 12: Public API & Webhooks (Week 22-24)
- [ ] REST API (OpenAPI 3.0 docs)
- [ ] Endpoints: /contacts, /campaigns, /conversations, /leads
- [ ] API key management in admin portal
- [ ] Rate limiting per API key
- [ ] Webhook events (MESSAGE_SENT, MESSAGE_RECEIVED, LEAD_CREATED, etc.)
- [ ] Webhook delivery logs & resend UI
- [ ] Node.js SDK with example code

### Phase 13: Billing & Payments (Week 23-25)
- [ ] Razorpay integration (subscriptions, payment webhooks)
- [ ] Stripe integration (international support)
- [ ] Plan enforcement (rate limits, feature gating)
- [ ] Usage tracking & overage alerts
- [ ] Upgrade/downgrade flows
- [ ] Invoice generation & delivery
- [ ] Dunning/retry on failed payments

### Phase 14: DevOps, Security & Monitoring (Week 25-28)
- [ ] Docker setup (API, web, worker containers)
- [ ] Kubernetes manifests (deployments, services, statefulsets)
- [ ] GitHub Actions CI/CD (lint, test, build, deploy)
- [ ] Security hardening (WAF, DDoS, secrets management)
- [ ] Sentry for error tracking
- [ ] Datadog for APM & custom dashboards
- [ ] Automated backups (PostgreSQL, Redis)
- [ ] Database optimization (indexing, partitioning)

### Phase 15: Testing & Onboarding (Week 26-28)
- [ ] E2E tests (Playwright/Cypress)
- [ ] Multi-tenant isolation tests
- [ ] Performance load testing
- [ ] Reseller onboarding automation
- [ ] Onboarding checklist
- [ ] Reseller documentation & training

### Phase 16: Launch & GTM (Week 28-30)
- [ ] Pre-launch security audit & pen testing
- [ ] Alpha launch (5 free pilots including your salon)
- [ ] Feedback collection & iteration
- [ ] Public launch (Product Hunt, LinkedIn, YouTube)
- [ ] Agency partnership program
- [ ] Referral program setup

---

## 🎬 How to Use This Context

When working on any phase:

1. **Read the phase description** to understand goals
2. **Check dependencies** (only start if all dependencies are complete)
3. **Follow folder structure** in /apps and /packages
4. **Use Prisma types** for database models
5. **Apply RBAC middleware** for all routes requiring auth
6. **Log all mutations** to AuditLog for compliance

### Common Commands

```bash
# Development
npm run dev                    # Start all dev servers (web, api)
npm run db:studio             # Open Prisma Studio
npm run db:migrate            # Run migrations
npm run db:seed               # Seed database

# Building
npm run build                 # Build all workspaces
npm run lint                  # Lint all workspaces

# DevOps
docker-compose up -d          # Start infrastructure
docker-compose down           # Stop infrastructure
```

---

## 🔑 Key Design Principles

1. **Multi-Tenant First**: Every query scoped by `tenantId`
2. **Type Safety**: Full TypeScript across stack
3. **Audit Everything**: All mutations logged to AuditLog
4. **Scalability**: Elasticsearch for search, Redis for caching, Prisma for optimization
5. **Security**: Encryption at rest/transit, JWT, 2FA, rate limiting
6. **DX**: Turborepo, Docker Compose, Prisma Studio for developer experience

---

## 📝 File Structure Tips

- **API routes**: `/apps/api/src/modules/[feature]/routes.ts`
- **Web pages**: `/apps/web/app/(role)/[feature]/page.tsx`
- **Shared types**: `/packages/shared/src/types.ts`
- **UI components**: `/packages/ui/src/components/`
- **Prisma models**: `/packages/db/prisma/schema.prisma`

---

## 🚨 Important Notes

- **NEVER** skip multi-tenant scoping (add `tenantId` checks everywhere)
- **ALWAYS** encrypt sensitive data (WABA tokens, API keys, passwords)
- **ALWAYS** test with multiple tenants before committing
- **KEEP** the database schema clean (use migrations, no raw SQL)
- **DOCUMENT** new features in this file as you build

---

**Next Step**: Start Phase 1 - Initialize monorepo, Docker, and Prisma schema (you're here!)
