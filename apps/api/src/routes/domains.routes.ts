import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  DomainDnsStatus,
  DomainPortalType,
  DomainSslStatus,
  DomainStatus,
  ErrorCodes,
  Permissions,
  TenantType,
  UserRole,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  buildDomainRecords,
  checkDomain,
  getDomainRecordInstructions,
  normalizeDomain,
} from "../services/domain.service";

const router = Router();

const listSchema = z.object({
  tenantId: z.string().cuid().optional(),
  portalType: z.nativeEnum(DomainPortalType).optional(),
  status: z.nativeEnum(DomainStatus).optional(),
});

const createSchema = z.object({
  tenantId: z.string().cuid().optional(),
  domain: z.string().min(3).max(253),
  portalType: z.nativeEnum(DomainPortalType),
  isPrimary: z.boolean().optional(),
});

const updateSchema = z.object({
  isPrimary: z.boolean().optional(),
  status: z.nativeEnum(DomainStatus).optional(),
});

router.use(requireAuth, requirePermission(Permissions.WHITELABEL_CONFIG));

async function getManageableTenantId(req: RequestWithAuth, requestedTenantId?: string) {
  if (req.userRole === UserRole.SUPER_ADMIN) {
    if (!requestedTenantId) return null;
    const tenant = await prisma.tenant.findUnique({ where: { id: requestedTenantId } });
    if (!tenant) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
    return requestedTenantId;
  }

  if (!req.tenantId) {
    throw new ApiError(
      ErrorCodes.MULTI_TENANT_VIOLATION,
      400,
      "Tenant context required for domain management.",
    );
  }

  if (!requestedTenantId || requestedTenantId === req.tenantId) return req.tenantId;

  const childTenant = await prisma.tenant.findFirst({
    where: {
      id: requestedTenantId,
      parentTenantId: req.tenantId,
      type: TenantType.BUSINESS,
    },
    select: { id: true },
  });

  if (!childTenant) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "You can only manage domains for your partner account or customer accounts.",
    );
  }

  return requestedTenantId;
}

async function assertDomainAccess(req: RequestWithAuth, domainId: string) {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    include: { tenant: { select: { parentTenantId: true } } },
  });
  if (!domain) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Domain not found.");
  if (req.userRole === UserRole.SUPER_ADMIN) return domain;

  if (
    req.tenantId &&
    (domain.tenantId === req.tenantId ||
      domain.partnerTenantId === req.tenantId ||
      domain.tenant.parentTenantId === req.tenantId)
  ) {
    return domain;
  }

  throw new ApiError(
    ErrorCodes.FORBIDDEN,
    403,
    "You do not have access to this domain.",
  );
}

// GET /api/v1/domains
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listSchema.parse(req.query);
    const requestedTenantId = await getManageableTenantId(req, q.tenantId);

    const where: Record<string, unknown> = {};
    if (q.portalType) where.portalType = q.portalType;
    if (q.status) where.status = q.status;

    if (req.userRole === UserRole.SUPER_ADMIN) {
      if (requestedTenantId) where.tenantId = requestedTenantId;
    } else if (q.tenantId) {
      where.tenantId = requestedTenantId;
    } else {
      where.OR = [
        { tenantId: requestedTenantId },
        { partnerTenantId: req.tenantId },
        { tenant: { parentTenantId: req.tenantId } },
      ];
    }

    const domains = await prisma.domain.findMany({
      where,
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      include: {
        tenant: { select: { id: true, name: true, type: true } },
        partnerTenant: { select: { id: true, name: true } },
      },
    });

    res.json({
      success: true,
      data: domains.map((domain) => ({
        ...domain,
        records: getDomainRecordInstructions(domain),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/domains
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const tenantId = await getManageableTenantId(req, body.tenantId);
    if (!tenantId) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "tenantId is required when a SuperAdmin creates a domain.",
      );
    }

    const normalizedDomain = normalizeDomain(body.domain);
    const existing = await prisma.domain.findUnique({
      where: { domain: normalizedDomain },
    });
    if (existing) {
      throw new ApiError(ErrorCodes.CONFLICT, 409, "Domain is already connected.");
    }

    const records = buildDomainRecords(normalizedDomain, body.portalType);
    const partnerTenantId =
      req.userRole === UserRole.SUPER_ADMIN
        ? undefined
        : tenantId === req.tenantId
          ? undefined
          : req.tenantId;

    const created = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.domain.updateMany({
          where: { tenantId, portalType: body.portalType },
          data: { isPrimary: false },
        });
      }

      return tx.domain.create({
        data: {
          tenantId,
          partnerTenantId,
          domain: records.domain,
          portalType: records.portalType,
          verificationToken: records.verificationToken,
          cnameHost: records.cnameHost,
          cnameValue: records.cnameValue,
          txtHost: records.txtHost,
          txtValue: records.txtValue,
          isPrimary: body.isPrimary ?? false,
        },
        include: {
          tenant: { select: { id: true, name: true, type: true } },
          partnerTenant: { select: { id: true, name: true } },
        },
      });
    });

    await logAudit({
      tenantId,
      userId: req.userId!,
      action: "CREATE",
      resource: "Domain",
      resourceId: created.id,
      newValues: {
        domain: created.domain,
        portalType: created.portalType,
        isPrimary: created.isPrimary,
      },
      ...extractRequestMeta(req),
    });

    res.status(201).json({
      success: true,
      data: { ...created, records: getDomainRecordInstructions(created) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/domains/:id/check
router.post("/:id/check", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await assertDomainAccess(req, req.params.id);
    const checked = await checkDomain(req.params.id);
    res.json({
      success: true,
      data: { ...checked, records: getDomainRecordInstructions(checked) },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/domains/:id
router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const existing = await assertDomainAccess(req, req.params.id);

    if (
      body.status &&
      req.userRole !== UserRole.SUPER_ADMIN &&
      ![DomainStatus.SUSPENDED, DomainStatus.PENDING_DNS].includes(body.status)
    ) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "Only SuperAdmins can manually promote domain status.",
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.domain.updateMany({
          where: { tenantId: existing.tenantId, portalType: existing.portalType },
          data: { isPrimary: false },
        });
      }
      const data: {
        isPrimary?: boolean;
        status?: DomainStatus;
        dnsStatus?: DomainDnsStatus;
        sslStatus?: DomainSslStatus;
        lastError?: string | null;
      } = {
        isPrimary: body.isPrimary,
        status: body.status,
      };
      if (body.status === DomainStatus.LIVE || body.status === DomainStatus.SSL_ACTIVE) {
        data.dnsStatus = DomainDnsStatus.TXT_VERIFIED;
        data.sslStatus = DomainSslStatus.ACTIVE;
        data.lastError = null;
      }

      return tx.domain.update({
        where: { id: existing.id },
        data,
        include: {
          tenant: { select: { id: true, name: true, type: true } },
          partnerTenant: { select: { id: true, name: true } },
        },
      });
    });

    await logAudit({
      tenantId: updated.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Domain",
      resourceId: updated.id,
      oldValues: {
        isPrimary: existing.isPrimary,
        status: existing.status,
      },
      newValues: {
        isPrimary: updated.isPrimary,
        status: updated.status,
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: { ...updated, records: getDomainRecordInstructions(updated) },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/domains/:id
router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const existing = await assertDomainAccess(req, req.params.id);
    await prisma.domain.delete({ where: { id: existing.id } });

    await logAudit({
      tenantId: existing.tenantId,
      userId: req.userId!,
      action: "DELETE",
      resource: "Domain",
      resourceId: existing.id,
      oldValues: {
        domain: existing.domain,
        portalType: existing.portalType,
      },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
