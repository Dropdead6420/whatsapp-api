// ============================================================================
// SuperAdmin Partners overview (admin console "Partners Wallet Management").
// Read-only: lists every partner with wallet balance + org counts. SUPER_ADMIN
// only. No mutations here — credit top-ups live in the existing wallet/recharge
// routes.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { listPartnerOverview } from "../services/partnerOverview.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerOverview() });
  } catch (err) {
    next(err);
  }
});

export default router;
