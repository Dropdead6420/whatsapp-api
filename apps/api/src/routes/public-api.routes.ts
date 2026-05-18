import { Router, Response, NextFunction } from "express";
import {
  requireApiKey,
  RequestWithApiKey,
} from "../middleware/apiKeyAuth";

const router = Router();

router.use(requireApiKey);

router.get(
  "/status",
  (req: RequestWithApiKey, res: Response, _next: NextFunction) => {
    res.json({
      success: true,
      data: {
        ok: true,
        tenantId: req.tenantId,
        apiKeyId: req.apiKeyId,
        apiKeyName: req.apiKeyName,
        timestamp: new Date().toISOString(),
      },
    });
  },
);

export default router;
