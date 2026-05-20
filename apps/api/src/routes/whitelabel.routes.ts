import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  ErrorCodes,
  Permissions,
} from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  getBranding,
  updateBranding,
  resetBrandingField,
  generateBrandingCss,
} from "../services/whitelabel.service";

const router = Router();

// ============================================================================
// SCHEMAS
// ============================================================================

const updateBrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  logoSquareUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  secondaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  accentColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  fontFamily: z.string().min(1).max(100).optional(),
  fontUrl: z.string().url().optional(),
  customCss: z.string().max(10000).optional(),
});

const resetFieldSchema = z.object({
  field: z.enum([
    "logoUrl",
    "logoSquareUrl",
    "faviconUrl",
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "fontFamily",
    "fontUrl",
    "customCss",
  ]),
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

router.use(requireAuth);
router.use(
  requirePermission(Permissions.WHITELABEL_CONFIG)
);

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/v1/partner/whitelabel
 * 
 * Get current branding configuration
 * - Returns existing branding or creates default
 */
router.get("/", async (req: RequestWithAuth, res, next) => {
  try {
    const branding = await getBranding(req.tenantId!);

    res.json({
      success: true,
      data: branding,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/partner/whitelabel/css
 * 
 * Generate CSS for branding
 * - Returns CSS variables that can be injected into frontend
 */
router.get("/css", async (req: RequestWithAuth, res, next) => {
  try {
    const branding = await getBranding(req.tenantId!);
    const css = generateBrandingCss(branding);

    res.setHeader("Content-Type", "text/css");
    res.send(css);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/partner/whitelabel
 * 
 * Update branding configuration
 * - Validates all inputs (colors, URLs)
 * - Supports partial updates
 */
router.put("/", async (req: RequestWithAuth, res, next) => {
  try {
    const body = updateBrandingSchema.parse(req.body);

    const updated = await updateBranding(req.tenantId!, body);

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "BRANDING",
      resourceId: updated.id,
      newValues: {
        changes: Object.keys(body).filter(
          (key) => body[key as keyof typeof body] !== undefined
        ),
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/partner/whitelabel/reset
 * 
 * Reset a specific branding field to default
 */
router.post("/reset", async (req: RequestWithAuth, res, next) => {
  try {
    const body = resetFieldSchema.parse(req.body);

    const updated = await resetBrandingField(
      req.tenantId!,
      body.field as any
    );

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "BRANDING",
      resourceId: updated.id,
      newValues: {
        resetField: body.field,
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/partner/whitelabel/:field
 * 
 * Delete (clear) a specific branding field
 */
router.delete("/:field", async (req: RequestWithAuth, res, next) => {
  try {
    const { field } = req.params;

    // Validate field name
    const validFields = [
      "logoUrl",
      "logoSquareUrl",
      "faviconUrl",
      "customCss",
      "fontUrl",
    ];

    if (!validFields.includes(field)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Cannot delete field '${field}'. Only clearable fields: ${validFields.join(", ")}`
      );
    }

    const updated = await resetBrandingField(
      req.tenantId!,
      field as any
    );

    // Audit log
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "BRANDING",
      resourceId: updated.id,
      newValues: {
        deletedField: field,
      },
      ...extractRequestMeta(req),
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
