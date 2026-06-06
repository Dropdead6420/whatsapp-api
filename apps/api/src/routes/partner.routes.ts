import crypto from "node:crypto";
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  Permissions,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission, requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { authService } from "../services/auth.service";
import { sendEmail } from "../services/email.service";
import {
  getPartnerTicket,
  listPartnerTickets,
  partnerReplyToTicket,
  updatePartnerTicket,
} from "../services/supportTicket.service";
import { suggestTicketReply } from "../services/aiSupportResolver.service";
import {
  SupportTicketPriority,
  SupportTicketStatus,
  CreditSource,
  PartnerModel,
  ProductAccessSource,
  ProviderOwnership,
  SubscriptionStatus,
} from "@nexaflow/db";
import {
  assertValidPartnerModelConfig,
  defaultCustomerConfigFor,
} from "../services/partnerModel.service";
import {
  listPartnerCustomerHealth,
  runPartnerAssistantSummary,
} from "../services/customerHealth.service";
import { runRevenueAutopilot } from "../services/revenueAutopilot.service";
import {
  resolveIndustryPack,
  seedStarterTemplatesAndCampaign,
  sendInviteEmail,
  type CustomerIndustry,
} from "../services/customerProvisioning.service";
import {
  listPartnerDomainHealth,
  scanDomainHealth,
  explainDomainError,
  getLastDomainHealthScan,
} from "../services/domainHealth.service";
import {
  DEFAULT_PARTNER_MARGIN_BPS,
  summarizePartnerBilling,
} from "../services/partnerDashboard.service";
import { publicPlan } from "../services/planCatalog.service";
import {
  assertPartnerCanGrantProduct,
  assertPartnerOwnsCustomer,
} from "../services/productAccess.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireRole(UserRole.WHITE_LABEL_ADMIN),
);

async function assertPartnerTenant(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, type: TenantType.WHITE_LABEL, status: TenantStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      partnerModel: true,
      partnerMarginEnabled: true,
    },
  });
  if (!tenant) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Partner portal requires an active white-label tenant.",
    );
  }
  return tenant;
}

function childTenantWhere(partnerTenantId: string) {
  return {
    parentTenantId: partnerTenantId,
    type: TenantType.BUSINESS,
  };
}

function accessStillActive(access: { expiresAt?: Date | null } | null | undefined) {
  return !access?.expiresAt || access.expiresAt.getTime() > Date.now();
}

function jsonInput(value: unknown):
  | Prisma.NullableJsonNullValueInput
  | Prisma.InputJsonValue
  | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function generateTemporaryPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const required = ["N", "f", "7", "!"];
  const random = Array.from({ length: 12 }, () => {
    const index = crypto.randomInt(0, alphabet.length);
    return alphabet[index];
  });
  const chars = [...required, ...random];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function sendCustomerAdminResetEmail(args: {
  toEmail: string;
  toName: string;
  customerWorkspaceName: string;
  loginUrl: string;
  temporaryPassword: string;
  tenantId: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: args.toEmail,
      subject: `Admin access reset for ${args.customerWorkspaceName}`,
      tenantId: args.tenantId,
      text:
        `Hi ${args.toName},\n\n` +
        `Your admin access for "${args.customerWorkspaceName}" was reset by your partner workspace.\n\n` +
        `Sign in: ${args.loginUrl}\n` +
        `Temporary password: ${args.temporaryPassword}\n\n` +
        "Please sign in and change this password immediately.\n",
    });
  } catch (err) {
    console.warn(
      "[partner] customer admin reset email failed (non-fatal):",
      (err as Error).message,
    );
  }
}

