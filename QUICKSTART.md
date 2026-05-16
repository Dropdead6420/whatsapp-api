# Quick Start Guide - NexaFlow AI

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker & Docker Compose

### Step 1: Install Dependencies
```bash
cd /Users/sidharthkumar/Desktop/whatsappp\ api\ nexadly
npm install
```

### Step 2: Start Infrastructure
```bash
docker-compose up -d
```

This starts:
- PostgreSQL 16 (port 5432)
- Redis 7 (port 6379)
- Elasticsearch 8 (port 9200)

### Step 3: Setup Database
```bash
cd packages/db
npm run migrate
```

### Step 4: Start Development Servers
```bash
# From root directory
npm run dev
```

This starts:
- 🌐 Web: http://localhost:3000
- 🔌 API: http://localhost:3001

### Step 5 (Optional): Open Prisma Studio
```bash
npm run db:studio
```

Opens data viewer at http://localhost:5555

---

## 📂 Important Directories

```
nexaflow-ai/
├── apps/
│   ├── web/          👈 Next.js web app (start here to see UI)
│   ├── api/          👈 Express.js backend API
│   └── mobile/       👈 React Native mobile app
├── packages/
│   ├── db/           👈 Prisma schema (database structure)
│   ├── shared/       👈 Shared TypeScript types
│   └── ui/           👈 Shared UI components
├── docker-compose.yml 👈 Database, Redis, Elasticsearch
├── CLAUDE.md         👈 Implementation context for Claude Code
├── README.md         👈 Full documentation
└── .env.example      👈 Configuration template
```

---

## 🛠 Common Development Commands

```bash
# Development
npm run dev              # Start all servers
npm run db:studio       # Open data viewer
npm run db:migrate      # Run database migrations

# Building
npm run build           # Build all packages
npm run lint            # Lint all packages

# Infrastructure
docker-compose up -d    # Start databases
docker-compose down     # Stop databases
docker-compose logs -f  # View logs

# Git
git status              # Check changes
git add -A              # Stage changes
git commit -m "..."     # Commit changes
```

---

## 🔌 API Health Check

Test that API is running:
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-16T10:41:05.261Z"
}
```

---

## 📊 Database Access

### Via Prisma Studio
```bash
npm run db:studio
```

### Via PostgreSQL CLI
```bash
psql postgresql://nexaflow:nexaflow@localhost:5432/nexaflow_dev
```

### Via Redis CLI
```bash
redis-cli -h localhost
```

---

## 🚀 Next: Read Implementation Context

For detailed information about the project architecture and how to implement features, read:

**CLAUDE.md** - 11,600+ lines of implementation context

This file contains:
- Architecture overview
- Database schema explanation
- 16 implementation phases
- Design principles
- File structure tips
- Important notes for developers

---

## ❓ Troubleshooting

### Port already in use
```bash
# Check what's using the port
lsof -i :3000    # Web
lsof -i :3001    # API
lsof -i :5432    # PostgreSQL
```

### Docker services not starting
```bash
docker-compose down
docker-compose up -d --remove-orphans
```

### Dependencies not installing
```bash
rm -rf node_modules package-lock.json
npm install
```

### Database migration errors
```bash
cd packages/db
npx prisma db push --skip-generate
```

---

## 📚 Key Documentation Files

1. **README.md** (9800 lines)
   - Project overview
   - Feature list
   - Technology stack
   - Architecture diagrams

2. **CLAUDE.md** (11600 lines)
   - Complete implementation context
   - 16 phase breakdown
   - Database schema explanation
   - Design principles

3. **PHASE_1_COMPLETION.md** (9400 lines)
   - Phase 1 detailed report
   - What was created
   - Key decisions
   - Ready for Phase 2

---

## 🎯 Your Pilot Project

**Cutz & Bangs Salon** (Your salon)

Features to implement first:
1. Appointment booking flow
2. WhatsApp reminders
3. Post-visit review requests

This will be your live demo and case study!

---

## 📞 Need Help?

1. Check **CLAUDE.md** for complete context
2. Check **README.md** for architecture
3. Review **PHASE_1_COMPLETION.md** for Phase 1 details
4. Read comments in code files

---

**Happy building! 🚀**
