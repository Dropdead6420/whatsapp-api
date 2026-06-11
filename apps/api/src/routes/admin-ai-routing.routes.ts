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
import { listWorkloadRoutes, upsertWorkloadRoutes } from "../services/aiWorkloadRouting.service";
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

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listWorkloadRoutes() });
  } catch (err) {
    next(err);
  }
});

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
