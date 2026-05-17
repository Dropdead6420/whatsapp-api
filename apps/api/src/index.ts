import "dotenv/config";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";
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
import { startCampaignWorker } from "./services/campaign.service";
import { startAppointmentWorker } from "./services/appointment.service";
import { startFlowWorker } from "./services/flow/engine";
import { startSlaWorker } from "./services/sla.service";
import { startWebhookWorker } from "./services/webhook.service";
import { startLeadFollowUpWorker } from "./services/leadFollowUp.service";

const app: Express = express();
const PORT = process.env.PORT ?? 3001;

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

// Meta webhook must accept raw JSON with no rate limiting; mount before
// the global rate limiter and before auth.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/webhooks/whatsapp", webhookRouter);

// Public booking endpoints — no auth, so they need their own rate limit.
// 20 requests per IP per 15 minutes is plenty for legitimate bookings while
// blunting spam.
const publicBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "TOO_MANY_REQUESTS", message: "Too many booking requests." },
  },
});
app.use("/public/booking", publicBookingLimiter, publicBookingRouter);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." } },
});
app.use("/api/", apiLimiter);

app.use(authMiddleware);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", api: "NexaFlow AI v0.1.0", timestamp: new Date().toISOString() });
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

app.listen(PORT, () => {
  console.log(`🚀 NexaFlow API listening on http://localhost:${PORT}`);
  console.log(`   Health:        http://localhost:${PORT}/api/v1/health`);
  console.log(`   Webhook:       http://localhost:${PORT}/webhooks/whatsapp`);
  console.log(`   Auth:          /api/v1/auth/{signup,login,refresh,logout,me}`);
  console.log(`   Tenants:       /api/v1/tenants (SuperAdmin)`);
  console.log(`   Contacts:      /api/v1/contacts`);
  console.log(`   Campaigns:     /api/v1/campaigns`);
  console.log(`   AI Copy:       /api/v1/ai/copy`);
  void startCampaignWorker();
  void startAppointmentWorker();
  void startFlowWorker();
  void startSlaWorker();
  void startWebhookWorker();
  void startLeadFollowUpWorker();
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

export default app;
