// ============================================================================
// Tenant-scoped currency settings
// Final Complete Currency/Language PDF §7: customer currency defaults.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireTenantScope, RequestWithAuth } from "../middleware/auth";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  getTenantCurrencyContext,
  setTenantCurrencyPreference,
} from "../services/currencySettings.service";

const router = Router();

router.use(requireAuth, requireTenantScope);

const preferenceSchema = z.object({
  currencyCode: z.string().trim().min(1).max(8),
  locale: z.string().trim().min(2).max(20).optional(),
  showConvertedAmounts: z.boolean().optional(),
});

// GET /api/v1/currency-settings
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const context = await getTenantCurrencyContext(req.tenantId!);
    res.json({ success: true, data: context });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/currency-settings
router.patch("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = preferenceSchema.parse(req.body);
    const row = await setTenantCurrencyPreference({
      tenantId: req.tenantId!,
      currencyCode: body.currencyCode,
      locale: body.locale,
      showConvertedAmounts: body.showConvertedAmounts,
      createdByUserId: req.userId!,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CustomerCurrencySetting",
      resourceId: row.id,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: await getTenantCurrencyContext(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
