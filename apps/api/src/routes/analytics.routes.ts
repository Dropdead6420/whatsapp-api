import { Router, Response, NextFunction } from "express";
import { z } from "zod";
// Analytics is read-only; route through the replica when configured.
import {
  AnalyticsReportFrequency,
  AnalyticsReportType,
  prisma as prismaWrite,
  prismaRead as prisma,
} from "@nexaflow/db";
import {
  ApiError,
  CampaignStatus,
  ErrorCodes,
  LeadStatus,
  MessageStatus,
  Permissions,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission, requireRole } from "../middleware/rbac";
import { getTenantSendStats } from "../services/sendThrottle.service";
import {
  analyticsReportToCsv,
  buildAnalyticsReportSnapshot,
  computeNextReportRun,
  runAnalyticsReport,
} from "../services/analyticsReport.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth);

const reportSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.nativeEnum(AnalyticsReportType),
  frequency: z.nativeEnum(AnalyticsReportFrequency).default(AnalyticsReportFrequency.NONE),
  recipients: z.array(z.string().email()).max(10).default([]),
  rangeDays: z.number().int().min(1).max(365).default(30),
});

const reportUpdateSchema = reportSchema.partial();

const reportRunSchema = z.object({
  deliver: z.boolean().default(false),
});

function reportFilters(rangeDays?: number): string | undefined {
  if (rangeDays === undefined) return undefined;
  return JSON.stringify({ rangeDays });
}

function parseReportFilters(raw: string | null): { rangeDays: number } {
  if (!raw) return { rangeDays: 30 };
  try {
    const parsed = JSON.parse(raw) as { rangeDays?: unknown };
    return {
      rangeDays:
        typeof parsed.rangeDays === "number" && Number.isFinite(parsed.rangeDays)
          ? parsed.rangeDays
          : 30,
    };
  } catch {
    return { rangeDays: 30 };
  }
}

function serializeReport<T extends { filters: string | null }>(report: T) {
  return {
    ...report,
    filters: parseReportFilters(report.filters),
  };
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function normalizeCounts<T extends string>(
  keys: readonly T[],
  rows: Array<{
    status: string;
    _count?: boolean | { _all?: number };
  }>,
): Record<T, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const row of rows) {
    const count = typeof row._count === "object" ? row._count._all ?? 0 : 0;
    result[row.status as T] = count;
  }
  return result;
}

async function getPlatformSummary() {
  const today = startOfToday();
  const month = startOfMonth();

  const [
    tenants,
    activeTenants,
    contacts,
    campaigns,
    conversations,
    activeConversations,
    messagesToday,
    messagesMonth,
    aiUsage,
    subscriptions,
    campaignGroups,
  ] = await prisma.$transaction([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
    prisma.contact.count(),
    prisma.campaign.count(),
    prisma.conversation.count(),
    prisma.conversation.count({ where: { isActive: true } }),
    prisma.message.count({ where: { createdAt: { gte: today } } }),
    prisma.message.count({ where: { createdAt: { gte: month } } }),
    prisma.aiUsage.aggregate({
      where: { createdAt: { gte: month } },
      _sum: { inputTokens: true, outputTokens: true, costInCents: true },
    }),
    prisma.subscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE },
      select: { plan: { select: { priceInPaisa: true } } },
    }),
    prisma.campaign.groupBy({
      by: ["status"],
      orderBy: { status: "asc" },
      _count: { _all: true },
    }),
  ]);

  return {
    scope: "platform" as const,
    totals: {
      tenants,
      activeTenants,
      contacts,
      campaigns,
      conversations,
      activeConversations,
      messagesToday,
      messagesMonth,
      aiInputTokensThisMonth: aiUsage._sum.inputTokens ?? 0,
      aiOutputTokensThisMonth: aiUsage._sum.outputTokens ?? 0,
      aiCostInCentsThisMonth: aiUsage._sum.costInCents ?? 0,
      mrrInPaisa: subscriptions.reduce(
        (sum, subscription) => sum + subscription.plan.priceInPaisa,
        0,
      ),
    },
    campaignsByStatus: normalizeCounts(Object.values(CampaignStatus), campaignGroups),
  };
}

