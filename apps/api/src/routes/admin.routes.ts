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
  getSlaQueue,
  getWebhookQueue,
  queueDepth,
} from "../lib/queue";
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

// GET /api/v1/admin/queues — BullMQ depth snapshot for SuperAdmin observability.
router.get(
  "/queues",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const queues = [
        getCampaignQueue(),
        getAppointmentQueue(),
        getFlowQueue(),
        getSlaQueue(),
        getWebhookQueue(),
        getLeadFollowUpQueue(),
      ];
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

export default router;
