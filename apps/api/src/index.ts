import "dotenv/config";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "@nexaflow/db";
import { closeRedis, pingRedis } from "./lib/redis";
import { closeQueues } from "./lib/queue";
import { attachRealtime, closeRealtime } from "./lib/realtime";
import {
  initSentry,
  httpMetricsMiddleware,
  captureException,
} from "./lib/observability";
import { errorHandler } from "./middleware/errorHandler";
import { redisRateLimit } from "./middleware/redisRateLimit";
import { authMiddleware } from "./middleware/auth";
import authRoutes from "./routes/auth.routes";
import tenantsRoutes from "./routes/tenants.routes";
import contactsRoutes from "./routes/contacts.routes";
import leadsRoutes from "./routes/leads.routes";
import templatesRoutes from "./routes/templates.routes";
import campaignsRoutes from "./routes/campaigns.routes";
import conversationsRoutes from "./routes/conversations.routes";
import aiRoutes from "./routes/ai.routes";
import analyticsRoutes from "./routes/analytics.routes";
import adminRoutes from "./routes/admin.routes";
import whatsappRoutes, { webhookRouter } from "./routes/whatsapp.routes";
import cannedRepliesRoutes from "./routes/canned-replies.routes";
import servicesRoutes from "./routes/services.routes";
import appointmentsRoutes, {
  publicBookingRouter,
} from "./routes/appointments.routes";
import flowsRoutes from "./routes/flows.routes";
import webhooksRoutes from "./routes/webhooks.routes";
import domainsRoutes from "./routes/domains.routes";
import walletsRoutes from "./routes/wallets.routes";
import apiKeysRoutes from "./routes/api-keys.routes";
import publicApiRoutes from "./routes/public-api.routes";
import providerRoutesRoutes from "./routes/provider-routes.routes";
import demoRoutes from "./routes/demo.routes";
import partnerRoutes from "./routes/partner.routes";
import flowTemplatesRoutes from "./routes/flow-templates.routes";
import whitelabelRoutes from "./routes/whitelabel.routes";
import knowledgeBaseRoutes from "./routes/knowledge-base.routes";
import aiAgentsRoutes from "./routes/ai-agents.routes";
import onboardingRoutes from "./routes/onboarding.routes";
import {
  startCampaignWorker,
  stopCampaignWorker,
} from "./services/campaign.service";
import {
  startAppointmentWorker,
  stopAppointmentWorker,
} from "./services/appointment.service";
import { startFlowWorker, stopFlowWorker } from "./services/flow/engine";
import { startSlaWorker, stopSlaWorker } from "./services/sla.service";
import {
  startWebhookWorker,
  stopWebhookWorker,
} from "./services/webhook.service";
import {
  startLeadFollowUpWorker,
  stopLeadFollowUpWorker,
} from "./services/leadFollowUp.service";
import {
  startWabaTokenExpiryWorker,
  stopWabaTokenExpiryWorker,
} from "./services/wabaTokenExpiry.service";
import {
  startKnowledgeBaseEmbeddingWorker,
  stopKnowledgeBaseEmbeddingWorker,
} from "./services/knowledgeBaseEmbedding.service";
import {
  startWalletReconciliationWorker,
  stopWalletReconciliationWorker,
} from "./services/walletReconciliation.service";
import {
  startWalletAlertsWorker,
  stopWalletAlertsWorker,
} from "./services/walletAlerts.service";

// Sentry init must run before any other module imports that throw, so
// keep this as the first stateful side-effect after env load.
initSentry();

const app: Express = express();
const PORT = process.env.PORT ?? 3001;
type AppMode = "api" | "worker" | "all";

function parseAppMode(value: string | undefined): AppMode {
  const fallback = process.env.NODE_ENV === "production" ? "api" : "all";
  if (!value) return fallback;
  if (value === "api" || value === "worker" || value === "all") return value;
  console.warn(`[startup] invalid APP_MODE=${value}; falling back to ${fallback}`);
  return fallback;
}

const APP_MODE = parseAppMode(process.env.APP_MODE);
const START_HTTP = APP_MODE === "api" || APP_MODE === "all";
const START_WORKERS = APP_MODE === "worker" || APP_MODE === "all";
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX ?? 300);
const PUBLIC_BOOKING_RATE_LIMIT_MAX = Number(
  process.env.PUBLIC_BOOKING_RATE_LIMIT_MAX ?? 20,
);

function getAllowedWebOrigins(): string[] {
  const origins = [
    process.env.WEB_URL ?? "http://localhost:3000",
    ...(process.env.WEB_ORIGINS ?? "").split(","),
  ];
  return Array.from(new Set(origins.map((origin) => origin.trim()).filter(Boolean)));
}

const allowedWebOrigins = getAllowedWebOrigins();

app.set("trust proxy", 1);
app.use(helmet());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    allowedWebOrigins.includes(origin) &&
    req.headers["access-control-request-private-network"] === "true"
  ) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

// RED metrics — runs before all route handlers so it captures every
// request, including 404s and rate-limited bounces.
app.use(httpMetricsMiddleware);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedWebOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);

// Meta webhook must accept raw JSON with no rate limiting; mount before
// the global rate limiter and before auth.
// The `verify` hook stashes the raw request body on req.rawBody so the
// Meta signature handler can recompute HMAC-SHA256 over the exact bytes
// Meta signed. This is the ONLY safe way to verify a signature behind
// express.json().
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use("/webhooks/whatsapp", webhookRouter);