function countsByTenant<T extends { tenantId: string }>(
  rows: T[],
  nameById: Map<string, string>,
) {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.tenantId, (map.get(r.tenantId) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([tenantId, count]) => ({
      tenantId,
      tenantName: nameById.get(tenantId) ?? "(unknown)",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function tenantLimitDataFromPlan(plan: {
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
}) {
  return {
    contactLimit: plan.contactLimit,
    agentLimit: plan.agentLimit,
    aiCreditsPerMonth: plan.aiCreditsPerMonth,
    campaignLimit: plan.campaignLimit,
  };
}

function defaultSubscriptionEnd(start: Date, billingCycle: string): Date {
  const normalized = billingCycle.trim().toLowerCase();
  const end = new Date(start);
  if (normalized === "annual" || normalized === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

// GET /api/v1/partner/plans
//
// Partner onboarding uses the same SuperAdmin-managed plan catalog as the
// public pricing page. This keeps reseller-created customers on the same
// limits, campaign quotas, AI credits, and billing cycles shown elsewhere.
router.get(
  "/plans",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertPartnerTenant(req.tenantId!);
      const plans = await prisma.plan.findMany({
        orderBy: [{ priceInPaisa: "asc" }, { name: "asc" }],
      });

      res.json({
        success: true,
        data: plans.map(publicPlan).filter(Boolean),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/dashboard
router.get(
  "/dashboard",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const childIds = (
        await prisma.tenant.findMany({
          where: childTenantWhere(partner.id),
          select: { id: true },
        })
      ).map((t) => t.id);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [
        customerCount,
        activeCustomers,
        contacts,
        messagesMonth,
        aiCost,
        wallet,
        pendingTasks,
        activeSubscriptions,
      ] = await Promise.all([
        prisma.tenant.count({ where: childTenantWhere(partner.id) }),
        prisma.tenant.count({
          where: { ...childTenantWhere(partner.id), status: TenantStatus.ACTIVE },
        }),
        childIds.length
          ? prisma.contact.count({ where: { tenantId: { in: childIds } } })
          : 0,
        childIds.length
          ? prisma.message.count({
              where: {
                createdAt: { gte: monthStart },
                conversation: { tenantId: { in: childIds } },
              },
            })
          : 0,
        childIds.length
          ? prisma.aiUsage.aggregate({
              where: { tenantId: { in: childIds }, createdAt: { gte: monthStart } },
              _sum: { costInCents: true },
            })
          : { _sum: { costInCents: 0 } },
        prisma.wallet.findFirst({
          where: { tenantId: partner.id },
          select: { balanceCredits: true, creditLimit: true },
        }),
        prisma.demoTenant.count({
          where: {
            createdByPartnerId: partner.id,
            expiresAt: { lte: new Date(Date.now() + 7 * 86_400_000) },
          },
        }),
        childIds.length
          ? prisma.subscription.findMany({
              where: {
                tenantId: { in: childIds },
                status: SubscriptionStatus.ACTIVE,
              },
              orderBy: { updatedAt: "desc" },
              select: {
                tenantId: true,
                updatedAt: true,
                plan: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                    priceInPaisa: true,
                    billingCycle: true,
                  },
                },
              },
            })
          : [],
      ]);
      const billing = summarizePartnerBilling(
        activeSubscriptions.map((subscription) => ({
          tenantId: subscription.tenantId,
          planId: subscription.plan.id,
          planName: subscription.plan.name,
          displayName: subscription.plan.displayName,
          priceInPaisa: subscription.plan.priceInPaisa,
          billingCycle: subscription.plan.billingCycle,
          updatedAt: subscription.updatedAt,
        })),
        {
          partnerMarginEnabled: partner.partnerMarginEnabled,
          partnerMarginBps: Number(
            process.env.PARTNER_MARGIN_BPS ?? DEFAULT_PARTNER_MARGIN_BPS,
          ),
        },
      );

      res.json({
        success: true,
        data: {
          partnerName: partner.name,
          customers: customerCount,
          activeCustomers,
          contacts,
          messagesMonth,
          aiCostInCentsThisMonth: aiCost._sum.costInCents ?? 0,
          walletBalanceCredits: wallet?.balanceCredits ?? 0,
          creditLimitCredits: wallet?.creditLimit ?? 0,
          demosExpiringSoon: pendingTasks,
          ...billing,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/customers
router.get(
  "/customers",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().trim().min(1).max(80).optional(),
        })
        .parse(req.query);

      const where = {
        ...childTenantWhere(partner.id),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: "insensitive" as const } },
                {
                  users: {
                    some: {
                      role: UserRole.BUSINESS_ADMIN,
                      status: { not: UserStatus.DELETED },
                      OR: [
                        {
                          name: {
                            contains: q.search,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          email: {
                            contains: q.search,
                            mode: "insensitive" as const,
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };

      const [total, items] = await prisma.$transaction([
        prisma.tenant.count({ where }),
        prisma.tenant.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { users: true, contacts: true, campaigns: true } },
            users: {
              where: {
                role: UserRole.BUSINESS_ADMIN,
                status: { not: UserStatus.DELETED },
              },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: {
                id: true,
                email: true,
                name: true,
                status: true,
                emailVerified: true,
                lastLoginAt: true,
              },
            },
            subscriptions: {
              where: { status: SubscriptionStatus.ACTIVE },
              orderBy: { updatedAt: "desc" },
              take: 1,
              include: {
                plan: true,
              },
            },
          },
        }),
      ]);

      res.json({
        success: true,
        data: items.map(({ users, ...tenant }) => ({
          ...tenant,
          primaryAdmin: users[0] ?? null,
        })),
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / q.limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/customer-health
router.get(
  "/customer-health",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const query = z
        .object({
          refresh: z.coerce.boolean().default(false),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(req.query);

      const rows = await listPartnerCustomerHealth({
        partnerTenantId: partner.id,
        refresh: query.refresh,
        limit: query.limit,
      });
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/assistant/summary
//
// AI Partner Assistant — portfolio-wide summary. Reuses today's
// CustomerHealthScore rows for the partner's customers (no forced
// recompute) and calls Claude for headline + top-3 actions. Falls
// back to a deterministic summary on LLM failure. Billed to the
// partner tenant.
router.get(
  "/assistant/summary",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const summary = await runPartnerAssistantSummary(partner.id);
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/revenue-autopilot
//
// Revenue Autopilot (PRD-v2 §8). Returns prioritized upsell / expansion
// recommendations across the partner's customer book — generate-only,
// no auto-action. Same generate-then-approve discipline as the
// proposal / win-back / domain-explainer surfaces.
router.get(
  "/revenue-autopilot",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const summary = await runRevenueAutopilot(partner.id);
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/domains/health — snapshot of every white-label
// domain owned by this partner with its most recent health samples and
// the current failing streak. Powers the partner's domain health card.
router.get(
  "/domains/health",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const rows = await listPartnerDomainHealth({ partnerTenantId: partner.id });
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/domains/health/last-run — when did the scheduled
// BullMQ-backed domain health scan last fire and what did it find. Reads
// BullMQ's own completed-jobs storage (ADR-040 pattern). Useful for a
// partner verifying the monitor is alive after a redeploy or long quiet
// stretch — the "Refresh now" button below runs a one-off, but only the
// scheduled tick gives evidence the monitor is healthy.
router.get(
  "/domains/health/last-run",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertPartnerTenant(req.tenantId!);
      const lastRun = await getLastDomainHealthScan();
      res.json({ success: true, data: lastRun });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/partner/domains/health/refresh — force one scan tick now.
// Useful for a partner who just fixed a registrar record and doesn't
// want to wait for the next 6-hour worker tick. The scan is global —
// not partner-scoped — so we guard rate via the 6h worker as well.
router.post(
  "/domains/health/refresh",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertPartnerTenant(req.tenantId!);
      const result = await scanDomainHealth();
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/partner/domains/:domainId/explain
//
// LLM-written diagnosis + ordered fix steps for one failing domain.
// Generate-only — never writes back, never sends a message. Falls back
// to a deterministic per-outcome playbook so the panel is never empty.
// Billed to the partner tenant. Healthy / unknown domains short-circuit
// the LLM call and just return the fallback.
router.post(
  "/domains/:domainId/explain",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const result = await explainDomainError({
        partnerTenantId: partner.id,
        domainId: req.params.domainId,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(120),
  adminPassword: z.string().min(8),
  planId: z.string().cuid().optional(),
  messageQuotaPerMonth: z.number().int().positive().optional(),
  contactLimit: z.number().int().positive().optional(),
  agentLimit: z.number().int().positive().optional(),
  // PDF §5 industry pack — drives the seeded templates + campaign +
  // chatbot. Free-form so the partner can type anything; resolveIndustryPack
  // normalizes aliases (e.g. "spa" → "salon") and falls back to "generic".
  industry: z.string().min(1).max(80).optional(),
  // When false, partner explicitly opts out of the seeded content
  // (useful for partners migrating customers from another system).
  seedStarterPack: z.boolean().default(true),
  // Corrected Billing §4 — per-customer provider ownership + credit source.
  // Optional: when omitted we fall back to the safe default for the
  // partner's model (defaultCustomerConfigFor). When supplied they're
  // validated against the partner's model via assertValidPartnerModelConfig.
  providerOwnership: z.nativeEnum(ProviderOwnership).optional(),
  creditSource: z.nativeEnum(CreditSource).optional(),
});

const changeCustomerPlanSchema = z.object({
  planId: z.string().cuid(),
});

const changeCustomerStatusSchema = z.object({
  status: z.enum([TenantStatus.ACTIVE, TenantStatus.SUSPENDED]),
});

// POST /api/v1/partner/customers
router.post(
  "/customers",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = createCustomerSchema.parse(req.body);

      const existing = await prisma.user.findFirst({
        where: { email: body.adminEmail.toLowerCase() },
      });
      if (existing) {
        throw new ApiError(ErrorCodes.CONFLICT, 409, "Admin email already in use.");
      }
      const selectedPlan = body.planId
        ? await prisma.plan.findUnique({ where: { id: body.planId } })
        : null;
      if (body.planId && !selectedPlan) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Plan not found.");
      }

      const passwordHash = await authService.hashPassword(body.adminPassword);
      const industry: CustomerIndustry = resolveIndustryPack(body.industry);

      // Corrected Billing §4: resolve the customer's provider ownership +
      // credit source against the partner's model. The model lives on the
      // partner tenant; if a legacy partner has none recorded, treat it as
      // a RESELLER (NexaFlow-owned provider) — the most conservative model.
      const partnerModel: PartnerModel = partner.partnerModel ?? PartnerModel.RESELLER;
      const fallback = defaultCustomerConfigFor(partnerModel);
      const providerOwnership = body.providerOwnership ?? fallback.providerOwnership;
      const creditSource = body.creditSource ?? fallback.creditSource;
      assertValidPartnerModelConfig({
        partnerModel,
        providerOwnership,
        creditSource,
        partnerMarginEnabled: partner.partnerMarginEnabled,
      });

      const created = await prisma.$transaction(async (tx) => {
        const subscriptionStart = new Date();
        const tenant = await tx.tenant.create({
          data: {
            name: body.name,
            type: TenantType.BUSINESS,
            status: TenantStatus.ACTIVE,
            parentTenantId: partner.id,
            ...(selectedPlan
              ? tenantLimitDataFromPlan(selectedPlan)
              : {
                  messageQuotaPerMonth: body.messageQuotaPerMonth ?? 1_000_000,
                  contactLimit: body.contactLimit ?? 1_000,
                  agentLimit: body.agentLimit ?? 5,
                  aiCreditsPerMonth: 500,
                }),
            providerOwnership,
            creditSource,
          },
        });
        const admin = await tx.user.create({
          data: {
            email: body.adminEmail.toLowerCase(),
            name: body.adminName,
            password: passwordHash,
            role: UserRole.BUSINESS_ADMIN,
            status: UserStatus.ACTIVE,
            tenantId: tenant.id,
            emailVerified: new Date(),
          },
        });

        // PDF §5: industry workflow templates + first WhatsApp campaign
        // + demo chatbot flow. Inside the same transaction so the
        // customer is never half-created.
        let starter:
          | { templateIds: string[]; campaignId: string; chatbotFlowId: string }
          | null = null;
        if (body.seedStarterPack) {
          starter = await seedStarterTemplatesAndCampaign(tx, tenant.id, industry);
        }

        const subscription = selectedPlan
          ? await tx.subscription.create({
              data: {
                tenantId: tenant.id,
                planId: selectedPlan.id,
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: subscriptionStart,
                currentPeriodEnd: defaultSubscriptionEnd(
                  subscriptionStart,
                  selectedPlan.billingCycle,
                ),
              },
              include: { plan: true },
            })
          : null;

        return { tenant, admin, starter, subscription };
      });

      // Invite email is fire-and-forget — runs outside the tx so a
      // transient SMTP failure can't roll back the customer create.
      // The partner can always re-send via the user-invite path.
      void sendInviteEmail({
        toEmail: body.adminEmail.toLowerCase(),
        toName: body.adminName,
        customerWorkspaceName: created.tenant.name,
        loginUrl: process.env.WEB_BASE_URL
          ? `${process.env.WEB_BASE_URL}/login`
          : "/login",
        tenantId: created.tenant.id,
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "CREATE",
        resource: "PartnerCustomer",
        resourceId: created.tenant.id,
        newValues: {
          name: created.tenant.name,
          parentTenantId: partner.id,
          industry,
          selectedPlanId: selectedPlan?.id ?? null,
          selectedPlanName: selectedPlan?.name ?? null,
          selectedPlanDisplayName: selectedPlan?.displayName ?? null,
          partnerModel,
          providerOwnership,
          creditSource,
          seededTemplates: created.starter?.templateIds.length ?? 0,
          seededCampaignId: created.starter?.campaignId ?? null,
          seededChatbotFlowId: created.starter?.chatbotFlowId ?? null,
        },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: { ...created, industry } });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/partner/customers/:customerId/plan
//
// Lets a partner move one of their child business tenants onto a different
// SuperAdmin-managed plan. Active subscriptions are mutually exclusive; the
// new plan's limits are applied to the tenant immediately.
router.patch(
  "/customers/:customerId/plan",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = changeCustomerPlanSchema.parse(req.body);

      const [customer, plan] = await Promise.all([
        prisma.tenant.findFirst({
          where: {
            id: req.params.customerId,
            ...childTenantWhere(partner.id),
          },
          include: {
            subscriptions: {
              where: { status: SubscriptionStatus.ACTIVE },
              orderBy: { updatedAt: "desc" },
              take: 1,
              include: { plan: true },
            },
          },
        }),
        prisma.plan.findUnique({ where: { id: body.planId } }),
      ]);

      if (!customer) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
      }
      if (!plan) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Plan not found.");
      }

      const start = new Date();
      const activeSubscription = customer.subscriptions[0] ?? null;
      const oldLimits = {
        messageQuotaPerMonth: customer.messageQuotaPerMonth,
        contactLimit: customer.contactLimit,
        agentLimit: customer.agentLimit,
        aiCreditsPerMonth: customer.aiCreditsPerMonth,
        campaignLimit: customer.campaignLimit,
      };
      const newLimits = tenantLimitDataFromPlan(plan);

      const updated = await prisma.$transaction(async (tx) => {
        let subscription = activeSubscription;

        if (activeSubscription?.planId !== plan.id) {
          await tx.subscription.updateMany({
            where: {
              tenantId: customer.id,
              status: SubscriptionStatus.ACTIVE,
            },
            data: {
              status: SubscriptionStatus.CANCELLED,
              cancelledAt: start,
            },
          });

          subscription = await tx.subscription.create({
            data: {
              tenantId: customer.id,
              planId: plan.id,
              status: SubscriptionStatus.ACTIVE,
              currentPeriodStart: start,
              currentPeriodEnd: defaultSubscriptionEnd(start, plan.billingCycle),
            },
            include: { plan: true },
          });
        }

        const tenant = await tx.tenant.update({
          where: { id: customer.id },
          data: newLimits,
          include: {
            subscriptions: {
              where: { status: SubscriptionStatus.ACTIVE },
              orderBy: { updatedAt: "desc" },
              take: 1,
              include: { plan: true },
            },
            _count: { select: { users: true, contacts: true, campaigns: true } },
          },
        });

        return { tenant, subscription };
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerCustomerPlan",
        resourceId: customer.id,
        oldValues: {
          customerName: customer.name,
          planId: activeSubscription?.planId ?? null,
          planName: activeSubscription?.plan?.name ?? null,
          planDisplayName: activeSubscription?.plan?.displayName ?? null,
          limits: oldLimits,
        },
        newValues: {
          customerName: customer.name,
          planId: plan.id,
          planName: plan.name,
          planDisplayName: plan.displayName,
          subscriptionId: updated.subscription?.id ?? null,
          limits: newLimits,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated.tenant });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/partner/customers/:customerId/status
//
// Lets a partner pause or reactivate one of their own child business
// workspaces without giving them destructive delete access.
router.patch(
  "/customers/:customerId/status",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = changeCustomerStatusSchema.parse(req.body);

      const customer = await prisma.tenant.findFirst({
        where: {
          id: req.params.customerId,
          ...childTenantWhere(partner.id),
        },
        include: {
          subscriptions: {
            where: { status: SubscriptionStatus.ACTIVE },
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: { plan: true },
          },
          _count: { select: { users: true, contacts: true, campaigns: true } },
        },
      });

      if (!customer) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
      }

      const updated =
        customer.status === body.status
          ? customer
          : await prisma.tenant.update({
              where: { id: customer.id },
              data: { status: body.status },
              include: {
                subscriptions: {
                  where: { status: SubscriptionStatus.ACTIVE },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                  include: { plan: true },
                },
                _count: { select: { users: true, contacts: true, campaigns: true } },
              },
            });

      if (customer.status !== body.status) {
        await logAudit({
          tenantId: partner.id,
          userId: req.userId!,
          action: "UPDATE",
          resource: "PartnerCustomerStatus",
          resourceId: customer.id,
          oldValues: {
            customerName: customer.name,
            status: customer.status,
          },
          newValues: {
            customerName: updated.name,
            status: updated.status,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/partner/customers/:customerId/admin-reset
//
// Emergency customer access recovery for partners. The generated
// password is returned once and emailed best-effort; it is never stored
// in plaintext.
router.post(
  "/customers/:customerId/admin-reset",
  requirePermission(Permissions.CLIENT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);

      const customer = await prisma.tenant.findFirst({
        where: {
          id: req.params.customerId,
          ...childTenantWhere(partner.id),
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });

      if (!customer) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
      }

      const admin = await prisma.user.findFirst({
        where: {
          tenantId: customer.id,
          role: UserRole.BUSINESS_ADMIN,
          status: { not: UserStatus.DELETED },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          emailVerified: true,
          lastLoginAt: true,
        },
      });

      if (!admin) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "No business admin found for this customer.",
        );
      }

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await authService.hashPassword(temporaryPassword);
      const updatedAdmin = await prisma.user.update({
        where: { id: admin.id },
        data: {
          password: passwordHash,
          status: UserStatus.ACTIVE,
          emailVerified: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          emailVerified: true,
          lastLoginAt: true,
        },
      });

      const loginUrl = process.env.WEB_BASE_URL
        ? `${process.env.WEB_BASE_URL}/login`
        : "/login";
      void sendCustomerAdminResetEmail({
        toEmail: updatedAdmin.email,
        toName: updatedAdmin.name,
        customerWorkspaceName: customer.name,
        loginUrl,
        temporaryPassword,
        tenantId: customer.id,
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerCustomerAdminAccess",
        resourceId: updatedAdmin.id,
        oldValues: {
          customerId: customer.id,
          customerName: customer.name,
          adminEmail: admin.email,
          adminStatus: admin.status,
          emailVerified: admin.emailVerified,
        },
        newValues: {
          customerId: customer.id,
          customerName: customer.name,
          adminEmail: updatedAdmin.email,
          adminStatus: updatedAdmin.status,
          emailVerified: updatedAdmin.emailVerified,
          temporaryPasswordReturned: true,
        },
        ...extractRequestMeta(req),
      });

      res.json({
        success: true,
        data: {
          admin: updatedAdmin,
          loginUrl,
          temporaryPassword,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/team
router.get(
  "/team",
  requirePermission(Permissions.TEAM_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertPartnerTenant(req.tenantId!);
      const users = await prisma.user.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      res.json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  },
);

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8),
  role: z.enum([UserRole.WHITE_LABEL_ADMIN, UserRole.TEAM_LEAD]).default(
    UserRole.TEAM_LEAD,
  ),
});

// POST /api/v1/partner/team
router.post(
  "/team",
  requirePermission(Permissions.TEAM_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertPartnerTenant(req.tenantId!);
      const body = inviteSchema.parse(req.body);
      const existing = await prisma.user.findFirst({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) {
        throw new ApiError(ErrorCodes.CONFLICT, 409, "Email already registered.");
      }
      const passwordHash = await authService.hashPassword(body.password);
      const user = await prisma.user.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          password: passwordHash,
          role: body.role,
          status: UserStatus.ACTIVE,
          tenantId: req.tenantId!,
          emailVerified: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "PartnerTeamMember",
        resourceId: user.id,
        newValues: { email: user.email, role: user.role },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/channels
// Read-only view of every child tenant's WhatsApp connection state.
// Partners use this to spot tenants whose WABA connection is broken /
// expiring / unverified without clicking into each one. Token itself
// is NEVER returned — only the connection metadata.
router.get(
  "/channels",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const childIds = (
        await prisma.tenant.findMany({
          where: childTenantWhere(partner.id),
          select: { id: true },
        })
      ).map((t) => t.id);

      const channels = await prisma.tenant.findMany({
        where: { id: { in: childIds } },
        select: {
          id: true,
          name: true,
          status: true,
          wabaPhoneNumber: true,
          wabaId: true,
          wabaBusinessName: true,
          wabaBusinessVertical: true,
          wabaTokenExpiresAt: true,
          wabaBusinessProfileSyncedAt: true,
          // NOTE: wabaAccessToken intentionally NOT selected. Even
          // the encrypted form never crosses an API boundary from
          // this route.
          createdAt: true,
          _count: {
            select: { conversations: true, contacts: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Compute derived flags so the UI doesn't have to (and so they're
      // consistent if we add multi-WABA-per-tenant later).
      const now = Date.now();
      const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
      const data = channels.map((c) => {
        const isConnected = Boolean(c.wabaPhoneNumber);
        const expiresInMs = c.wabaTokenExpiresAt
          ? c.wabaTokenExpiresAt.getTime() - now
          : null;
        const tokenExpiringSoon =
          expiresInMs !== null && expiresInMs > 0 && expiresInMs < TWO_WEEKS_MS;
        const tokenExpired = expiresInMs !== null && expiresInMs <= 0;
        return {
          ...c,
          isConnected,
          tokenExpiringSoon,
          tokenExpired,
        };
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/ai/usage
// Portfolio-wide AI spend rollup. The Gemini-built /partner/ai page used to
// fake all of this with setTimeout + hardcoded strings. Real version: pull
// AiUsage + AiAgent rows scoped to the partner's child tenants and group.
router.get(
  "/ai/usage",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const children = await prisma.tenant.findMany({
        where: childTenantWhere(partner.id),
        select: { id: true, name: true },
      });
      const childIds = children.map((c) => c.id);
      const nameById = new Map(children.map((c) => [c.id, c.name]));

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      // Empty portfolio short-circuit so we don't issue Prisma queries with
      // empty `in:[]` arrays (which return [] anyway, but cost a round-trip).
      if (childIds.length === 0) {
        res.json({
          success: true,
          data: {
            monthStart: monthStart.toISOString(),
            totalCostInCents: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCalls: 0,
            byFeature: [],
            byTenant: [],
            agents: { total: 0, active: 0, byTenant: [] },
          },
        });
        return;
      }

      const [byFeatureRaw, byTenantRaw, totals, agentsRaw, agentsTotal] =
        await Promise.all([
          prisma.aiUsage.groupBy({
            by: ["feature"],
            where: { tenantId: { in: childIds }, createdAt: { gte: monthStart } },
            _sum: { costInCents: true, inputTokens: true, outputTokens: true },
            _count: { _all: true },
          }),
          prisma.aiUsage.groupBy({
            by: ["tenantId"],
            where: { tenantId: { in: childIds }, createdAt: { gte: monthStart } },
            _sum: { costInCents: true, inputTokens: true, outputTokens: true },
            _count: { _all: true },
          }),
          prisma.aiUsage.aggregate({
            where: { tenantId: { in: childIds }, createdAt: { gte: monthStart } },
            _sum: { costInCents: true, inputTokens: true, outputTokens: true },
            _count: { _all: true },
          }),
          prisma.aiAgent.groupBy({
            by: ["tenantId"],
            where: { tenantId: { in: childIds } },
            _count: { _all: true },
          }),
          prisma.aiAgent.count({
            where: { tenantId: { in: childIds }, status: "ACTIVE" },
          }),
        ]);

      const byFeature = byFeatureRaw
        .map((row) => ({
          feature: row.feature,
          costInCents: row._sum.costInCents ?? 0,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          calls: row._count._all,
        }))
        .sort((a, b) => b.costInCents - a.costInCents);

      const byTenant = byTenantRaw
        .map((row) => ({
          tenantId: row.tenantId,
          tenantName: nameById.get(row.tenantId) ?? "(unknown)",
          costInCents: row._sum.costInCents ?? 0,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          calls: row._count._all,
        }))
        .sort((a, b) => b.costInCents - a.costInCents);

      const agentsByTenant = agentsRaw
        .map((row) => ({
          tenantId: row.tenantId,
          tenantName: nameById.get(row.tenantId) ?? "(unknown)",
          agents: row._count._all,
        }))
        .sort((a, b) => b.agents - a.agents);

      res.json({
        success: true,
        data: {
          monthStart: monthStart.toISOString(),
          totalCostInCents: totals._sum.costInCents ?? 0,
          totalInputTokens: totals._sum.inputTokens ?? 0,
          totalOutputTokens: totals._sum.outputTokens ?? 0,
          totalCalls: totals._count._all,
          byFeature,
          byTenant,
          agents: {
            total: agentsByTenant.reduce((s, t) => s + t.agents, 0),
            active: agentsTotal,
            byTenant: agentsByTenant,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/products/access
// Real product entitlement matrix: products allowed for this partner and
// per-child-customer toggles. "Customer" is the public term; internally these
// are child Tenant rows.
router.get(
  "/products/access",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const [products, partnerAccesses, children] = await Promise.all([
        prisma.product.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: {
            addOns: {
              where: { isActive: true },
              orderBy: { name: "asc" },
              select: {
                key: true,
                name: true,
                description: true,
                priceInPaisa: true,
                billingCycle: true,
                isActive: true,
              },
            },
          },
        }),
        prisma.partnerProductAccess.findMany({
          where: { partnerTenantId: partner.id },
          select: {
            productId: true,
            enabled: true,
            limits: true,
            source: true,
            expiresAt: true,
          },
        }),
        prisma.tenant.findMany({
          where: childTenantWhere(partner.id),
          orderBy: { name: "asc" },
          select: { id: true, name: true, status: true },
        }),
      ]);

      const childIds = children.map((child) => child.id);
      const customerAccesses = childIds.length
        ? await prisma.customerProductAccess.findMany({
            where: { customerTenantId: { in: childIds } },
            select: {
              customerTenantId: true,
              productId: true,
              enabled: true,
              limits: true,
              source: true,
              expiresAt: true,
            },
          })
        : [];

      const partnerByProduct = new Map(
        partnerAccesses.map((access) => [access.productId, access]),
      );
      const customerByTenantProduct = new Map(
        customerAccesses.map((access) => [
          `${access.customerTenantId}:${access.productId}`,
          access,
        ]),
      );

      const productRows = products.map((product) => {
        const partnerAccess = partnerByProduct.get(product.id);
        const enabledForPartner =
          product.isGlobalEnabled &&
          Boolean(partnerAccess?.enabled && accessStillActive(partnerAccess));
        return {
          id: product.id,
          key: product.key,
          name: product.name,
          category: product.category,
          description: product.description,
          routeHref: product.routeHref,
          featureKey: product.featureKey,
          icon: product.icon,
          enabledForPartner,
          globalEnabled: product.isGlobalEnabled,
          limits: partnerAccess?.limits ?? null,
          source: partnerAccess?.source ?? ProductAccessSource.SUPER_ADMIN,
          addOns: product.addOns,
        };
      });
      const productRowsById = new Map(productRows.map((row) => [row.id, row]));

      const customers = children.map((child) => ({
        id: child.id,
        name: child.name,
        status: child.status,
        products: Object.fromEntries(
          products.map((product) => {
            const partnerRow = productRowsById.get(product.id);
            const access = customerByTenantProduct.get(`${child.id}:${product.id}`);
            const explicitEnabled =
              !access || (access.enabled && accessStillActive(access));
            return [
              product.key,
              {
                enabled: Boolean(partnerRow?.enabledForPartner && explicitEnabled),
                explicitEnabled,
                source: access?.source ?? ProductAccessSource.GLOBAL,
                limits: access?.limits ?? partnerRow?.limits ?? null,
              },
            ];
          }),
        ),
      }));

      res.json({
        success: true,
        data: {
          partner,
          products: productRows,
          customers,
          terminology: { public: "Customer", internal: "Tenant" },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/partner/customers/:customerId/products/:productKey
router.patch(
  "/customers/:customerId/products/:productKey",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          enabled: z.boolean(),
          limits: z.unknown().nullable().optional(),
        })
        .parse(req.body);
      const partner = await assertPartnerTenant(req.tenantId!);
      const customer = await assertPartnerOwnsCustomer(
        partner.id,
        req.params.customerId,
      );
      const { product } = await assertPartnerCanGrantProduct(
        partner.id,
        req.params.productKey,
      );

      const access = await prisma.customerProductAccess.upsert({
        where: {
          customerTenantId_productId: {
            customerTenantId: customer.id,
            productId: product.id,
          },
        },
        update: {
          enabled: body.enabled,
          limits: jsonInput(body.limits),
          partnerTenantId: partner.id,
          source: ProductAccessSource.PARTNER,
          updatedByUserId: req.userId,
        },
        create: {
          customerTenantId: customer.id,
          partnerTenantId: partner.id,
          productId: product.id,
          enabled: body.enabled,
          limits: jsonInput(body.limits),
          source: ProductAccessSource.PARTNER,
          createdByUserId: req.userId,
          updatedByUserId: req.userId,
        },
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "CustomerProductAccess",
        resourceId: access.id,
        newValues: {
          customerTenantId: customer.id,
          productKey: product.key,
          enabled: access.enabled,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: access });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/partner/catalog
// Portfolio inventory of reusable assets (WhatsApp templates, chatbot
// flows, service bundles) across the partner's child tenants. Replaces
// the Gemini /partner/products localStorage "distribute" mock — Meta
// requires per-WABA template submission so partners can't actually
// push a template to every customer in one click; the honest read is
// "what does my portfolio look like, who has what."
router.get(
  "/catalog",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const children = await prisma.tenant.findMany({
        where: childTenantWhere(partner.id),
        select: { id: true, name: true },
      });
      const childIds = children.map((c) => c.id);
      const nameById = new Map(children.map((c) => [c.id, c.name]));

      if (childIds.length === 0) {
        res.json({
          success: true,
          data: {
            templates: { total: 0, items: [], byTenant: [] },
            flows: { total: 0, items: [], byTenant: [] },
            services: { total: 0, items: [], byTenant: [] },
          },
        });
        return;
      }

      const [templates, flows, services] = await Promise.all([
        prisma.whatsAppTemplate.findMany({
          where: { tenantId: { in: childIds } },
          select: {
            id: true,
            tenantId: true,
            name: true,
            category: true,
            language: true,
            status: true,
            messageCount: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.chatbotFlow.findMany({
          where: { tenantId: { in: childIds } },
          select: {
            id: true,
            tenantId: true,
            name: true,
            isActive: true,
            trigger: true,
            aiIntentEnabled: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.service.findMany({
          where: { tenantId: { in: childIds } },
          select: {
            id: true,
            tenantId: true,
            name: true,
            durationMinutes: true,
            priceInPaisa: true,
            isActive: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      res.json({
        success: true,
        data: {
          templates: {
            total: templates.length,
            byTenant: countsByTenant(templates, nameById),
            items: templates.map((t) => ({
              id: t.id,
              tenantId: t.tenantId,
              tenantName: nameById.get(t.tenantId) ?? "(unknown)",
              name: t.name,
              category: t.category,
              language: t.language,
              status: t.status,
              messageCount: t.messageCount,
              updatedAt: t.updatedAt,
            })),
          },
          flows: {
            total: flows.length,
            byTenant: countsByTenant(flows, nameById),
            items: flows.map((f) => ({
              id: f.id,
              tenantId: f.tenantId,
              tenantName: nameById.get(f.tenantId) ?? "(unknown)",
              name: f.name,
              isActive: f.isActive,
              trigger: f.trigger,
              aiIntentEnabled: f.aiIntentEnabled,
              updatedAt: f.updatedAt,
            })),
          },
          services: {
            total: services.length,
            byTenant: countsByTenant(services, nameById),
            items: services.map((s) => ({
              id: s.id,
              tenantId: s.tenantId,
              tenantName: nameById.get(s.tenantId) ?? "(unknown)",
              name: s.name,
              durationMinutes: s.durationMinutes,
              priceInPaisa: s.priceInPaisa,
              isActive: s.isActive,
              updatedAt: s.updatedAt,
            })),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Support tickets — read + reply for tickets raised by child tenants.
// Customers create tickets via /api/v1/support-tickets in their own portal;
// partners triage + resolve them here. Replaces the localStorage mock that
// powered the old /partner/tickets page.
// ----------------------------------------------------------------------------

const ticketListQuerySchema = z.object({
  status: z.nativeEnum(SupportTicketStatus).optional(),
  priority: z.nativeEnum(SupportTicketPriority).optional(),
});

const ticketReplySchema = z.object({
  content: z.string().trim().min(1).max(8000),
  internalNote: z.boolean().optional(),
});

const ticketUpdateSchema = z.object({
  status: z.nativeEnum(SupportTicketStatus).optional(),
  priority: z.nativeEnum(SupportTicketPriority).optional(),
});

router.get(
  "/tickets",
  requirePermission(Permissions.SUPPORT_TICKET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const q = ticketListQuerySchema.parse(req.query);
      const tickets = await listPartnerTickets(partner.id, q);
      res.json({ success: true, data: tickets });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/tickets/:id",
  requirePermission(Permissions.SUPPORT_TICKET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const ticket = await getPartnerTicket(partner.id, req.params.id);
      res.json({ success: true, data: ticket });
    } catch (err) {
      next(err);
    }
  },
);

// AI Support Ticket Resolver (Claude FINAL §9) — drafts a suggested
// reply for the partner to review + edit. Never auto-sends; the
// partner posts via /tickets/:id/replies once happy.
router.post(
  "/tickets/:id/ai-suggest-reply",
  requirePermission(Permissions.SUPPORT_TICKET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const suggestion = await suggestTicketReply({
        partnerTenantId: partner.id,
        ticketId: req.params.id,
      });
      res.json({ success: true, data: suggestion });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/tickets/:id/replies",
  requirePermission(Permissions.SUPPORT_TICKET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = ticketReplySchema.parse(req.body);
      const message = await partnerReplyToTicket({
        partnerTenantId: partner.id,
        partnerUserId: req.userId!,
        ticketId: req.params.id,
        content: body.content,
        internalNote: body.internalNote,
      });
      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: body.internalNote ? "ANNOTATE" : "REPLY",
        resource: "SupportTicket",
        resourceId: req.params.id,
        newValues: { messageId: message.id, internalNote: body.internalNote ?? false },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Partner-portal sidebar config — what nav items show + their labels.
// Persisted on Tenant.partnerMenuConfig so changes survive across browsers
// and team members. Replaces the localStorage-only mock under /partner/menu.
// ----------------------------------------------------------------------------

const PARTNER_MENU_KEYS = [
  "Dashboard",
  "Customers",
  "Wallet",
  "Whitelabel",
  "Theme",
  "Menu",
  "Products",
  "Tickets",
  "Channels",
  "AI",
  "Team",
] as const;

const menuItemSchema = z.object({
  key: z.enum(PARTNER_MENU_KEYS as unknown as [string, ...string[]]),
  label: z.string().trim().min(1).max(40),
  icon: z.string().trim().min(1).max(8),
  enabled: z.boolean(),
});

const menuConfigSchema = z.object({
  items: z.array(menuItemSchema).min(1).max(20),
});

router.get(
  "/menu-config",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const row = await prisma.tenant.findUnique({
        where: { id: partner.id },
        select: { partnerMenuConfig: true },
      });
      res.json({
        success: true,
        data: (row?.partnerMenuConfig as unknown) ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/menu-config",
  requirePermission(Permissions.WHITELABEL_CONFIG),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = menuConfigSchema.parse(req.body);

      // Ensure every key is unique (the enum already restricts to known keys).
      const seen = new Set<string>();
      for (const item of body.items) {
        if (seen.has(item.key)) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            400,
            `Duplicate menu key: ${item.key}`,
          );
        }
        seen.add(item.key);
      }

      const updated = await prisma.tenant.update({
        where: { id: partner.id },
        data: { partnerMenuConfig: body },
        select: { partnerMenuConfig: true },
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerMenuConfig",
        resourceId: partner.id,
        newValues: { itemCount: body.items.length },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated.partnerMenuConfig });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/tickets/:id",
  requirePermission(Permissions.SUPPORT_TICKET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const partner = await assertPartnerTenant(req.tenantId!);
      const body = ticketUpdateSchema.parse(req.body);
      const updated = await updatePartnerTicket({
        partnerTenantId: partner.id,
        ticketId: req.params.id,
        status: body.status,
        priority: body.priority,
      });
      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "UPDATE",
        resource: "SupportTicket",
        resourceId: req.params.id,
        newValues: { status: body.status, priority: body.priority },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
