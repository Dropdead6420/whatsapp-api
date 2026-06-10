// ============================================================================
// CMS Manager (AdGrowly planning PDF §4 — landing/pricing pages, blogs, FAQs,
// testimonials, legal pages, SEO meta). SUPER_ADMIN only; the public surface
// (public-cms.routes) reads published rows. Every mutation is audited.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { CmsContentType, CmsContentStatus, Prisma } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  createContent,
  deleteContent,
  getContent,
  listContent,
  updateContent,
} from "../services/cms.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const listQuerySchema = z.object({
  type: z.nativeEnum(CmsContentType).optional(),
  status: z.nativeEnum(CmsContentStatus).optional(),
  locale: z.string().trim().max(10).optional(),
});

const jsonObject = z.record(z.unknown());

const createSchema = z.object({
  type: z.nativeEnum(CmsContentType),
  slug: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(10).optional(),
  title: z.string().trim().min(1).max(240),
  excerpt: z.string().trim().max(1000).optional(),
  body: z.string().max(100_000).optional(),
  data: jsonObject.optional(),
  metaTitle: z.string().trim().max(240).optional(),
  metaDescription: z.string().trim().max(400).optional(),
  status: z.nativeEnum(CmsContentStatus).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updateSchema = z
  .object({
    slug: z.string().trim().max(120).optional(),
    locale: z.string().trim().max(10).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    excerpt: z.string().trim().max(1000).nullable().optional(),
    body: z.string().max(100_000).nullable().optional(),
    data: jsonObject.nullable().optional(),
    metaTitle: z.string().trim().max(240).nullable().optional(),
    metaDescription: z.string().trim().max(400).nullable().optional(),
    status: z.nativeEnum(CmsContentStatus).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = listQuerySchema.parse(req.query);
    res.json({ success: true, data: await listContent(filter) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const content = await createContent({
      ...body,
      data: body.data as Prisma.InputJsonValue | undefined,
      updatedByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "CmsContent",
      resourceId: content.id,
      newValues: { type: content.type, slug: content.slug, status: content.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getContent(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const content = await updateContent(req.params.id, {
      ...body,
      data: body.data as Prisma.InputJsonValue | null | undefined,
      updatedByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CmsContent",
      resourceId: content.id,
      newValues: { fieldsUpdated: Object.keys(body), status: content.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteContent(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "CmsContent",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
