import { Router, Response, NextFunction } from "express";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { getOnboardingStatus } from "../services/onboarding.service";

// GET-only — onboarding status is computed from existing tables, so
// the only operation is reading it. The dashboard polls this to show
// the "Get started" card; the standalone /onboarding page calls it on
// load.
//
// Available to ALL roles within a tenant: agents see the same checklist
// as business admins, just clicks that lead to pages they may not be
// able to act on (RBAC handles that downstream). The point is awareness,
// not enforcement.

const router = Router();
router.use(requireAuth, requireTenantScope);

router.get(
  "/status",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const status = await getOnboardingStatus(req.tenantId!);
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
