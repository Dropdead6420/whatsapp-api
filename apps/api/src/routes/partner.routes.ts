import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
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

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireRole(UserRole.WHITE_LABEL_ADMIN),
);

async function assertPartnerTenant(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, type: TenantType.WHITE_LABEL, status: TenantStatus.ACTIVE },
    select: { id: true, name: true },
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
      ]);

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

      const where: Record<string, unknown> = childTenantWhere(partner.id);
      if (q.search) {
        where.name = { contains: q.search, mode: "insensitive" };
      }

      const [total, items] = await prisma.$transaction([
        prisma.tenant.count({ where }),
        prisma.tenant.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { users: true, contacts: true, campaigns: true } },
          },
        }),
      ]);

      res.json({
        success: true,
        data: items,
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

const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(120),
  adminPassword: z.string().min(8),
  messageQuotaPerMonth: z.number().int().positive().optional(),
  contactLimit: z.number().int().positive().optional(),
  agentLimit: z.number().int().positive().optional(),
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

      const passwordHash = await authService.hashPassword(body.adminPassword);
      const created = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: body.name,
            type: TenantType.BUSINESS,
            status: TenantStatus.ACTIVE,
            parentTenantId: partner.id,
            messageQuotaPerMonth: body.messageQuotaPerMonth ?? 10_000,
            contactLimit: body.contactLimit ?? 1_000,
            agentLimit: body.agentLimit ?? 5,
            aiCreditsPerMonth: 500,
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
        return { tenant, admin };
      });

      await logAudit({
        tenantId: partner.id,
        userId: req.userId!,
        action: "CREATE",
        resource: "PartnerCustomer",
        resourceId: created.tenant.id,
        newValues: { name: created.tenant.name, parentTenantId: partner.id },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: created });
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

export default router;
