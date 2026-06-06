import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { getContactTimeline } from "../services/cdpTimeline.service";

// CDP routes (Complete Planning PDF §2.12). Unified per-contact activity
// timeline across conversations, calls, appointments and leads. Read-only,
// tenant-scoped, gated by CONTACT_READ.

const router = Router();
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.CONTACT_READ));

const timelineSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  "/contacts/:id/timeline",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { limit } = timelineSchema.parse(req.query);
      const data = await getContactTimeline(req.tenantId!, req.params.id, limit ?? 50);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
