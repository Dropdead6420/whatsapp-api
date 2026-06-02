// ============================================================================
// Admin recharge-request review (Claude FINAL §4 — manual bank transfer)
//
// SuperAdmin lists pending requests, opens proof, and either approves
// (credit booked via adjustWallet) or rejects (no credit). Both
// actions are audit-logged with IMPERSONATION_BLOCKED guarantees from
// the global dangerous-action gate (mutating money paths under
// /api/v1/wallets are blocked from impersonators; the request route
// here lives under /api/v1/admin/ and is gated by requireRole anyway).
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  approveRechargeRequest,
  listRechargeRequests,
  rejectRechargeRequest,
} from "../services/rechargeRequest.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const decisionSchema = z.object({
  adminNotes: z.string().trim().max(1024).optional(),
});

const STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED"] as const;

const listQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  tenantId: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const n = Number.parseInt(v, 10);
      return Number.isNaN(n) ? undefined : Math.min(200, Math.max(1, n));
    }),
});

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = listQuerySchema.parse(req.query);
      const items = await listRechargeRequests({
        tenantId: query.tenantId,
        status: query.status,
        limit: query.limit,
      });
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/approve",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (req.impersonating) {
        // Belt-and-suspenders: even though dangerousActionGuard
        // doesn't list this exact path, money-moving + ledger-writing
        // actions should never be done while impersonating. An
        // impersonator's audit context is the *target*, not the
        // operator — wrong attribution for a financial action.
        throw new ApiError(
          ErrorCodes.IMPERSONATION_BLOCKED,
          403,
          "Approving a recharge request is not allowed during impersonation. Exit impersonation and retry with your own credentials.",
        );
      }
      const body = decisionSchema.parse(req.body);
      const updated = await approveRechargeRequest({
        id: req.params.id,
        approverUserId: req.userId!,
        adminNotes: body.adminNotes,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "recharge_request",
        resourceId: updated.id,
        newValues: {
          status: "APPROVED",
          amount: updated.amount,
          ledgerTransactionId: updated.ledgerTransactionId,
          adminNotes: updated.adminNotes,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/reject",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (req.impersonating) {
        throw new ApiError(
          ErrorCodes.IMPERSONATION_BLOCKED,
          403,
          "Rejecting a recharge request is not allowed during impersonation.",
        );
      }
      const body = decisionSchema.parse(req.body);
      const updated = await rejectRechargeRequest({
        id: req.params.id,
        approverUserId: req.userId!,
        adminNotes: body.adminNotes,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "recharge_request",
        resourceId: updated.id,
        newValues: { status: "REJECTED", adminNotes: updated.adminNotes },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
