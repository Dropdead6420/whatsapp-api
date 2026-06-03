import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { NumberMigrationStatus } from "@nexaflow/db";
import { Permissions, UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission, requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  NUMBER_MIGRATION_LIVE_STATUSES,
  allowedNextStatuses,
  createNumberMigration,
  isCancellable,
  listNumberMigrations,
  nextActionLabel,
  resendNumberMigrationOtp,
  transitionNumberMigration,
} from "../services/numberMigration.service";

const router = Router();

// Number migration is a platform operator workflow. A Business Admin can
// configure their own WABA, but migrating numbers between BSPs affects
// provider routing, templates, webhook cutover, and customer downtime,
// so SuperAdmin owns the command surface.
router.use(
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  requirePermission(Permissions.PROVIDER_ROUTE_MANAGE),
);

const listSchema = z.object({
  tenantId: z.string().cuid().optional(),
  status: z.nativeEnum(NumberMigrationStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, for example +919876543210.");

const createSchema = z.object({
  tenantId: z.string().cuid(),
  phoneNumber: phoneSchema,
  targetWabaId: z.string().trim().min(1).max(120).nullable().optional(),
});

const transitionSchema = z.object({
  status: z.nativeEnum(NumberMigrationStatus),
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

const resendOtpSchema = z.object({
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

router.get(
  "/statuses",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const statuses = Object.values(NumberMigrationStatus).map((status) => ({
        status,
        live: NUMBER_MIGRATION_LIVE_STATUSES.includes(status),
        cancellable: isCancellable(status),
        nextActionLabel: nextActionLabel(status),
        allowedNextStatuses: allowedNextStatuses(status),
      }));
      res.json({ success: true, data: statuses });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const data = await listNumberMigrations(q);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const created = await createNumberMigration({
        tenantId: body.tenantId,
        phoneNumber: body.phoneNumber,
        targetWabaId: body.targetWabaId,
        createdByUserId: req.userId!,
      });
      await logAudit({
        tenantId: created.tenantId,
        userId: req.userId!,
        action: "CREATE",
        resource: "NumberMigration",
        resourceId: created.id,
        newValues: {
          phoneNumber: created.phoneNumber,
          targetWabaId: created.targetWabaId,
          status: created.status,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id/transition",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = transitionSchema.parse(req.body);
      const updated = await transitionNumberMigration({
        id: req.params.id,
        toStatus: body.status,
        reason: body.reason,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "NumberMigration",
        resourceId: updated.id,
        newValues: {
          status: updated.status,
          statusReason: updated.statusReason,
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
  "/:id/resend-otp",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = resendOtpSchema.parse(req.body);
      const updated = await resendNumberMigrationOtp({
        id: req.params.id,
        reason: body.reason,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "NumberMigration",
        resourceId: updated.id,
        newValues: {
          status: updated.status,
          otpRequestedAt: updated.otpRequestedAt,
          action: "OTP_RESEND",
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
