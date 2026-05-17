import { Router, Response, NextFunction } from "express";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  CampaignStatus,
  ErrorCodes,
  LeadStatus,
  MessageStatus,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { getTenantSendStats } from "../services/sendThrottle.service";

const router = Router();
router.use(requireAuth);

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
