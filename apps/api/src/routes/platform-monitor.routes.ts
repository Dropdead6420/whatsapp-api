import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import {
  PlatformActionCode,
  PlatformActionSeverity,
  PlatformActionStatus,
} from "@nexaflow/db";
import {
  requireAuth,
  RequestWithAuth,
} from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  listItems,
  runDailyScan,
  updateItemStatus,
} from "../services/platformMonitor.service";

const router = Router();
// Platform Monitor is the SuperAdmin's triage queue — no tenant scope.
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const listSchema = z.object({
  status: z.nativeEnum(PlatformActionStatus).optional(),
  severity: z.nativeEnum(PlatformActionSeverity).optional(),
  code: z.nativeEnum(PlatformActionCode).optional(),
  tenantId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

router.get(
  "/items",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const filter = listSchema.parse(req.query);
      const rows = await listItems(filter);
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

const patchSchema = z.object({
  status: z.nativeEnum(PlatformActionStatus),
  snoozedUntil: z.coerce.date().optional(),
});

router.patch(
  "/items/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = patchSchema.parse(req.body);
      const updated = await updateItemStatus({
        itemId: req.params.id,
        status: body.status,
        userId: req.userId!,
        snoozedUntil: body.snoozedUntil ?? null,
      });
      await logAudit({
        tenantId: updated.targetTenantId ?? req.userId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PlatformActionItem",
        resourceId: updated.id,
        newValues: { status: body.status, code: updated.code },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/refresh",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const result = await runDailyScan();
      await logAudit({
        tenantId: req.userId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "PlatformActionScan",
        resourceId: req.userId!,
        newValues: result as unknown as Record<string, unknown>,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
