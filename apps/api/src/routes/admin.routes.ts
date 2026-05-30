import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma, prismaRead } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  SubscriptionStatus,
  UserRole,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { pingRedis } from "../lib/redis";
import {
  getAppointmentQueue,
  getCampaignQueue,
  getFlowQueue,
  getLeadFollowUpQueue,
  getKnowledgeBaseEmbeddingQueue,
  getSlaQueue,
  getWabaTokenExpiryQueue,
  getWalletReconciliationQueue,
  getWebhookQueue,
  queueDepth,
} from "../lib/queue";
import {
  reconcileAllWallets,
  reconcileWallet,
} from "../services/walletReconciliation.service";
import {
  runComplianceAuditor,
  runPlatformMonitor,
  runRevenueIntelligence,
  runSupportCopilot,
} from "../services/ai.service";
import { metricsRegistry } from "../lib/observability";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  ALL_FEATURES,
  FEATURE_LABELS,
  getTenantFeatures,
  setTenantFeatures,
  type FeatureKey,
} from "../services/features.service";

const router = Router();

const planUpdateSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  priceInPaisa: z.number().int().nonnegative().optional(),
  billingCycle: z.string().min(1).max(30).optional(),
  messageQuota: z.number().int().positive().optional(),
  contactLimit: z.number().int().positive().optional(),
  agentLimit: z.number().int().positive().optional(),
  aiCreditsPerMonth: z.number().int().nonnegative().optional(),
  campaignLimit: z.number().int().positive().optional(),
  chatbotEnabled: z.boolean().optional(),
  adsIntegrationEnabled: z.boolean().optional(),
  creativeStudioEnabled: z.boolean().optional(),
  apiAccessEnabled: z.boolean().optional(),
});

const subscriptionCreateSchema = z.object({
  tenantId: z.string().cuid(),
  planId: z.string().cuid(),
  status: z.nativeEnum(SubscriptionStatus).default(SubscriptionStatus.ACTIVE),
  currentPeriodStart: z.coerce.date().optional(),
  currentPeriodEnd: z.coerce.date().optional(),
});

const subscriptionUpdateSchema = z.object({
  planId: z.string().cuid().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  currentPeriodEnd: z.coerce.date().optional(),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  tenantId: z.string().cuid().optional(),
  action: z.string().trim().min(1).max(40).optional(),
  resource: z.string().trim().min(1).max(80).optional(),
});

router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const queueCleanSchema = z.object({
  state: z.enum(["failed", "completed"]).default("failed"),
  graceHours: z.coerce.number().min(0).max(24 * 30).default(0),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const queueRetrySchema = z.object({
  count: z.coerce.number().int().min(1).max(1000).default(100),
});

const queueFailedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function getManagedQueues() {
  return [
    getCampaignQueue(),
    getAppointmentQueue(),
    getFlowQueue(),
    getSlaQueue(),
    getWebhookQueue(),
    getLeadFollowUpQueue(),
    getWabaTokenExpiryQueue(),
    getKnowledgeBaseEmbeddingQueue(),
    getWalletReconciliationQueue(),
  ];
}

function getManagedQueue(name: string) {
  const queue = getManagedQueues().find((item) => item.name === name);
  if (!queue) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, `Queue ${name} not found.`);
  }
  return queue;
}

function previewJson(value: unknown, maxLength = 1200): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return "";
    return text.length > maxLength
      ? `${text.slice(0, maxLength)}\n... truncated`
      : text;
  } catch {
    return "[unserializable]";
  }
}

async function checkService(
  name: string,
  check: () => Promise<unknown>,
): Promise<{ name: string; status: "ok" | "error"; latencyMs: number; detail?: string }> {
  const startedAt = Date.now();
  try {
    await check();
    return { name, status: "ok", latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      name,
      status: "error",
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : "Unknown service error",
    };
  }
}

