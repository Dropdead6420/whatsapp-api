import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  beginEnrollment,
  confirmEnrollment,
  disable,
  getStatus,
} from "../services/twoFactor.service";

// Two-Factor Authentication routes (Complete Planning PDF §28 "2FA").
// Self-service: every authenticated user manages their own TOTP. The
// secret is stored encrypted; enabling/disabling is audited.

const router = Router();
router.use(requireAuth);

const tokenSchema = z.object({
  token: z.string().trim().regex(/^\d{6}$/, "A 6-digit code is required."),
});

router.get("/status", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const data = await getStatus(req.userId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/enroll", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const data = await beginEnrollment(req.userId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/enroll/confirm", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { token } = tokenSchema.parse(req.body);
    const data = await confirmEnrollment(req.userId!, token);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "TWO_FACTOR_ENABLED",
      resource: "User",
      resourceId: req.userId!,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/disable", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { token } = tokenSchema.parse(req.body);
    const data = await disable(req.userId!, token);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "TWO_FACTOR_DISABLED",
      resource: "User",
      resourceId: req.userId!,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
