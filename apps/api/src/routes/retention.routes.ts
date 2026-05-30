import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import { RetentionTier } from "@nexaflow/db";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireFeature } from "../services/features.service";
import { listRetention } from "../services/contactRetention.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireFeature("retentionEngine"),
  requirePermission(Permissions.CONTACT_READ),
);

const listSchema = z.object({
  refresh: z.coerce.boolean().default(false),
  tier: z.nativeEnum(RetentionTier).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * GET /api/v1/retention
 *
 * AI Retention Engine — customer-facing. Returns this tenant's contacts
 * scored into ACTIVE / COOLING / DORMANT / LOST tiers with a per-contact
 * recommendation, sorted worst-first. `refresh=true` recomputes today's
 * scores; otherwise the latest persisted scan is served. `tier` filters
 * the rows; tier totals always reflect the full scanned set.
 */
router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = listSchema.parse(req.query);
      const summary = await listRetention({
        tenantId: req.tenantId!,
        refresh: query.refresh,
        tier: query.tier,
        limit: query.limit,
      });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
