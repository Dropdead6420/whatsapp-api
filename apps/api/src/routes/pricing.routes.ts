import { Router, Response, NextFunction } from "express";
import { prismaRead } from "@nexaflow/db";
import { RequestWithAuth } from "../middleware/auth";
import { publicPlan } from "../services/planCatalog.service";

const router = Router();

// GET /api/v1/pricing/plans
// Public plan catalog for the marketing site. SuperAdmin edits the same Plan
// rows from /billing, so changes reflect on the homepage/pricing pages.
router.get(
  "/plans",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const plans = await prismaRead.plan.findMany({
        orderBy: [{ priceInPaisa: "asc" }, { name: "asc" }],
      });

      res.json({ success: true, data: plans.map(publicPlan).filter(Boolean) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
