// ============================================================================
// SuperAdmin credit-line routes (Claude FINAL §4, slice 8)
//
// All routes are SUPER_ADMIN-only. Granting a credit line is a
// finance decision; we don't let partners do it (they could front-
// load risk onto the platform). Impersonators are blocked from any
// mutation here — credit decisions must be attributed to the actor's
// own user id.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  closeCreditLine,
  listCreditLines,
  openCreditLine,
  reactivateCreditLine,
  suspendCreditLine,
} from "../services/creditLine.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

function blockIfImpersonating(req: RequestWithAuth): void {
  if (req.impersonating) {
    throw new ApiError(
      ErrorCodes.IMPERSONATION_BLOCKED,
      403,
      "Credit-line mutations require your own credentials. Exit impersonation and retry.",
    );
  }
}

const openSchema = z.object({
  tenantId: z.string().min(1),
  limitCredits: z.number().int().positive(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(1024).optional(),
});

const transitionSchema = z.object({
  notes: z.string().trim().max(1024).optional(),
});

const STATUS_VALUES = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;

const listQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  status: z.enum(STATUS_VALUES).optional(),
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
      const items = await listCreditLines({
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
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      blockIfImpersonating(req);
      const body = openSchema.parse(req.body);
      const created = await openCreditLine({
        tenantId: body.tenantId,
        limitCredits: body.limitCredits,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        approvedByUserId: req.userId!,
        notes: body.notes,
      });
      await logAudit({
        tenantId: body.tenantId,
        userId: req.userId!,
        action: "CREATE",
        resource: "credit_line",
        resourceId: created.id,
        newValues: {
          limitCredits: created.limitCredits,
          dueDate: created.dueDate,
          notes: created.notes,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/suspend",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      blockIfImpersonating(req);
      const body = transitionSchema.parse(req.body);
      const updated = await suspendCreditLine({
        id: req.params.id,
        approverUserId: req.userId!,
        notes: body.notes,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "credit_line",
        resourceId: updated.id,
        newValues: { status: "SUSPENDED", notes: updated.notes },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/reactivate",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      blockIfImpersonating(req);
      const body = transitionSchema.parse(req.body);
      const updated = await reactivateCreditLine({
        id: req.params.id,
        approverUserId: req.userId!,
        notes: body.notes,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "credit_line",
        resourceId: updated.id,
        newValues: { status: "ACTIVE", notes: updated.notes },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/close",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      blockIfImpersonating(req);
      const body = transitionSchema.parse(req.body);
      const updated = await closeCreditLine({
        id: req.params.id,
        approverUserId: req.userId!,
        notes: body.notes,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "credit_line",
        resourceId: updated.id,
        newValues: { status: "CLOSED", notes: updated.notes },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
