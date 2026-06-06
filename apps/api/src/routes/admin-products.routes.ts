import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  prisma,
  Prisma,
  ProductAccessSource,
  ProductCategory,
  TenantStatus,
  TenantType,
} from "@nexaflow/db";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();

router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const productKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9_]+$/);

const productWriteSchema = z.object({
  key: productKeySchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  category: z.nativeEnum(ProductCategory).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  routeHref: z.string().trim().max(200).nullable().optional(),
  featureKey: z.string().trim().max(80).nullable().optional(),
  icon: z.string().trim().max(80).nullable().optional(),
  isGlobalEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  metadata: z.unknown().nullable().optional(),
});

const productCreateSchema = productWriteSchema.extend({
  key: productKeySchema,
  name: z.string().trim().min(1).max(120),
  category: z.nativeEnum(ProductCategory).default(ProductCategory.CORE),
});

const addOnSchema = z.object({
  key: productKeySchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceInPaisa: z.number().int().min(0).optional(),
  billingCycle: z.string().trim().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
  metadata: z.unknown().nullable().optional(),
});

const addOnCreateSchema = addOnSchema.extend({
  key: productKeySchema,
  name: z.string().trim().min(1).max(120),
});

const accessWriteSchema = z.object({
  enabled: z.boolean(),
  limits: z.unknown().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

function auditTenant(req: RequestWithAuth, fallbackTenantId: string): string {
  return req.tenantId ?? fallbackTenantId;
}

function jsonInput(value: unknown):
  | Prisma.NullableJsonNullValueInput
  | Prisma.InputJsonValue
  | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

async function getProductByKey(productKey: string) {
  const product = await prisma.product.findUnique({ where: { key: productKey } });
  if (!product) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Product not found.");
  }
  return product;
}

// GET /api/v1/admin/products
router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const [products, partners, customers] = await Promise.all([
      prisma.product.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          addOns: { orderBy: { name: "asc" } },
          _count: {
            select: {
              partnerAccesses: true,
              customerAccesses: true,
            },
          },
        },
      }),
      prisma.tenant.findMany({
        where: {
          type: TenantType.WHITE_LABEL,
          status: { not: TenantStatus.DELETED },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true },
      }),
      prisma.tenant.findMany({
        where: {
          type: { in: [TenantType.BUSINESS, TenantType.DIRECT] },
          status: { not: TenantStatus.DELETED },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true, parentTenantId: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        products,
        partners,
        customers,
        terminology: {
          public: "Customer",
          internal: "Tenant",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/products
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = productCreateSchema.parse(req.body);
    const product = await prisma.product.create({
      data: {
        key: body.key,
        name: body.name,
        category: body.category,
        description: body.description,
        routeHref: body.routeHref,
        featureKey: body.featureKey,
        icon: body.icon,
        isGlobalEnabled: body.isGlobalEnabled ?? true,
        sortOrder: body.sortOrder ?? 1000,
        metadata: jsonInput(body.metadata),
      },
    });

    await logAudit({
      tenantId: auditTenant(req, product.id),
      userId: req.userId!,
      action: "CREATE",
      resource: "Product",
      resourceId: product.id,
      newValues: { key: product.key, name: product.name },
      ...extractRequestMeta(req),
    });

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/admin/products/partners/:partnerId/:productKey
router.patch(
  "/partners/:partnerId/:productKey",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = accessWriteSchema.parse(req.body);
      const [partner, product] = await Promise.all([
        prisma.tenant.findFirst({
          where: {
            id: req.params.partnerId,
            type: TenantType.WHITE_LABEL,
            status: { not: TenantStatus.DELETED },
          },
          select: { id: true, name: true },
        }),
        getProductByKey(req.params.productKey),
      ]);
      if (!partner) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Partner not found.");
      }

      const access = await prisma.partnerProductAccess.upsert({
        where: {
          partnerTenantId_productId: {
            partnerTenantId: partner.id,
            productId: product.id,
          },
        },
        update: {
          enabled: body.enabled,
          limits: jsonInput(body.limits),
          expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
          source: ProductAccessSource.SUPER_ADMIN,
          updatedByUserId: req.userId,
        },
        create: {
          partnerTenantId: partner.id,
          productId: product.id,
          enabled: body.enabled,
          limits: jsonInput(body.limits),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          source: ProductAccessSource.SUPER_ADMIN,
          createdByUserId: req.userId,
          updatedByUserId: req.userId,
        },
      });

      await logAudit({
        tenantId: auditTenant(req, partner.id),
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerProductAccess",
        resourceId: access.id,
        newValues: {
          partnerTenantId: partner.id,
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

// PATCH /api/v1/admin/products/customers/:customerId/:productKey
router.patch(
  "/customers/:customerId/:productKey",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = accessWriteSchema.parse(req.body);
      const [customer, product] = await Promise.all([
        prisma.tenant.findFirst({
          where: {
            id: req.params.customerId,
            type: { in: [TenantType.BUSINESS, TenantType.DIRECT] },
            status: { not: TenantStatus.DELETED },
          },
          select: { id: true, name: true, parentTenantId: true },
        }),
        getProductByKey(req.params.productKey),
      ]);
      if (!customer) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
      }

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
          expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
          source: ProductAccessSource.SUPER_ADMIN,
          partnerTenantId: customer.parentTenantId,
          updatedByUserId: req.userId,
        },
        create: {
          customerTenantId: customer.id,
          partnerTenantId: customer.parentTenantId,
          productId: product.id,
          enabled: body.enabled,
          limits: jsonInput(body.limits),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          source: ProductAccessSource.SUPER_ADMIN,
          createdByUserId: req.userId,
          updatedByUserId: req.userId,
        },
      });

      await logAudit({
        tenantId: auditTenant(req, customer.id),
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

// POST /api/v1/admin/products/:productKey/add-ons
router.post(
  "/:productKey/add-ons",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = addOnCreateSchema.parse(req.body);
      const product = await getProductByKey(req.params.productKey);
      const addOn = await prisma.productAddOn.create({
        data: {
          productId: product.id,
          key: body.key,
          name: body.name,
          description: body.description,
          priceInPaisa: body.priceInPaisa ?? 0,
          billingCycle: body.billingCycle ?? "monthly",
          isActive: body.isActive ?? true,
          metadata: jsonInput(body.metadata),
        },
      });

      await logAudit({
        tenantId: auditTenant(req, product.id),
        userId: req.userId!,
        action: "CREATE",
        resource: "ProductAddOn",
        resourceId: addOn.id,
        newValues: { productKey: product.key, addOnKey: addOn.key },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: addOn });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/products/:productKey/add-ons/:addOnKey
router.patch(
  "/:productKey/add-ons/:addOnKey",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = addOnSchema.parse(req.body);
      const product = await getProductByKey(req.params.productKey);
      const existing = await prisma.productAddOn.findUnique({
        where: {
          productId_key: {
            productId: product.id,
            key: req.params.addOnKey,
          },
        },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Add-on not found.");
      }

      const addOn = await prisma.productAddOn.update({
        where: { id: existing.id },
        data: {
          key: body.key,
          name: body.name,
          description: body.description,
          priceInPaisa: body.priceInPaisa,
          billingCycle: body.billingCycle,
          isActive: body.isActive,
          metadata: jsonInput(body.metadata),
        },
      });

      await logAudit({
        tenantId: auditTenant(req, product.id),
        userId: req.userId!,
        action: "UPDATE",
        resource: "ProductAddOn",
        resourceId: addOn.id,
        newValues: { productKey: product.key, addOnKey: addOn.key },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: addOn });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/products/:productKey
router.patch(
  "/:productKey",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = productWriteSchema.parse(req.body);
      const product = await getProductByKey(req.params.productKey);
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: {
          key: body.key,
          name: body.name,
          category: body.category,
          description: body.description,
          routeHref: body.routeHref,
          featureKey: body.featureKey,
          icon: body.icon,
          isGlobalEnabled: body.isGlobalEnabled,
          sortOrder: body.sortOrder,
          metadata: jsonInput(body.metadata),
        },
      });

      await logAudit({
        tenantId: auditTenant(req, product.id),
        userId: req.userId!,
        action: "UPDATE",
        resource: "Product",
        resourceId: product.id,
        oldValues: { key: product.key, isGlobalEnabled: product.isGlobalEnabled },
        newValues: {
          key: updated.key,
          name: updated.name,
          isGlobalEnabled: updated.isGlobalEnabled,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
