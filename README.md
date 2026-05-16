# NexaFlow AI - Multi-Tenant WhatsApp Marketing & Automation Platform

A comprehensive, AI-powered marketing automation and WhatsApp communication platform built as a full-stack SaaS with multi-tenant support, white-label capabilities, and mobile access.

## 🎯 Project Vision

Enable businesses of any size — from local salons to enterprise brands — to automate their marketing, customer communication, and sales workflows using AI and WhatsApp, all manageable through a single, beautifully designed platform with multi-role portals and an Android app.

## 📦 Monorepo Structure

```
nexaflow-ai/
├── apps/
│   ├── web/                  # Next.js 14 web application (all portals)
│   │   ├── app/
│   │   │   ├── (superadmin)/    # SuperAdmin portal routes
│   │   │   ├── (whitelabel)/    # White Label Admin portal routes
│   │   │   ├── (business)/      # Business Admin portal routes
│   │   │   └── (agent)/         # Agent/Staff portal routes
│   │   └── ...
│   ├── api/                  # Node.js/Express backend API
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── whatsapp/       # WhatsApp API integration
│   │   │   │   ├── ai/             # AI/LLM services
│   │   │   │   ├── campaigns/      # Campaign engine
│   │   │   │   ├── chatbot/        # Flow engine
│   │   │   │   ├── crm/            # CRM operations
│   │   │   │   ├── analytics/      # Analytics
│   │   │   │   └── billing/        # Billing & subscriptions
│   │   │   ├── middleware/
│   │   │   ├── utils/
│   │   │   └── index.ts
│   │   └── ...
│   └── mobile/               # React Native Expo Android app
│       └── ...
├── packages/
│   ├── db/                   # Prisma schema & migrations
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── ...
│   ├── shared/               # Shared types, utils, constants
│   └── ui/                   # Shared UI components (shadcn/ui)
├── infrastructure/           # Docker, K8s, Terraform configs
├── docs/                     # API docs, architecture diagrams
├── docker-compose.yml        # Local development stack
├── turbo.json                # Turborepo configuration
├── .env.example              # Environment variables template
└── README.md                 # This file
```

## 🛠 Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend Web | Next.js 14 (App Router) + TypeScript | SSR, SEO, multi-tenant routing |
| Frontend Mobile | React Native (Expo) + TypeScript | Cross-platform, shared code with web |
| UI Library | Tailwind CSS + shadcn/ui + Radix UI | Fast, accessible, customizable |
| Backend | Node.js + Express/Fastify | High concurrency for webhooks |
| Primary DB | PostgreSQL + Prisma ORM | Relational data, multi-tenant isolation |
| Cache | Redis | Session mgmt, rate limiting, pub/sub |
| Search | Elasticsearch | Fast contact/conversation search |
| File Storage | AWS S3 / Cloudflare R2 | Media, templates, AI-generated creatives |
| WhatsApp | Meta Cloud API (WABA) | Official WhatsApp Business API |
| AI/LLM | Anthropic Claude + OpenAI | Creative generation, intent detection |
| Image Gen | Stable Diffusion / DALL-E | Ad creatives and marketing images |
| Background Jobs | BullMQ + Redis | Campaign scheduling, bulk messaging |
| Real-time | Socket.io / WebSockets | Live chat, agent notifications, updates |
| Auth | NextAuth.js + JWT + RBAC | Multi-role auth, OAuth, 2FA |
| Email | Resend / SendGrid | Transactional emails, reports |
| Payments | Razorpay + Stripe | INR + international billing |
| DevOps | Docker + Kubernetes + GitHub Actions | Container orchestration, CI/CD |
| Monitoring | Sentry + Datadog | Error tracking, performance monitoring |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker & Docker Compose
- Git

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd nexaflow-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start infrastructure services**
   ```bash
   docker-compose up -d
   ```

4. **Setup environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

5. **Setup database**
   ```bash
   cd packages/db
   npm run migrate
   npm run seed
   ```

6. **Start development servers**
   ```bash
   npm run dev
   ```

This will start:
- **Web App**: http://localhost:3000
- **API**: http://localhost:3001
- **Prisma Studio**: http://localhost:5555 (in another terminal: `npm run db:studio`)

## 📋 5 Portals & Interfaces

### 1. **SuperAdmin Portal** (You - Platform Owner)
God-mode access to entire platform:
- Tenant & reseller management
- Platform configuration
- White-label setup
- Billing & subscriptions
- Platform analytics
- Support & audit logs

### 2. **White Label Admin Portal** (Resellers/Agencies)
Fully branded instance for resellers:
- Brand & domain setup
- Client (business) management
- Team management
- Reseller billing & revenue
- Client analytics

### 3. **Business Admin Portal** (Business Owners)
Main marketing automation dashboard:
- WhatsApp broadcast campaigns
- Contact management & CRM
- Lead management (Kanban)
- Template management
- Chatbot flow builder
- AI creative studio
- Ads integration (Meta, Google)
- Analytics & reporting

### 4. **Staff/Agent Portal** (Support Team)
Live chat & lead management:
- Conversation inbox
- Lead management
- Task management
- AI reply suggestions
- Mobile-friendly UI

