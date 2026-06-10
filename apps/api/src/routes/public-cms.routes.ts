import { Router, Response, NextFunction, Request } from "express";
import { z } from "zod";
import { CmsContentType } from "@nexaflow/db";
import { getPublishedBySlug, listPublished } from "../services/cms.service";

// Public CMS reader (AdGrowly planning PDF §4). Unauthenticated — returns ONLY
// published content, projected to a public view (no status / sortOrder /
// editor fields). Mounted ahead of the auth-required routers.

const router = Router();

// Accept content type case-insensitively in the URL (e.g. /faq or /FAQ).
const typeParam = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.nativeEnum(CmsContentType));

const listQuerySchema = z.object({
  type: typeParam.optional(),
  locale: z.string().trim().max(10).optional(),
});

const slugParamsSchema = z.object({
  type: typeParam,
  slug: z.string().trim().min(1).max(120),
});

const localeQuerySchema = z.object({ locale: z.string().trim().max(10).optional() });

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter = listQuerySchema.parse(req.query);
    res.json({ success: true, data: await listPublished(filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/:type/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, slug } = slugParamsSchema.parse(req.params);
    const { locale } = localeQuerySchema.parse(req.query);
    res.json({ success: true, data: await getPublishedBySlug(type, slug, locale) });
  } catch (err) {
    next(err);
  }
});

export default router;
