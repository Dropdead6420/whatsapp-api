import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { authService } from "../services/auth.service";

const router = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(TenantStatus).optional(),
  type: z.nativeEnum(TenantType).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(TenantType).default(TenantType.DIRECT),
  domain: z.string().trim().max(120).optional(),
  parentTenantId: z.string().cuid().optional(),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(120),
  adminPassword: z.string().min(8),
  messageQuotaPerMonth: z.number().int().positive().optional(),
  contactLimit: z.number().int().positive().optional(),
  agentLimit: z.number().int().positive().optional(),
  aiCreditsPerMonth: z.number().int().nonnegative().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.nativeEnum(TenantStatus).optional(),
  domain: z.string().trim().max(120).optional(),
  logoUrl: z.string().url().optional(),
  brandColors: z.record(z.string()).optional(),
  customCss: z.string().max(10_000).optional(),
  messageQuotaPerMonth: z.number().int().positive().optional(),
  contactLimit: z.number().int().positive().optional(),
  agentLimit: z.number().int().positive().optional(),
  aiCreditsPerMonth: z.number().int().nonnegative().optional(),
});

router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

// GET /api/v1/tenants
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { domain: { contains: q.search, mode: "insensitive" } },
      ];
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
});

// POST /api/v1/tenants
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const existing = await prisma.user.findFirst({
      where: { email: body.adminEmail.toLowerCase() },
    });
    if (existing) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "A user with this admin email already exists.",
      );
    }
    if (body.domain) {
      const domainTaken = await prisma.tenant.findUnique({
        where: { domain: body.domain },
      });
      if (domainTaken) {
        throw new ApiError(ErrorCodes.CONFLICT, 409, "Domain is already in use.");
      }
    }

    const passwordHash = await authService.hashPassword(body.adminPassword);
    const adminRole =
      body.type === TenantType.WHITE_LABEL
        ? UserRole.WHITE_LABEL_ADMIN
        : UserRole.BUSINESS_ADMIN;

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: body.name,
          type: body.type,
          status: TenantStatus.ACTIVE,
          domain: body.domain ?? null,
          parentTenantId: body.parentTenantId ?? null,
          messageQuotaPerMonth: body.messageQuotaPerMonth ?? 10_000,
          contactLimit: body.contactLimit ?? 1_000,
          agentLimit: body.agentLimit ?? 5,
          aiCreditsPerMonth: body.aiCreditsPerMonth ?? 1_000,
        },
      });
      const admin = await tx.user.create({
        data: {
          email: body.adminEmail.toLowerCase(),
          name: body.adminName,
          password: passwordHash,
          role: adminRole,
          status: UserStatus.ACTIVE,
          tenantId: tenant.id,
          emailVerified: new Date(),
        },
      });
      return { tenant, admin };
    });

    await logAudit({
      tenantId: created.tenant.id,
      userId: req.userId!,
      action: "CREATE",
      resource: "Tenant",
      resourceId: created.tenant.id,
      newValues: { name: created.tenant.name, type: created.tenant.type },
      ...extractRequestMeta(req),
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tenants/:id
router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            users: true,
            contacts: true,
            campaigns: true,
            conversations: true,
          },
        },
        subscriptions: { include: { plan: true } },
      },
    });
    if (!tenant) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
    }
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/tenants/:id
router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data: {
        ...body,
        brandColors: body.brandColors ? JSON.stringify(body.brandColors) : undefined,
      },
    });

    await logAudit({
      tenantId: updated.id,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Tenant",
      resourceId: updated.id,
      oldValues: { name: existing.name, status: existing.status },
      newValues: body,
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/tenants/:id  (soft-delete via status)
router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
    }
    if (existing.status === TenantStatus.DELETED) {
      res.json({ success: true });
      return;
    }
    await prisma.tenant.update({
      where: { id: req.params.id },
      data: { status: TenantStatus.DELETED },
    });
    await logAudit({
      tenantId: existing.id,
      userId: req.userId!,
      action: "DELETE",
      resource: "Tenant",
      resourceId: existing.id,
      oldValues: { status: existing.status },
      newValues: { status: TenantStatus.DELETED },
      ...extractRequestMeta(req),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
