// ============================================================================
// Customer self-recharge wallet routes (Claude FINAL §4-§5, slice 2)
//
// The PRD distinguishes this surface from the SuperAdmin manual
// wallet routes shipped earlier (/api/v1/wallets) — customers hit
// /api/v1/customer/wallets/* with their own tenant scope; admins use
// the management routes to credit/debit on the customer's behalf.
//
// The /recharge endpoint creates a PaymentOrder + Razorpay order and
// returns the Checkout.js init payload. Idempotency is mandatory:
// the client supplies a key that pins the row, so a network retry
// re-uses the same order instead of double-charging.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { initiateRazorpayRecharge } from "../services/paymentOrder.service";
import {
  createRechargeRequest,
  listRechargeRequests,
} from "../services/rechargeRequest.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const rechargeSchema = z.object({
  amount: z.number().int().positive(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .regex(/^[A-Z]{3}$/i, "Currency must be a 3-letter ISO code")
    .optional(),
  idempotencyKey: z.string().min(8).max(80),
  gateway: z.enum(["RAZORPAY"]).default("RAZORPAY"),
});

router.post(
  "/recharge",
  requirePermission(Permissions.WALLET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = rechargeSchema.parse(req.body);
      // Belt-and-suspenders: the gateway switch will broaden when
      // Stripe lands in slice 5. For now there's only one path.
      if (body.gateway !== "RAZORPAY") {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          `Gateway ${body.gateway} not yet supported.`,
        );
      }

      const result = await initiateRazorpayRecharge({
        tenantId: req.tenantId!,
        amount: body.amount,
        currency: body.currency,
        idempotencyKey: body.idempotencyKey,
        createdByUserId: req.userId,
      });

      // Only audit fresh orders — replays would spam the audit log.
      if (!result.replayed) {
        await logAudit({
          tenantId: req.tenantId!,
          userId: req.userId!,
          action: "CREATE",
          resource: "payment_order",
          resourceId: result.paymentOrder.id,
          newValues: {
            gateway: result.paymentOrder.gateway,
            amount: result.paymentOrder.amount,
            currency: result.paymentOrder.currency,
            gatewayOrderId: result.paymentOrder.gatewayOrderId,
          },
          ...extractRequestMeta(req),
        });
      }

      res.status(result.replayed ? 200 : 201).json({
        success: true,
        data: {
          orderId: result.paymentOrder.id,
          status: result.paymentOrder.status,
          replayed: result.replayed,
          init: result.init,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---- Manual bank transfer recharge requests (Claude FINAL §4) -------------

const rechargeRequestCreateSchema = z.object({
  amount: z.number().int().positive(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .regex(/^[A-Z]{3}$/i)
    .optional(),
  proofUrl: z.string().trim().max(1024).optional().nullable(),
  reference: z.string().trim().max(80).optional().nullable(),
  customerNote: z.string().trim().max(1024).optional().nullable(),
});

router.post(
  "/recharge-requests",
  requirePermission(Permissions.WALLET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = rechargeRequestCreateSchema.parse(req.body);
      const created = await createRechargeRequest({
        tenantId: req.tenantId!,
        amount: body.amount,
        currency: body.currency,
        proofUrl: body.proofUrl ?? null,
        reference: body.reference ?? null,
        customerNote: body.customerNote ?? null,
        createdByUserId: req.userId,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "recharge_request",
        resourceId: created.id,
        newValues: {
          amount: created.amount,
          currency: created.currency,
          reference: created.reference,
          proofUrl: created.proofUrl,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/recharge-requests",
  requirePermission(Permissions.WALLET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      // Customer only sees their own tenant's requests — pass tenantId
      // explicitly so an admin imitating this surface stays scoped too.
      const items = await listRechargeRequests({ tenantId: req.tenantId });
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
