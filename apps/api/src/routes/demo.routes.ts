import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  ErrorCodes,
  Permissions,
  UserRole,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import { requireFeature } from "../services/features.service";
import {
  createDemoTenant,
  renewDemoTenant,
  deleteDemoTenant,
  getDemoTenant,
  listPartnerDemos,
} from "../services/demo.service";
import { recommendDemoConversion } from "../services/demoConversion.service";

const router = Router();

// ============================================================================
// SCHEMAS
// ============================================================================

const createDemoSchema = z.object({
  demoName: z.string().min(3).max(100).optional(),
  expiryDays: z.number().int().min(7).max(90).default(30),
});

const renewDemoSchema = z.object({
  expiryDays: z.number().int().min(7).max(90).default(30),
});

const listDemosSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const recommendConversionSchema = z.object({
  useAi: z.boolean().default(true),
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

router.use(requireAuth, requireTenantScope);
router.use(
  requirePermission(Permissions.CLIENT_CREATE)
);

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/v1/partner/demo/create
 * 
 * Create a new demo tenant for the authenticated partner
 * - Tenant ID comes from JWT (not request body)
 * - Creates new BUSINESS tenant as child of partner
 * - Seeds sample data (contacts, templates, campaign)
 * - Returns credentials for demo access
 */
router.post("/create", async (req: RequestWithAuth, res, next) => {
  try {
    // Validate input
    const body = createDemoSchema.parse(req.body);

    // Verify partner tenant is WHITE_LABEL or DIRECT
    if (
      req.userRole !== UserRole.SUPER_ADMIN &&
      req.userRole !== UserRole.WHITE_LABEL_ADMIN
    ) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "Only partners can create demo tenants."
      );
    }

    // Create demo
    const demoInfo = await createDemoTenant({
      partnerTenantId: req.tenantId!,
      demoName: body.demoName,
      expiryDays: body.expiryDays,
    });

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DEMO_TENANT_CREATED",
      resource: "DEMO_TENANT",
      resourceId: demoInfo.demoTenantId,
      newValues: {
        demoTenantId: demoInfo.tenantId,
        expiresAt: demoInfo.expiresAt,
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: demoInfo,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/partner/demo
 * 
 * List all demo tenants created by the partner
 */
router.get("/", async (req: RequestWithAuth, res, next) => {
  try {
    const query = listDemosSchema.parse(req.query);

    const result = await listPartnerDemos(req.tenantId!, query.page, query.limit);

    res.json({
      success: true,
      data: result.demos,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/partner/demo/:demoId/recommend-conversion
 *
 * Automation-first Demo-to-Paid Engine. Scores demo engagement and returns
 * the next best partner follow-up.
 */
router.post(
  "/:demoId/recommend-conversion",
  requireFeature("demoToPaid"),
  async (req: RequestWithAuth, res, next) => {
    try {
      const body = recommendConversionSchema.parse(req.body ?? {});
      const recommendation = await recommendDemoConversion({
        partnerTenantId: req.tenantId!,
        demoId: req.params.demoId,
        useAi: body.useAi,
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DEMO_CONVERSION_RECOMMENDED",
        resource: "DEMO_TENANT",
        resourceId: req.params.demoId,
        newValues: {
          score: recommendation.score,
          stage: recommendation.stage,
          recommendedAction: recommendation.recommendedAction,
          aiUsed: recommendation.aiUsed,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: recommendation });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/partner/demo/:demoId
 * 
 * Get details of a specific demo tenant
 */
router.get("/:demoId", async (req: RequestWithAuth, res, next) => {
  try {
    const demo = await getDemoTenant(req.params.demoId);

    // Verify ownership (demo belongs to this partner)
    if (demo.createdByPartnerId !== req.tenantId) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "You do not have access to this demo."
      );
    }

    res.json({
      success: true,
      data: demo,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/partner/demo/:demoId/renew
 * 
 * Renew a demo tenant (extend expiry)
 * - Can only renew up to 2x (max 90 days total)
 */
router.post("/:demoId/renew", async (req: RequestWithAuth, res, next) => {
  try {
    const body = renewDemoSchema.parse(req.body);

    const demo = await getDemoTenant(req.params.demoId);

    // Verify ownership
    if (demo.createdByPartnerId !== req.tenantId) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "You do not have access to this demo."
      );
    }

    // Renew
    const result = await renewDemoTenant(req.params.demoId, body.expiryDays);

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DEMO_TENANT_RENEWED",
      resource: "DEMO_TENANT",
      resourceId: req.params.demoId,
      newValues: {
        newExpiresAt: result.expiresAt,
        renewalCount: result.renewalCount,
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/partner/demo/:demoId
 * 
 * Delete a demo tenant immediately
 * - Cascade deletes all related data
 */
router.delete("/:demoId", async (req: RequestWithAuth, res, next) => {
  try {
    const demo = await getDemoTenant(req.params.demoId);

    // Verify ownership
    if (demo.createdByPartnerId !== req.tenantId) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "You do not have access to this demo."
      );
    }

    // Delete
    await deleteDemoTenant(req.params.demoId);

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DEMO_TENANT_DELETED",
      resource: "DEMO_TENANT",
      resourceId: req.params.demoId,
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      message: "Demo tenant deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
