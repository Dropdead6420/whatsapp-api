import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  Permissions,
  TenantType,
  UserRole,
  WalletBillingMode,
  WalletStatus,
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  adjustWallet,
  ensureWallet,
  getWalletAlertStatus,
  transferWalletCredits,
  updateWalletSettings,
} from "../services/wallet.service";

const router = Router();

const listSchema = z.object({
  tenantId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const settingsSchema = z.object({
  status: z.nativeEnum(WalletStatus).optional(),
  billingMode: z.nativeEnum(WalletBillingMode).optional(),
  creditLimit: z.number().int().min(0).optional(),
  lowBalanceThreshold: z.number().int().min(0).optional(),
  autoRechargeEnabled: z.boolean().optional(),
  // T-021: auto-recharge config.
  autoRechargeAmountCredits: z.number().int().min(0).max(1_000_000).optional(),
  autoRechargePaymentProvider: z.enum(["razorpay", "stripe"]).nullable().optional(),
  autoRechargePaymentMethodToken: z.string().trim().max(200).nullable().optional(),
});

const adjustSchema = z.object({
  direction: z.nativeEnum(WalletTransactionDirection),
  type: z.nativeEnum(WalletTransactionType).default(
    WalletTransactionType.MANUAL_ADJUSTMENT,
  ),
  amountCredits: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  referenceType: z.string().trim().min(1).max(80).optional(),
  referenceId: z.string().trim().min(1).max(120).optional(),
});

const transferSchema = z.object({
  fromTenantId: z.string().cuid(),
  toTenantId: z.string().cuid(),
  amountCredits: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

router.use(requireAuth, requirePermission(Permissions.WALLET_VIEW));

async function assertTenantAccess(req: RequestWithAuth, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, parentTenantId: true, type: true },
  });
  if (!tenant) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");

  if (req.userRole === UserRole.SUPER_ADMIN) return tenant;
  if (req.tenantId === tenantId) return tenant;
  if (
    req.userRole === UserRole.WHITE_LABEL_ADMIN &&
    tenant.type === TenantType.BUSINESS &&
    tenant.parentTenantId === req.tenantId
  ) {
    return tenant;
  }

  throw new ApiError(
    ErrorCodes.FORBIDDEN,
    403,
    "You do not have access to this wallet.",
  );
}

function tenantWhereForUser(req: RequestWithAuth, tenantId?: string) {
  if (req.userRole === UserRole.SUPER_ADMIN) {
    return tenantId ? { id: tenantId } : {};
  }
  if (!req.tenantId) {
    throw new ApiError(
      ErrorCodes.MULTI_TENANT_VIOLATION,
      400,
      "Tenant context required for wallet access.",
    );
  }
  if (tenantId) {
    return {
      id: tenantId,
      OR: [{ id: req.tenantId }, { parentTenantId: req.tenantId }],
    };
  }
  return {
    OR: [{ id: req.tenantId }, { parentTenantId: req.tenantId }],
  };
}

function parseTransactionMetadata(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// GET /api/v1/wallets/alerts — low-balance signal for dashboard (T-020)
router.get(
  "/alerts",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) {
        throw new ApiError(
          ErrorCodes.MULTI_TENANT_VIOLATION,
          400,
          "Tenant context required.",
        );
      }
      const alert = await getWalletAlertStatus(req.tenantId);
      res.json({ success: true, data: alert });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/wallets
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listSchema.parse(req.query);
    const where = tenantWhereForUser(req, q.tenantId);

    const [total, tenants] = await prisma.$transaction([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { wallet: true },
      }),
    ]);

    const items = await Promise.all(
      tenants.map(async (tenant) => ({
        tenant: {
          id: tenant.id,
          name: tenant.name,
          type: tenant.type,
          status: tenant.status,
          parentTenantId: tenant.parentTenantId,
        },
        wallet: tenant.wallet ?? (await ensureWallet(tenant.id)),
      })),
    );

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
});

// GET /api/v1/wallets/:tenantId
router.get("/:tenantId", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const tenant = await assertTenantAccess(req, req.params.tenantId);
    const wallet = await ensureWallet(tenant.id);
    res.json({ success: true, data: { tenant, wallet } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wallets/:tenantId/transactions
router.get(
  "/:tenantId/transactions",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertTenantAccess(req, req.params.tenantId);
      const q = transactionQuerySchema.parse(req.query);
      const [total, items] = await prisma.$transaction([
        prisma.walletTransaction.count({
          where: { tenantId: req.params.tenantId },
        }),
        prisma.walletTransaction.findMany({
          where: { tenantId: req.params.tenantId },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: {
            actorUser: { select: { id: true, name: true, email: true, role: true } },
            counterpartyWallet: {
              select: {
                id: true,
                tenant: { select: { id: true, name: true, type: true } },
              },
            },
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          items: items.map((item) => ({
            ...item,
            metadata: parseTransactionMetadata(item.metadata),
          })),
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

// PATCH /api/v1/wallets/:tenantId/settings
router.patch(
  "/:tenantId/settings",
  requirePermission(Permissions.WALLET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertTenantAccess(req, req.params.tenantId);
      const body = settingsSchema.parse(req.body);
      const wallet = await updateWalletSettings({
        tenantId: req.params.tenantId,
        ...body,
      });

      await logAudit({
        tenantId: req.params.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Wallet",
        resourceId: wallet.id,
        newValues: body,
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: wallet });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/wallets/:tenantId/adjust
router.post(
  "/:tenantId/adjust",
  requirePermission(Permissions.WALLET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await assertTenantAccess(req, req.params.tenantId);
      const body = adjustSchema.parse(req.body);
      const result = await adjustWallet({
        tenantId: req.params.tenantId,
        actorUserId: req.userId,
        ...body,
      });

      await logAudit({
        tenantId: req.params.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Wallet",
        resourceId: result.wallet.id,
        newValues: {
          transactionId: result.transaction.id,
          direction: body.direction,
          amountCredits: body.amountCredits,
          reason: body.reason,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/wallets/transfer
router.post(
  "/transfer",
  requirePermission(Permissions.WALLET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = transferSchema.parse(req.body);
      await assertTenantAccess(req, body.fromTenantId);
      await assertTenantAccess(req, body.toTenantId);
      const result = await transferWalletCredits({
        ...body,
        actorUserId: req.userId,
      });

      await logAudit({
        tenantId: body.fromTenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Wallet",
        resourceId: result.from.wallet.id,
        newValues: {
          transferOutTransactionId: result.from.transaction.id,
          transferInTransactionId: result.to.transaction.id,
          toTenantId: body.toTenantId,
          amountCredits: body.amountCredits,
          reason: body.reason,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