// GET /api/v1/admin/health
router.get("/health", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const elasticsearchUrl =
      process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";
    const services = await Promise.all([
      checkService("api", async () => true),
      checkService("postgres", async () => prisma.$queryRaw`SELECT 1`),
      checkService("redis", async () => {
        const ok = await pingRedis();
        if (!ok) throw new Error("redis ping failed");
      }),
      checkService("elasticsearch", async () => {
        const response = await fetch(`${elasticsearchUrl}/_cluster/health`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      }),
    ]);

    const overall = services.every((service) => service.status === "ok")
      ? "ok"
      : "degraded";

    res.json({
      success: true,
      data: {
        overall,
        checkedAt: new Date().toISOString(),
        services,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/metrics — Prometheus scrape endpoint. SuperAdmin only.
// Returns prom-client text exposition; the body is large, so this route
// bypasses the JSON shape.
router.get(
  "/metrics",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Content-Type", metricsRegistry.contentType);
      res.send(await metricsRegistry.metrics());
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/queues — BullMQ depth snapshot for SuperAdmin observability.
router.get(
  "/queues",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const queues = getManagedQueues();
      const rows = await Promise.all(
        queues.map(async (q) => ({ name: q.name, ...(await queueDepth(q)) })),
      );
      res.json({
        success: true,
        data: {
          checkedAt: new Date().toISOString(),
          queues: rows,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/queues/:name/failed — recent failed jobs for debugging.
router.get(
  "/queues/:name/failed",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = queueFailedQuerySchema.parse(req.query);
      const queue = getManagedQueue(req.params.name);
      const jobs = await queue.getJobs("failed", 0, query.limit - 1, false);
      res.json({
        success: true,
        data: {
          queue: queue.name,
          checkedAt: new Date().toISOString(),
          jobs: jobs.filter(Boolean).map((job) => ({
            id: job.id ?? "",
            name: job.name,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts ?? null,
            failedReason: job.failedReason ?? null,
            timestamp: job.timestamp
              ? new Date(job.timestamp).toISOString()
              : null,
            processedOn: job.processedOn
              ? new Date(job.processedOn).toISOString()
              : null,
            finishedOn: job.finishedOn
              ? new Date(job.finishedOn).toISOString()
              : null,
            dataPreview: previewJson(job.data),
            stacktrace: (job.stacktrace ?? []).slice(0, 3).map((line) =>
              line.length > 1200 ? `${line.slice(0, 1200)}... truncated` : line,
            ),
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/queues/:name/jobs/:jobId/retry — retry one failed job.
router.post(
  "/queues/:name/jobs/:jobId/retry",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const queue = getManagedQueue(req.params.name);
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Queue job not found.");
      }

      await job.retry("failed");

      if (req.tenantId) {
        await logAudit({
          tenantId: req.tenantId,
          userId: req.userId!,
          action: "UPDATE",
          resource: "QueueJob",
          resourceId: job.id ?? req.params.jobId,
          newValues: {
            queue: queue.name,
            jobId: job.id,
            action: "retry_one",
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({
        success: true,
        data: {
          queue: queue.name,
          jobId: job.id,
          retried: true,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/admin/queues/:name/jobs/:jobId — remove one failed job.
router.delete(
  "/queues/:name/jobs/:jobId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const queue = getManagedQueue(req.params.name);
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Queue job not found.");
      }

      await job.remove({ removeChildren: true });

      if (req.tenantId) {
        await logAudit({
          tenantId: req.tenantId,
          userId: req.userId!,
          action: "DELETE",
          resource: "QueueJob",
          resourceId: job.id ?? req.params.jobId,
          oldValues: {
            queue: queue.name,
            jobId: job.id,
            name: job.name,
            failedReason: job.failedReason,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({
        success: true,
        data: {
          queue: queue.name,
          jobId: job.id,
          removed: true,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/queues/:name/clean — remove old failed/completed jobs.
router.post(
  "/queues/:name/clean",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = queueCleanSchema.parse(req.body);
      const queue = getManagedQueue(req.params.name);
      const removedIds = await queue.clean(
        body.graceHours * 60 * 60 * 1000,
        body.limit,
        body.state,
      );

      if (req.tenantId) {
        await logAudit({
          tenantId: req.tenantId,
          userId: req.userId!,
          action: "DELETE",
          resource: "QueueJob",
          resourceId: queue.name,
          newValues: {
            queue: queue.name,
            state: body.state,
            graceHours: body.graceHours,
            limit: body.limit,
            removed: removedIds.length,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({
        success: true,
        data: {
          queue: queue.name,
          state: body.state,
          removed: removedIds.length,
          removedIds: removedIds.slice(0, 25),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/queues/:name/retry-failed — move failed jobs back to wait.
router.post(
  "/queues/:name/retry-failed",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = queueRetrySchema.parse(req.body);
      const queue = getManagedQueue(req.params.name);
      await queue.retryJobs({ state: "failed", count: body.count });

      if (req.tenantId) {
        await logAudit({
          tenantId: req.tenantId,
          userId: req.userId!,
          action: "UPDATE",
          resource: "QueueJob",
          resourceId: queue.name,
          newValues: {
            queue: queue.name,
            action: "retry_failed",
            count: body.count,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({
        success: true,
        data: {
          queue: queue.name,
          retriedUpTo: body.count,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/audit-logs
router.get(
  "/audit-logs",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = auditQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};
      if (q.tenantId) where.tenantId = q.tenantId;
      if (q.action) where.action = q.action;
      if (q.resource) where.resource = q.resource;

      const [total, items] = await prismaRead.$transaction([
        prismaRead.auditLog.count({ where }),
        prismaRead.auditLog.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: {
            tenant: { select: { id: true, name: true, type: true } },
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          items,
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// T-023: wallet reconciliation. The scheduled worker runs every 6h on
// its own; these endpoints let a SuperAdmin trigger an ad-hoc check
// (after a suspected billing incident) or query recent drift events.

// POST /api/v1/admin/wallet-reconciliation/run — fires the same logic
// the worker runs. Synchronous, returns the full summary in the
// response so an operator sees results without tailing logs.
router.post(
  "/wallet-reconciliation/run",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const summary = await reconcileAllWallets();
      await logAudit({
        tenantId: req.tenantId ?? "platform",
        userId: req.userId!,
        action: "RUN_RECONCILIATION",
        resource: "Platform",
        newValues: {
          scanned: summary.scanned,
          clean: summary.clean,
          drifted: summary.drifted,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/wallet-reconciliation/run/:walletId — reconcile
// one wallet (e.g. for a suspected debit race). Read-only; never
// mutates the wallet.
router.post(
  "/wallet-reconciliation/run/:walletId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const result = await reconcileWallet(req.params.walletId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/wallet-reconciliation/drifts — recent drift events
// from AuditLog. Default to last 50; supports ?limit query param.
router.get(
  "/wallet-reconciliation/drifts",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        500,
        Math.max(1, Number(req.query.limit ?? 50)),
      );
      const rows = await prisma.auditLog.findMany({
        where: { action: "RECONCILIATION_DRIFT" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          tenantId: true,
          resourceId: true,
          newValues: true,
          createdAt: true,
        },
      });
      const drifts = rows.map((r) => {
        let details: unknown = null;
        try {
          details = r.newValues ? JSON.parse(r.newValues) : null;
        } catch {
          /* corrupt JSON in audit log — surface the raw string */
          details = r.newValues;
        }
        return {
          auditId: r.id,
          tenantId: r.tenantId,
          walletId: r.resourceId,
          detectedAt: r.createdAt,
          details,
        };
      });
      res.json({ success: true, data: { drifts } });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// T-053: SuperAdmin AI suite
//
// Four assistants. Each takes a structured snapshot the caller assembled
// from existing services and returns analysis. The SuperAdmin tenantId is
// used as the billing tenant for the LLM calls. Permission guard is the
// `requireRole(SUPER_ADMIN)` already applied to this whole router.
// ---------------------------------------------------------------------------

const PLATFORM_TENANT_ID = "__platform__";

const platformMonitorSchema = z.object({
  totals: z.object({
    tenants: z.number().int().nonnegative(),
    activeTenants: z.number().int().nonnegative(),
    messagesPerHour: z.number().nonnegative(),
    failedSendsPerHour: z.number().nonnegative(),
    p95LatencyMs: z.number().nonnegative(),
    redisQueueDepth: z.number().nonnegative(),
    p95DbLatencyMs: z.number().nonnegative().optional(),
    errorRatePct: z.number().nonnegative().optional(),
  }),
  anomalies: z
    .array(z.object({ kind: z.string(), detail: z.string() }))
    .optional(),
});

router.post(
  "/ai/platform-monitor",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = platformMonitorSchema.parse(req.body);
      const result = await runPlatformMonitor(PLATFORM_TENANT_ID, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

const complianceAuditorSchema = z.object({
  samples: z
    .array(
      z.object({
        tenantId: z.string(),
        text: z.string().min(1).max(2000),
        category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "REPLY"]),
      }),
    )
    .min(1)
    .max(25),
});

router.post(
  "/ai/compliance-audit",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = complianceAuditorSchema.parse(req.body);
      const result = await runComplianceAuditor(PLATFORM_TENANT_ID, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

const supportCopilotSchema = z.object({
  question: z.string().min(1).max(4000),
  context: z.string().max(4000).optional(),
  tenantId: z.string().optional(),
});

router.post(
  "/ai/support-copilot",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = supportCopilotSchema.parse(req.body);
      const result = await runSupportCopilot(PLATFORM_TENANT_ID, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

const revenueIntelligenceSchema = z.object({
  mrrInPaisa: z.number().int().nonnegative(),
  arpuInPaisa: z.number().int().nonnegative(),
  newTenantsThisMonth: z.number().int().nonnegative(),
  churnedTenantsThisMonth: z.number().int().nonnegative(),
  expansionTenants: z.number().int().nonnegative(),
  contractionTenants: z.number().int().nonnegative(),
  topRevenueTenants: z
    .array(
      z.object({
        tenantId: z.string(),
        monthlyPaisa: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  topAtRiskTenants: z
    .array(z.object({ tenantId: z.string(), reason: z.string() }))
    .optional(),
});

router.post(
  "/ai/revenue-intelligence",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = revenueIntelligenceSchema.parse(req.body);
      const result = await runRevenueIntelligence(PLATFORM_TENANT_ID, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/billing
router.get("/billing", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const [plans, subscriptions] = await prisma.$transaction([
      prisma.plan.findMany({
        orderBy: [{ priceInPaisa: "asc" }, { name: "asc" }],
        include: { _count: { select: { subscriptions: true } } },
      }),
      prisma.subscription.findMany({
        take: 100,
        orderBy: { updatedAt: "desc" },
        include: {
          plan: true,
          tenant: { select: { id: true, name: true, type: true, status: true } },
        },
      }),
    ]);

    const activeMrrInPaisa = subscriptions.reduce((sum, subscription) => {
      if (subscription.status !== SubscriptionStatus.ACTIVE) return sum;
      return sum + subscription.plan.priceInPaisa;
    }, 0);

    res.json({
      success: true,
      data: {
        plans,
        subscriptions,
        metrics: {
          activeSubscriptions: subscriptions.filter(
            (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
          ).length,
          activeMrrInPaisa,
          planCount: plans.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/admin/plans/:id
router.patch(
  "/plans/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = planUpdateSchema.parse(req.body);
      const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Plan not found.");
      }

      const updated = await prisma.plan.update({
        where: { id: req.params.id },
        data: body,
      });

      if (req.tenantId) {
        await logAudit({
          tenantId: req.tenantId,
          userId: req.userId!,
          action: "UPDATE",
          resource: "Plan",
          resourceId: updated.id,
          oldValues: {
            name: existing.name,
            priceInPaisa: existing.priceInPaisa,
            messageQuota: existing.messageQuota,
          },
          newValues: body,
          ...extractRequestMeta(req),
        });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/subscriptions
router.post(
  "/subscriptions",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = subscriptionCreateSchema.parse(req.body);
      const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
      if (!tenant) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
      }
      const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
      if (!plan) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Plan not found.");
      }

      const start = body.currentPeriodStart ?? new Date();
      const end =
        body.currentPeriodEnd ??
        new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());

      const subscription = await prisma.subscription.create({
        data: {
          tenantId: body.tenantId,
          planId: body.planId,
          status: body.status,
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
        include: {
          plan: true,
          tenant: { select: { id: true, name: true, type: true, status: true } },
        },
      });

      await logAudit({
        tenantId: body.tenantId,
        userId: req.userId!,
        action: "CREATE",
        resource: "Subscription",
        resourceId: subscription.id,
        newValues: {
          planName: plan.name,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: subscription });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/subscriptions/:id
router.patch(
  "/subscriptions/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = subscriptionUpdateSchema.parse(req.body);
      const existing = await prisma.subscription.findUnique({
        where: { id: req.params.id },
        include: { plan: true },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Subscription not found.");
      }

      const updated = await prisma.subscription.update({
        where: { id: req.params.id },
        data: body,
        include: {
          plan: true,
          tenant: { select: { id: true, name: true, type: true, status: true } },
        },
      });

      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Subscription",
        resourceId: updated.id,
        oldValues: {
          planName: existing.plan.name,
          status: existing.status,
          currentPeriodEnd: existing.currentPeriodEnd,
        },
        newValues: body,
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Feature flags (SuperAdmin only)
// ----------------------------------------------------------------------------

router.get("/features/registry", (_req, res) => {
  res.json({
    success: true,
    data: ALL_FEATURES.map((key) => ({ key, label: FEATURE_LABELS[key] })),
  });
});

router.get(
  "/tenants/:id/features",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true },
      });
      if (!tenant) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
      }
      const features = await getTenantFeatures(tenant.id);
      res.json({ success: true, data: { tenant, features } });
    } catch (err) {
      next(err);
    }
  },
);

const featuresPatchSchema = z.object({
  features: z.record(z.boolean()),
});

router.patch(
  "/tenants/:id/features",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = featuresPatchSchema.parse(req.body);
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!tenant) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
      }
      // Reject unknown keys to avoid silently storing junk.
      const validKeys = new Set<string>(ALL_FEATURES);
      const updates: Partial<Record<FeatureKey, boolean>> = {};
      for (const [k, v] of Object.entries(body.features)) {
        if (validKeys.has(k)) updates[k as FeatureKey] = v;
      }
      const features = await setTenantFeatures(tenant.id, updates);
      await logAudit({
        tenantId: tenant.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Tenant.features",
        resourceId: tenant.id,
        newValues: updates,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: { features } });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Wallet Risk — portfolio view for SuperAdmin (PRD-v2 §8, Sprint 2 slice 2).
// Returns the latest WalletRiskAssessment per tenant, severity-first sorted.
// Optional ?tier=CRITICAL|URGENT|WATCH|OK filter.
// ----------------------------------------------------------------------------

router.get(
  "/wallet-risk",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const tier = req.query.tier as string | undefined;
      const validTiers = new Set(["OK", "WATCH", "URGENT", "CRITICAL"]);
      const tierFilter =
        tier && validTiers.has(tier)
          ? { riskTier: tier as "OK" | "WATCH" | "URGENT" | "CRITICAL" }
          : {};

      // groupBy gives us the freshest assessedAt per tenant; join back
      // pulls the row + tenant name. Uses the (tenantId, assessedAt desc)
      // index we already have on the table.
      // Prisma requires orderBy when `take` is set on a groupBy. Order
      // by the latest assessment per tenant; bounded to 500 tenants per
      // request which is fine for the portfolio view (paginate in slice 3).
      const newest = await prisma.walletRiskAssessment.groupBy({
        by: ["tenantId"],
        _max: { assessedAt: true },
        where: tierFilter,
        orderBy: { _max: { assessedAt: "desc" } },
        take: 500,
      });

      const pairs = newest
        .map((row) => ({
          tenantId: row.tenantId,
          assessedAt: row._max.assessedAt,
        }))
        .filter((p): p is { tenantId: string; assessedAt: Date } =>
          p.assessedAt !== null,
        );

      if (pairs.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      const rows = await prisma.walletRiskAssessment.findMany({
        where: {
          OR: pairs.map((p) => ({
            tenantId: p.tenantId,
            assessedAt: p.assessedAt,
          })),
        },
        include: { tenant: { select: { id: true, name: true } } },
      });

      // Severity-first ordering: CRITICAL → URGENT → WATCH → OK. Ties
      // broken by stale-first so the operator naturally works the
      // longest-untouched at the top of the list.
      const TIER_ORDER = ["CRITICAL", "URGENT", "WATCH", "OK"];
      rows.sort((a, b) => {
        const aIdx = TIER_ORDER.indexOf(a.riskTier);
        const bIdx = TIER_ORDER.indexOf(b.riskTier);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.assessedAt.getTime() - b.assessedAt.getTime();
      });

      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
