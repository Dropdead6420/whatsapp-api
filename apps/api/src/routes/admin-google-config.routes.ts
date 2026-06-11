// ============================================================================
// SuperAdmin "Google Business Profile — API Configuration". GET returns the
// safe config (no raw secret); PUT upserts it. The client secret is encrypted
// by the service; only enable/hasSecret flags are audited. SUPER_ADMIN only.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { getSafeGoogleOAuthConfig, saveGoogleOAuthConfig } from "../services/googleOAuthConfig.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const saveSchema = z.object({
  clientId: z.string().trim().max(300).optional(),
  clientSecret: z.string().trim().max(500).optional(),
  redirectUri: z.string().trim().max(500).optional(),
  scope: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getSafeGoogleOAuthConfig() });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = saveSchema.parse(req.body ?? {});
    const config = await saveGoogleOAuthConfig(body, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GoogleOAuthConfig",
      resourceId: "default",
      // Never log the secret — only whether one is set + the toggle/clientId state.
      newValues: { enabled: config.enabled, hasSecret: config.hasSecret, clientIdSet: Boolean(config.clientId) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

export default router;
