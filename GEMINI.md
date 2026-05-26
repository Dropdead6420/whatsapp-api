# GEMINI.md - NexaFlow AI Development Contract for Gemini

Welcome to NexaFlow AI's workspace guide for Gemini! This file contains coding guidelines, local directory workflows, and build instructions. Read this file at the start of every session.

---

## 🎯 Workspace Setup

Always ensure you are operating inside the active clone folder `whatsapp-api/`:
- **API backend**: `whatsapp-api/apps/api`
- **Next.js web portal**: `whatsapp-api/apps/web`
- **DB package**: `whatsapp-api/packages/db`
- **UI package**: `whatsapp-api/packages/ui`

---

## ⚡ Core Build & Development Commands

Run all command scripts from the root directory `whatsapp-api/`:

```bash
# Clean lockfiles & reinstall
npm run clean && npm install

# Launch backend infrastructure
docker-compose up -d

# Start parallel development servers (web + api)
npm run dev

# Build the entire monorepo
npm run build

# Run type checks
npm run lint
```

---

## 🎨 Design System & Aesthetic Principles

NexaFlow demands a **state-of-the-art premium product UI**. All pages must follow these rules:
1. ** Harmonious Palette**: Never use basic, uncalibrated primary colors (`red`, `blue`, `green`). Use tailored HSL-based palettes (e.g., slate grays, emerald accents, deep indigo partners).
2. **Premium Dark Theme Support**: Provide fully cohesive light-to-dark UI styles. Dark theme must feel rich, deep, and cohesive (use dark slates like `bg-slate-900`/`bg-slate-950` with high-contrast emerald text borders and subtle glowing shadows).
3. **Glassmorphism & Gradients**: Use gentle gradients (e.g. `bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-pink-500/10`) and backdrop blur effects (`backdrop-blur-md`) on high-profile cards.
4. **Micro-animations**: Integrate subtle transition delays and scale hops (`transition-all duration-300 hover:scale-[1.01]`) on interactive panels.

---

## 🔌 Robust Frontend Fallbacks (LocalStorage)

To preserve high-fidelity interactive demos when the backend database is offline:
- **Always implement local storage hooks** to save user mutations.
- **Provide interactive stubs** showing success alerts, loading indicators, and simulated database additions.
- Detect API load failure and immediately fall back to beautiful, mock-populated local stores so that the platform remains fully functional for showcase deployments.

---

## 🏗 Build & Release Phases

- **Phase A: Foundation**: Workspace verification, shared packages compilation, Prisma schema check.
- **Phase B: Authentication**: JWT login hooks, Impersonation checks, Partner tokens.
- **Phase C: UI Expansion**: Premium dashboard widgets, white-label configurations, theme builders, customer tables.
- **Phase D: Integrations**: WABA connection channels, Razorpay payment flows, webhook logs, email domain records.
- **Phase E: AI Autopilot**: Campaign forecasting, copywriting generation, semantic intent modules.
