// ============================================================================
// Tenant-scoped language settings
// Final Currency/Language PDF §9: customer language defaults + RTL metadata.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireTenantScope, RequestWithAuth } from "../middleware/auth";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  getTenantLanguageContext,
  setTenantLanguagePreference,
} from "../services/languageSettings.service";

const router = Router();

router.use(requireAuth, requireTenantScope);

const preferenceSchema = z.object({
  languageCode: z.string().trim().min(1).max(16),
  locale: z.string().trim().min(2).max(20).optional(),
});

// GET /api/v1/language-settings
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const context = await getTenantLanguageContext(req.tenantId!);
    res.json({ success: true, data: context });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/language-settings
router.patch("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = preferenceSchema.parse(req.body);
    const row = await setTenantLanguagePreference({
      tenantId: req.tenantId!,
      languageCode: body.languageCode,
      locale: body.locale,
      createdByUserId: req.userId!,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CustomerLanguageSetting",
      resourceId: row.id,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: await getTenantLanguageContext(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
