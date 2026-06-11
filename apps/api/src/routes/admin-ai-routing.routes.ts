// ============================================================================
// SuperAdmin "AI Settings" workload routing (AI Control Center). GET returns
// the full workload matrix (defaults + stored overrides); PUT upserts the batch.
// SUPER_ADMIN only, audited.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getGlobalAiSettings,
  listWorkloadRoutes,
  updateGlobalAiSettings,
  upsertWorkloadRoutes,
} from "../services/aiWorkloadRouting.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const upsertSchema = z.object({
  routes: z
    .array(
      z.object({
        workload: z.string().trim().min(1).max(40),
        enabled: z.boolean().optional(),
        provider: z.string().trim().max(80).optional(),
        model: z.string().trim().max(160).optional(),
      }),
    )
    .max(40),
});

const globalSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultProvider: z.string().trim().min(1).max(80).optional(),
  textModel: z.string().trim().min(1).max(160).optional(),
  embeddingsModel: z.string().trim().min(1).max(160).optional(),
  defaultLanguage: z.string().trim().min(1).max(80).optional(),
  defaultTone: z.string().trim().min(1).max(80).optional(),
  creativity: z.string().trim().min(1).max(80).optional(),
  maxInputLength: z.number().int().min(1).max(200_000).optional(),
  maxOutputLength: z.number().int().min(1).max(200_000).optional(),
});

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listWorkloadRoutes() });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/settings",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getGlobalAiSettings() });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/settings",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = globalSettingsSchema.parse(req.body);
      const saved = await updateGlobalAiSettings(body, req.userId);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AiGlobalSetting",
        resourceId: "global",
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: saved });
    } catch (err) {
      next(err);
    }
  },
);

router.put("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { routes } = upsertSchema.parse(req.body);
    const saved = await upsertWorkloadRoutes(routes, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiWorkloadRoute",
      resourceId: "matrix",
      newValues: { routes: routes.map((r) => r.workload) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: saved });
  } catch (err) {
    next(err);
  }
});

export default router;
