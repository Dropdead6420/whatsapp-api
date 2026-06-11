// ============================================================================
// SuperAdmin "Manage Defaults" — default subscription pricing per scope
// (PARTNER vs SELF). GET lists a scope's plans; PUT upserts the batch. Every
// save is audited. SUPER_ADMIN only.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { PricingScope } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { listPricingDefaults, upsertPricingDefaults } from "../services/planPricing.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const scopeQuerySchema = z.object({ scope: z.nativeEnum(PricingScope).default(PricingScope.PARTNER) });

const price = z.number().int().nonnegative().max(100_000_000).optional();
const upsertSchema = z.object({
  scope: z.nativeEnum(PricingScope),
  plans: z
    .array(
      z.object({
        planName: z.string().trim().min(1).max(80),
        sortOrder: z.number().int().optional(),
        monthlyPaisa: price,
        quarterlyPaisa: price,
        yearlyPaisa: price,
        addLocationMonthlyPaisa: price,
        addLocationQuarterlyPaisa: price,
        addLocationYearlyPaisa: price,
      }),
    )
    .max(50),
});

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { scope } = scopeQuerySchema.parse(req.query);
    res.json({ success: true, data: await listPricingDefaults(scope) });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { scope, plans } = upsertSchema.parse(req.body);
    const saved = await upsertPricingDefaults(scope, plans, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "PlanPricingDefault",
      resourceId: scope,
      newValues: { scope, plans: saved.length },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: saved });
  } catch (err) {
    next(err);
  }
});

export default router;
