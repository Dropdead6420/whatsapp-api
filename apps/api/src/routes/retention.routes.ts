import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import { RetentionTier, RetentionMode } from "@nexaflow/db";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireFeature } from "../services/features.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  listRetention,
  getRetentionConfig,
  upsertRetentionConfig,
  runRetentionAutopilot,
} from "../services/contactRetention.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireFeature("retentionEngine"),
  requirePermission(Permissions.CONTACT_READ),
);

const listSchema = z.object({
  refresh: z.coerce.boolean().default(false),
  tier: z.nativeEnum(RetentionTier).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const configSchema = z.object({
  mode: z.nativeEnum(RetentionMode).optional(),
  winbackSequenceId: z.string().min(1).nullable().optional(),
  maxEnrollPerRun: z.number().int().min(1).max(500).optional(),
});

const autopilotRunSchema = z.object({
  dryRun: z.boolean().default(false),
});

/**
 * GET /api/v1/retention
 *
 * AI Retention Engine — customer-facing. Returns this tenant's contacts
 * scored into ACTIVE / COOLING / DORMANT / LOST tiers with a per-contact
 * recommendation, sorted worst-first. `refresh=true` recomputes today's
 * scores; otherwise the latest persisted scan is served. `tier` filters
 * the rows; tier totals always reflect the full scanned set.
 */
router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = listSchema.parse(req.query);
      const summary = await listRetention({
        tenantId: req.tenantId!,
        refresh: query.refresh,
        tier: query.tier,
        limit: query.limit,
      });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/retention/config — current win-back autopilot config.
 */
router.get(
  "/config",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const config = await getRetentionConfig(req.tenantId!);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/v1/retention/config — set mode / win-back sequence / cap.
 * Changing the mode is a meaningful automation decision, so it's audited.
 */
router.put(
  "/config",
  requirePermission(Permissions.DRIP_SEQUENCE_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = configSchema.parse(req.body);
      const config = await upsertRetentionConfig({
        tenantId: req.tenantId!,
        mode: body.mode,
        winbackSequenceId: body.winbackSequenceId,
        maxEnrollPerRun: body.maxEnrollPerRun,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "RETENTION_CONFIG",
        newValues: {
          mode: config.mode,
          winbackSequenceId: config.winbackSequenceId,
          maxEnrollPerRun: config.maxEnrollPerRun,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/retention/autopilot/run — run the win-back autopilot now.
 * `dryRun:true` returns the candidate count without enrolling. A real run
 * (AUTOPILOT mode) is audited with the enrolled count.
 */
router.post(
  "/autopilot/run",
  requirePermission(Permissions.DRIP_SEQUENCE_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { dryRun } = autopilotRunSchema.parse(req.body ?? {});
      const result = await runRetentionAutopilot({
        tenantId: req.tenantId!,
        dryRun,
        triggeredBy: "manual",
      });
      if (!dryRun && result.enrolled > 0) {
        await logAudit({
          tenantId: req.tenantId!,
          userId: req.userId!,
          action: "CREATE",
          resource: "RETENTION_AUTOPILOT_RUN",
          newValues: {
            enrolled: result.enrolled,
            skipped: result.skipped,
            winbackSequenceId: result.winbackSequenceId,
          },
          ...extractRequestMeta(req),
        });
      }
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
