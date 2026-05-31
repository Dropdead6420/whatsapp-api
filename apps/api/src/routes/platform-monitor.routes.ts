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
  runPlatformMonitorSummary,
  getLastSummaryRun,
  triggerSummaryNow,
} from "../services/platformMonitor.service";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

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

// POST /api/v1/admin/platform-monitor/summary
//
// LLM-prioritized top-3 action plan over the current open triage queue.
// Generate-only — never mutates items, never auto-resolves. Falls back
// to a deterministic "rescue-the-URGENT items first" list when the LLM
// is unavailable. Billed to the SuperAdmin's own tenant via the
// existing assertCanAffordAi gate.
router.post(
  "/summary",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Caller must have a tenant context to bill the LLM summary.",
        );
      }
      const summary = await runPlatformMonitorSummary({
        billToTenantId: req.tenantId,
      });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/platform-monitor/summary/last-run
//
// Inspect when the scheduled summary last fired and what it did. Reads
// BullMQ's own completed-jobs storage — no separate state to maintain.
// Returns null when the worker hasn't produced a summary yet.
router.get(
  "/summary/last-run",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const lastRun = await getLastSummaryRun();
      res.json({ success: true, data: lastRun });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/platform-monitor/summary/send-now
//
// Manually trigger one scheduled summary run. Useful for verifying FCM
// setup after first-time configuration, or forcing a digest after a
// long quiet stretch. The worker picks up the job and the result
// surfaces via /summary/last-run within a second or two.
//
// Idempotent within a 5-second window — a double-tap collapses to one
// job so the operator can't burn two LLM calls by accident.
router.post(
  "/summary/send-now",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const result = await triggerSummaryNow();
      await logAudit({
        tenantId: req.tenantId ?? req.userId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "PlatformSummaryRun",
        resourceId: result.jobId ?? "manual",
        newValues: { trigger: "manual", jobId: result.jobId },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
