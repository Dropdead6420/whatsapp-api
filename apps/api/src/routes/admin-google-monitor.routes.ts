// ============================================================================
// Google API Monitor (AdGrowly planning PDF §4). SUPER_ADMIN observability over
// Google Business Profile connections: per-location connection health, sync
// errors, rate limits and a raw API log feed. Read-mostly; log ingest is for
// sync workers / integrations.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { GoogleApiLogStatus } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getMonitorOverview, listLogs, recordLog } from "../services/googleApiMonitor.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const overviewSchema = z.object({ tenantId: z.string().trim().max(64).optional() });

const logListSchema = z.object({
  tenantId: z.string().trim().max(64).optional(),
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GoogleApiLogStatus).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const recordLogSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  locationId: z.string().cuid().optional(),
  operation: z.string().trim().min(1).max(120),
  status: z.nativeEnum(GoogleApiLogStatus).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  message: z.string().trim().max(2000).optional(),
  rateLimitRemaining: z.number().int().min(0).max(1_000_000).optional(),
  durationMs: z.number().int().min(0).max(600000).optional(),
});

router.get("/overview", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getMonitorOverview(overviewSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.get("/logs", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listLogs(logListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

// Ingest a Google API log entry (sync workers / integrations).
router.post("/logs", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const log = await recordLog(recordLogSchema.parse(req.body));
    res.status(201).json({ success: true, data: log });
  } catch (err) {
    next(err);
  }
});

export default router;
