import { Router, Response, NextFunction, Request } from "express";
import { z } from "zod";
import { getPublishedPage, toPublicView } from "../services/landingPage.service";

// Public landing-page renderer (Complete Planning PDF §2.16). Unauthenticated
// — returns ONLY published pages, projected to a public view (no owner /
// status / timestamp fields). Mounted ahead of the auth-required routers.

const router = Router();

const paramsSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  slug: z.string().trim().min(1).max(120),
});

router.get(
  "/:tenantId/:slug",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, slug } = paramsSchema.parse(req.params);
      const page = await getPublishedPage(tenantId, slug);
      res.json({ success: true, data: toPublicView(page) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