async function getTenantSummary(tenantId: string) {
  const today = startOfToday();
  const month = startOfMonth();
  const conversationWhere = { tenantId };
  const messageWhere = { conversation: conversationWhere };

  const [
    contacts,
    campaigns,
    conversations,
    activeConversations,
    leads,
    messagesToday,
    messagesMonth,
    sentMessages,
    deliveredMessages,
    readMessages,
    leadGroups,
    campaignGroups,
    aiUsage,
  ] = await prisma.$transaction([
    prisma.contact.count({ where: { tenantId } }),
    prisma.campaign.count({ where: { tenantId } }),
    prisma.conversation.count({ where: conversationWhere }),
    prisma.conversation.count({ where: { ...conversationWhere, isActive: true } }),
    prisma.lead.count({ where: { tenantId } }),
    prisma.message.count({
      where: { ...messageWhere, createdAt: { gte: today } },
    }),
    prisma.message.count({
      where: { ...messageWhere, createdAt: { gte: month } },
    }),
    prisma.message.count({
      where: { ...messageWhere, status: MessageStatus.SENT },
    }),
    prisma.message.count({
      where: { ...messageWhere, status: MessageStatus.DELIVERED },
    }),
    prisma.message.count({
      where: { ...messageWhere, status: MessageStatus.READ },
    }),
    prisma.lead.groupBy({
      by: ["status"],
      where: { tenantId },
      orderBy: { status: "asc" },
      _count: { _all: true },
    }),
    prisma.campaign.groupBy({
      by: ["status"],
      where: { tenantId },
      orderBy: { status: "asc" },
      _count: { _all: true },
    }),
    prisma.aiUsage.aggregate({
      where: { tenantId, createdAt: { gte: month } },
      _sum: { inputTokens: true, outputTokens: true, costInCents: true },
    }),
  ]);

  const sendStats = await getTenantSendStats(tenantId);

  return {
    scope: "tenant" as const,
    tenantId,
    totals: {
      contacts,
      campaigns,
      conversations,
      activeConversations,
      leads,
      messagesToday,
      messagesMonth,
      sentMessages,
      deliveredMessages,
      readMessages,
      aiInputTokensThisMonth: aiUsage._sum.inputTokens ?? 0,
      aiOutputTokensThisMonth: aiUsage._sum.outputTokens ?? 0,
      aiCostInCentsThisMonth: aiUsage._sum.costInCents ?? 0,
    },
    sendQuota: {
      monthlyUsed: sendStats.monthlyUsed,
      monthlyQuota: sendStats.monthlyQuota,
      perSecondLimit: sendStats.perSecondLimit,
      percentUsed: Math.round(
        (sendStats.monthlyUsed / Math.max(1, sendStats.monthlyQuota)) * 100,
      ),
    },
    leadsByStatus: normalizeCounts(Object.values(LeadStatus), leadGroups),
    campaignsByStatus: normalizeCounts(Object.values(CampaignStatus), campaignGroups),
  };
}

const reportMiddleware = [
  requireTenantScope,
  requireRole(UserRole.BUSINESS_ADMIN, UserRole.TEAM_LEAD),
  requirePermission(Permissions.CONTACT_READ),
];

router.get(
  "/reports",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const reports = await prismaWrite.analyticsReport.findMany({
        where: { tenantId: req.tenantId! },
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      res.json({ success: true, data: reports.map(serializeReport) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/reports",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = reportSchema.parse(req.body);
      const report = await prismaWrite.analyticsReport.create({
        data: {
          tenantId: req.tenantId!,
          createdById: req.userId!,
          name: body.name,
          type: body.type,
          frequency: body.frequency,
          recipients: body.recipients,
          filters: reportFilters(body.rangeDays),
          nextRunAt: computeNextReportRun(body.frequency),
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "AnalyticsReport",
        resourceId: report.id,
        newValues: {
          name: report.name,
          type: report.type,
          frequency: report.frequency,
          recipients: report.recipients,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: serializeReport(report) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/reports/:id",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = reportUpdateSchema.parse(req.body);
      const existing = await prismaWrite.analyticsReport.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
      }

      const frequency = body.frequency ?? existing.frequency;
      const report = await prismaWrite.analyticsReport.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          type: body.type,
          frequency: body.frequency,
          recipients: body.recipients,
          filters: reportFilters(body.rangeDays),
          nextRunAt:
            body.frequency !== undefined
              ? computeNextReportRun(frequency)
              : undefined,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AnalyticsReport",
        resourceId: report.id,
        oldValues: {
          name: existing.name,
          type: existing.type,
          frequency: existing.frequency,
          recipients: existing.recipients,
        },
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: serializeReport(report) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/reports/:id",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prismaWrite.analyticsReport.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
      }
      await prismaWrite.analyticsReport.delete({ where: { id: existing.id } });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "AnalyticsReport",
        resourceId: existing.id,
        oldValues: {
          name: existing.name,
          type: existing.type,
          frequency: existing.frequency,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/reports/:id/run",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = reportRunSchema.parse(req.body);
      const snapshot = await runAnalyticsReport({
        reportId: req.params.id,
        tenantId: req.tenantId!,
        deliver: body.deliver,
      });
      res.json({ success: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/reports/:id/export.csv",
  ...reportMiddleware,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const report = await prismaWrite.analyticsReport.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });
      if (!report) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
      }
      const snapshot = await buildAnalyticsReportSnapshot({
        tenantId: report.tenantId,
        type: report.type,
        filters: report.filters,
      });
      const filename = `${report.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "report"}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(analyticsReportToCsv(snapshot));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/summary",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (req.userRole === UserRole.SUPER_ADMIN) {
        const summary = await getPlatformSummary();
        res.json({ success: true, data: summary });
        return;
      }

      if (!req.tenantId) {
        throw new ApiError(
          ErrorCodes.MULTI_TENANT_VIOLATION,
          400,
          "Tenant context required for analytics.",
        );
      }

      const summary = await getTenantSummary(req.tenantId);
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
