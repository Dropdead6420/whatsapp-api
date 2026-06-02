import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma, prismaRead } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  Permissions,
  PlanName,
  SubscriptionStatus,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();

const planRequestSchema = z
  .object({
    planId: z.string().cuid().optional(),
    planName: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => value.planId || value.planName, {
    message: "planId or planName is required.",
  });

function normalizePlanName(value: string | undefined): PlanName | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return Object.values(PlanName).includes(normalized as PlanName)
    ? (normalized as PlanName)
    : null;
}

function planFeatures(plan: {
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}): string[] {
  const items = [
    `${plan.messageQuota.toLocaleString("en-IN")} WhatsApp messages / month`,
    `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
    `${plan.agentLimit.toLocaleString("en-IN")} team ${
      plan.agentLimit === 1 ? "seat" : "seats"
    }`,
    `${plan.campaignLimit.toLocaleString("en-IN")} campaigns / month`,
    `${plan.aiCreditsPerMonth.toLocaleString("en-IN")} AI credits / month`,
  ];
  if (plan.chatbotEnabled) items.push("Chatbot and workflow automation");
  if (plan.creativeStudioEnabled) items.push("AI creative studio");
  if (plan.adsIntegrationEnabled) items.push("Ads integrations");
  if (plan.apiAccessEnabled) items.push("API and developer access");
  return items;
}

function publicPlan(plan: Awaited<ReturnType<typeof prismaRead.plan.findFirst>>) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    description: plan.description,
    priceInPaisa: plan.priceInPaisa,
    billingCycle: plan.billingCycle,
    messageQuota: plan.messageQuota,
    contactLimit: plan.contactLimit,
    agentLimit: plan.agentLimit,
    aiCreditsPerMonth: plan.aiCreditsPerMonth,
    campaignLimit: plan.campaignLimit,
    chatbotEnabled: plan.chatbotEnabled,
    adsIntegrationEnabled: plan.adsIntegrationEnabled,
    creativeStudioEnabled: plan.creativeStudioEnabled,
    apiAccessEnabled: plan.apiAccessEnabled,
    features: planFeatures(plan),
  };
}

async function findRequestedPlan(input: { planId?: string; planName?: string }) {
  const requestedEnum = normalizePlanName(input.planName);
  return prisma.plan.findFirst({
    where: {
      OR: [
        ...(input.planId ? [{ id: input.planId }] : []),
        ...(requestedEnum ? [{ name: requestedEnum }] : []),
        ...(input.planName
          ? [
              {
                displayName: {
                  equals: input.planName,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
  });
}

router.use(requireAuth, requireTenantScope, requirePermission(Permissions.BILLING_VIEW));

// GET /api/v1/billing
// Tenant-scoped billing snapshot for business users. Plan rows are the same
// SuperAdmin-managed catalog shown publicly, so pricing edits reflect here too.
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const [tenant, currentSubscription, plans] = await Promise.all([
      prismaRead.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          messageQuotaPerMonth: true,
          contactLimit: true,
          agentLimit: true,
          aiCreditsPerMonth: true,
          campaignLimit: true,
        },
      }),
      prismaRead.subscription.findFirst({
        where: { tenantId, status: SubscriptionStatus.ACTIVE },
        orderBy: { updatedAt: "desc" },
        include: { plan: true },
      }),
      prismaRead.plan.findMany({
        orderBy: [{ priceInPaisa: "asc" }, { name: "asc" }],
      }),
    ]);

    if (!tenant) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
    }

    res.json({
      success: true,
      data: {
        tenant,
        currentSubscription: currentSubscription
          ? {
              id: currentSubscription.id,
              status: currentSubscription.status,
              currentPeriodStart: currentSubscription.currentPeriodStart,
              currentPeriodEnd: currentSubscription.currentPeriodEnd,
              plan: publicPlan(currentSubscription.plan),
            }
          : null,
        plans: plans.map(publicPlan).filter(Boolean),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/billing/plan-change-requests
// Captures an upgrade/change request for SuperAdmin review. It deliberately
// does not mutate subscriptions or wallet/payment state.
router.post(
  "/plan-change-requests",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = planRequestSchema.parse(req.body);
      const tenantId = req.tenantId!;
      const requestedPlan = await findRequestedPlan(body);
      if (!requestedPlan) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Requested plan not found.");
      }

      const currentSubscription = await prisma.subscription.findFirst({
        where: { tenantId, status: SubscriptionStatus.ACTIVE },
        orderBy: { updatedAt: "desc" },
        include: { plan: true },
      });

      const alreadyActive = currentSubscription?.planId === requestedPlan.id;
      if (!alreadyActive) {
        await logAudit({
          tenantId,
          userId: req.userId!,
          action: "BILLING_PLAN_REQUEST",
          resource: "Subscription",
          resourceId: currentSubscription?.id ?? tenantId,
          oldValues: currentSubscription
            ? {
                planId: currentSubscription.planId,
                planName: currentSubscription.plan.name,
                displayName: currentSubscription.plan.displayName,
              }
            : null,
          newValues: {
            requestedPlanId: requestedPlan.id,
            requestedPlanName: requestedPlan.name,
            requestedDisplayName: requestedPlan.displayName,
            priceInPaisa: requestedPlan.priceInPaisa,
            billingCycle: requestedPlan.billingCycle,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({
        success: true,
        data: {
          status: alreadyActive ? "already_active" : "requested",
          requestedPlan: publicPlan(requestedPlan),
          currentSubscription: currentSubscription
            ? {
                id: currentSubscription.id,
                status: currentSubscription.status,
                currentPeriodEnd: currentSubscription.currentPeriodEnd,
                plan: publicPlan(currentSubscription.plan),
              }
            : null,
          message: alreadyActive
            ? `${requestedPlan.displayName} is already active for this tenant.`
            : `Plan change requested for ${requestedPlan.displayName}. The platform admin can activate it from Billing.`,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
