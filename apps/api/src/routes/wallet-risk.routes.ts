import { Router, Response, NextFunction } from "express";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  assessTenantWalletRisk,
  getLatestAssessment,
} from "../services/walletRisk.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

router.get(
  "/",
  requirePermission(Permissions.WALLET_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const latest = await getLatestAssessment(req.tenantId!);
      res.json({ success: true, data: latest });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/refresh",
  requirePermission(Permissions.WALLET_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const assessment = await assessTenantWalletRisk(req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WalletRiskAssessment",
        resourceId: assessment?.id ?? req.tenantId!,
        newValues: {
          tier: assessment?.riskTier,
          action: assessment?.recommendedActionCode,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: assessment });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
