// Manager / Team-Lead dashboard for per-agent performance (PRD §7).
//
// Gate: BUSINESS_ADMIN or TEAM_LEAD only. AGENT role explicitly blocked
// — agents shouldn't see how they stack up against peers without their
// manager surfacing the report.

import { Router, Response, NextFunction } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { getAgentPerformance } from "../services/agentPerformance.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      if (req.userRole !== "BUSINESS_ADMIN" && req.userRole !== "TEAM_LEAD") {
        throw new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          "Only BUSINESS_ADMIN or TEAM_LEAD can view agent performance.",
        );
      }

      // ?sinceDays= is optional; the service clamps + defaults.
      const summary = await getAgentPerformance({
        tenantId: req.tenantId!,
        sinceDays:
          typeof req.query.sinceDays === "string"
            ? Number.parseInt(req.query.sinceDays, 10)
            : undefined,
      });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