### 5. **Android Mobile App** (All Roles)
Full-featured mobile access:
- Live chat management
- Lead Kanban
- Push notifications
- Offline support
- Campaign quick-send

## 🎯 Core Features

### WhatsApp Marketing
- ✅ Bulk broadcast campaigns
- ✅ Template management with Meta approval tracking
- ✅ Scheduled & recurring campaigns
- ✅ A/B testing variants
- ✅ Delivery & read tracking
- ✅ Revenue attribution

### Conversational AI
- ✅ WhatsApp chatbot flow builder
- ✅ AI intent detection (Claude-powered)
- ✅ AI reply suggestions for agents
- ✅ Multi-language support
- ✅ Sentiment analysis
- ✅ Auto-translate messages

### AI Creative Studio
- ✅ AI copywriter (generate message variants)
- ✅ AI image generation (DALL-E / Stable Diffusion)
- ✅ Ad copy generation (Meta, Google Ads)
- ✅ Tone & style selection
- ✅ Performance predictions

### Marketing Automation
- ✅ Contact management & segmentation
- ✅ Lead pipeline (Kanban)
- ✅ Appointment booking automation
- ✅ Webhook-based integrations
- ✅ Custom workflow builder

### Ads Integration
- ✅ Meta Ads account connection
- ✅ Google Ads account connection
- ✅ Unified ads dashboard
- ✅ Audience targeting
- ✅ Conversion tracking & ROAS

### Team & CRM
- ✅ Multi-agent support
- ✅ Live chat assignment
- ✅ Lead assignment
- ✅ Team activity log
- ✅ Performance analytics

### White-Label & Reseller
- ✅ Custom branding per reseller
- ✅ Custom domains
- ✅ Client billing automation
- ✅ Revenue sharing
- ✅ Feature flag per client

### Enterprise
- ✅ Multi-tenant data isolation
- ✅ RBAC (role-based access control)
- ✅ 2FA (TOTP)
- ✅ Audit logging
- ✅ API key management
- ✅ Webhook system
- ✅ Rate limiting

## 📊 16 Implementation Phases

| Phase | Duration | Focus | Deliverables |
|-------|----------|-------|--------------|
| 1 | Week 1-2 | **Foundation** | Monorepo, Docker, Prisma schema, shared packages |
| 2 | Week 2-3 | **Auth** | JWT, NextAuth, OAuth, 2FA, RBAC |
| 3 | Week 3-5 | **SuperAdmin Portal** | Tenant mgmt, white-label, billing, platform health |
| 4 | Week 5-7 | **White Label Admin** | Brand setup, client mgmt, reseller billing |
| 5 | Week 7-10 | **Business Admin - Core** | Campaigns, contacts, leads, templates |
| 6 | Week 10-13 | **Chatbot & Automation** | Flow builder, intent detection, webhooks |
| 7 | Week 13-15 | **Analytics** | Campaign analytics, lead analytics, search |
| 8 | Week 15-17 | **AI Creative Studio** | Copywriter, image gen, ad copy |
| 9 | Week 17-19 | **Ads Integration** | Meta Ads, Google Ads, unified dashboard |
| 10 | Week 19-21 | **Agent Portal** | Chat inbox, lead mgmt, mobile design |
| 11 | Week 21-24 | **Android App** | React Native app, notifications, offline |
| 12 | Week 22-24 | **Public API** | REST API, webhooks, SDKs |
| 13 | Week 23-25 | **Billing & Payments** | Razorpay, Stripe, invoicing, dunning |
| 14 | Week 25-28 | **DevOps & Security** | K8s, CI/CD, monitoring, backups |
| 15 | Week 26-28 | **Testing & Onboarding** | E2E tests, partner setup |
| 16 | Week 28-30 | **Launch & GTM** | Alpha pilots, public launch |

## 🔐 Security & Compliance

- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Multi-tenant isolation**: Prisma middleware scoping
- **Authentication**: JWT + NextAuth + OAuth + 2FA (TOTP)
- **Rate limiting**: Per-IP and per-tenant
- **Audit logging**: All mutations logged with user, IP, timestamp
- **Backups**: Hourly incremental, daily full, 30-day retention
- **Compliance**: DPDP Act 2023 (India), GDPR-ready

## 📈 Success Targets

- **Alpha**: 5 free pilot clients, ₹0 MRR
- **Beta**: 30 paid businesses, ₹5L MRR
- **Launch**: ₹1L MRR, 100+ businesses, 5 resellers
- **6-month**: ₹20L MRR, 500+ businesses, 20+ resellers

## 🎓 First Pilot Client

**Your own salon - Cutz & Bangs** (Kakrola Rd, Dwarka)
- Appointment booking flow
- WhatsApp reminders
- Post-visit review requests
- Live demo + genuine testimonial

## 📚 Documentation

- [API Documentation](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Database Schema](./packages/db/prisma/schema.prisma)
- [Deployment Guide](./docs/DEPLOYMENT.md)
- [Contributing Guide](./CONTRIBUTING.md)

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - See LICENSE file

## 👨‍💻 Author

**Sidharth Kumar** - Product Owner & Builder

---

**Built with Claude Code & AI Copilot** 🚀
