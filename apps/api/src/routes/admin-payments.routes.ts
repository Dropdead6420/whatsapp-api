// ============================================================================
// SuperAdmin payment operations routes (Claude FINAL §4)
//
// Read-only payment + webhook log views for debugging the recharge
// pipeline. SUPER_ADMIN only — these expose every tenant's payment
// activity, so they're not partner- or customer-scoped.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { UserRole } from "@nexaflow/shared";
import { z } from "zod";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  listInvoices,
  listPaymentGatewaySettings,
  listPaymentNotificationTemplates,
  listPaymentOrders,
  listPaymentWebhookLogs,
  parseInvoiceFilters,
  parsePaymentOrderFilters,
  parsePaymentWebhookFilters,
  updatePaymentGatewaySetting,
  updatePaymentNotificationTemplate,
} from "../services/paymentOps.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const gatewayPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.string().trim().min(1).max(40).optional(),
  credentialHint: z.string().trim().max(600).nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
});

const notificationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().trim().min(1).max(240).optional(),
  message: z.string().trim().min(1).max(4000).optional(),
});

router.get(
  "/settings",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const [gateways, notifications] = await Promise.all([
        listPaymentGatewaySettings(),
        listPaymentNotificationTemplates(),
      ]);
      res.json({ success: true, data: { gateways, notifications } });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/settings/gateways/:gateway",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = gatewayPatchSchema.parse(req.body);
      const saved = await updatePaymentGatewaySetting(
        req.params.gateway,
        body,
        req.userId,
      );
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PaymentGatewaySetting",
        resourceId: saved.gateway,
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: saved });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/settings/notifications/:event",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = notificationPatchSchema.parse(req.body);
      const saved = await updatePaymentNotificationTemplate(
        req.params.event,
        body,
        req.userId,
      );
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PaymentNotificationTemplate",
        resourceId: saved.event,
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: saved });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/invoices",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const filters = parseInvoiceFilters(req.query);
      const items = await listInvoices(filters);
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

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