// Public booking endpoints — no auth, so they need their own rate limit.
// 20 requests per IP per 15 minutes is plenty for legitimate bookings while
// blunting spam.
const publicBookingLimiter = redisRateLimit({
  name: "public-booking",
  windowMs: 15 * 60 * 1000,
  max: PUBLIC_BOOKING_RATE_LIMIT_MAX,
});
app.use("/public/booking", publicBookingLimiter, publicBookingRouter);

const apiLimiter = redisRateLimit({
  name: "api",
  windowMs: 15 * 60 * 1000,
  max: API_RATE_LIMIT_MAX,
});
app.use("/api/", apiLimiter);

app.use(authMiddleware);

app.get("/live", (_req: Request, res: Response) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", api: "NexaFlow AI v0.1.0", timestamp: new Date().toISOString() });
});
app.get(["/ready", "/api/v1/ready"], async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    pingRedis().then((ok) => {
      if (!ok) throw new Error("redis ping failed");
    }),
  ]);
  const services = [
    { name: "postgres", ok: checks[0].status === "fulfilled" },
    { name: "redis", ok: checks[1].status === "fulfilled" },
  ];
  const ready = services.every((service) => service.ok);
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    mode: APP_MODE,
    latencyMs: Date.now() - startedAt,
    services,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tenants", tenantsRoutes);
app.use("/api/v1/contacts", contactsRoutes);
app.use("/api/v1/leads", leadsRoutes);
app.use("/api/v1/templates", templatesRoutes);
app.use("/api/v1/campaigns", campaignsRoutes);
app.use("/api/v1/conversations", conversationsRoutes);
app.use("/api/v1/whatsapp", whatsappRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/canned-replies", cannedRepliesRoutes);
app.use("/api/v1/services", servicesRoutes);
app.use("/api/v1/appointments", appointmentsRoutes);
app.use("/api/v1/flows", flowsRoutes);
app.use("/api/v1/webhooks", webhooksRoutes);
app.use("/api/v1/domains", domainsRoutes);
app.use("/api/v1/wallets", walletsRoutes);
app.use("/api/v1/api-keys", apiKeysRoutes);
app.use("/api/v1/admin/provider-routes", providerRoutesRoutes);
app.use("/api/v1/partner", partnerRoutes);
app.use("/api/v1/partner/demo", demoRoutes);
app.use("/api/v1/partner/whitelabel", whitelabelRoutes);
app.use("/api/v1/flow-templates", flowTemplatesRoutes);
app.use("/api/v1/knowledge-base", knowledgeBaseRoutes);
app.use("/api/v1/ai-agents", aiAgentsRoutes);
app.use("/api/v1/onboarding", onboardingRoutes);
app.use("/api/public/v1", publicApiRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
});

app.use(errorHandler);

let server: ReturnType<Express["listen"]> | null = null;
let shuttingDown = false;

async function startWorkers(): Promise<void> {
  await startCampaignWorker();
  await startAppointmentWorker();
  await startFlowWorker();
  await startSlaWorker();
  await startWebhookWorker();
  await startLeadFollowUpWorker();
  await startWabaTokenExpiryWorker();
  await startKnowledgeBaseEmbeddingWorker();
  await startWalletReconciliationWorker();
  await startWalletAlertsWorker();
}

function stopWorkers(): void {
  stopCampaignWorker();
  stopAppointmentWorker();
  stopFlowWorker();
  stopSlaWorker();
  stopWebhookWorker();
  stopLeadFollowUpWorker();
  stopWabaTokenExpiryWorker();
  stopKnowledgeBaseEmbeddingWorker();
  stopWalletReconciliationWorker();
  stopWalletAlertsWorker();
}

if (START_HTTP) {
  server = app.listen(PORT, () => {
    console.log(`🚀 NexaFlow API listening on http://localhost:${PORT}`);
    console.log(`   Mode:          ${APP_MODE}`);
    console.log(`   Health:        http://localhost:${PORT}/api/v1/health`);
    console.log(`   Readiness:     http://localhost:${PORT}/api/v1/ready`);
    console.log(`   Webhook:       http://localhost:${PORT}/webhooks/whatsapp`);
    console.log(`   Auth:          /api/v1/auth/{signup,login,refresh,logout,me}`);
    console.log(`   Tenants:       /api/v1/tenants (SuperAdmin)`);
    console.log(`   Contacts:      /api/v1/contacts`);
    console.log(`   Campaigns:     /api/v1/campaigns`);
    console.log(`   AI Copy:       /api/v1/ai/copy`);
    console.log(`   Realtime:      ws://localhost:${PORT}/realtime`);
  });
  // Attach Socket.io once the HTTP server is bound. attachRealtime is
  // idempotent — calling it again is a no-op.
  void attachRealtime(server!);
}

if (START_WORKERS) {
  void startWorkers();
  if (!START_HTTP) {
    console.log("⚙️  NexaFlow worker process started");
    console.log(`   Mode: ${APP_MODE}`);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}`);
  stopWorkers();

  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });

  await closeRealtime();
  await closeQueues();
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    source: "unhandledRejection",
  });
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  captureException(error, { source: "uncaughtException" });
  process.exit(1);
});
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export default app;
