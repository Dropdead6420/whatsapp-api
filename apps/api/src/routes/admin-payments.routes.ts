// ============================================================================
// SuperAdmin payment operations routes (Claude FINAL §4)
//
// Read-only payment + webhook log views for debugging the recharge
// pipeline. SUPER_ADMIN only — these expose every tenant's payment
// activity, so they're not partner- or customer-scoped.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  listPaymentOrders,
  listPaymentWebhookLogs,
  parsePaymentOrderFilters,
  parsePaymentWebhookFilters,
} from "../services/paymentOps.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

router.get(
  "/orders",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const filters = parsePaymentOrderFilters(req.query);
      const items = await listPaymentOrders(filters);
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/webhooks",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const filters = parsePaymentWebhookFilters(req.query);
      const items = await listPaymentWebhookLogs(filters);
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
