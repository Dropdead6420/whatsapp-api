import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { LandingPageStatus } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  archivePage,
  createPage,
  deletePage,
  getPage,
  listPages,
  publishPage,
  updatePage,
} from "../services/landingPage.service";

// Landing Page / AI Website Builder routes (Complete Planning PDF §2.16).
// Tenant-scoped CRUD + draft→published lifecycle, gated by
// LANDING_PAGE_MANAGE. Mutations are audited.

const router = Router();
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.LANDING_PAGE_MANAGE));

const listSchema = z.object({
  status: z.nativeEnum(LandingPageStatus).optional(),
  search: z.string().trim().max(200).optional(),
});

const blockSchema = z.object({ type: z.string(), props: z.record(z.unknown()).optional() });

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(120).optional(),
  blocks: z.array(blockSchema).max(100).optional(),
  theme: z.record(z.unknown()).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(400).optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: z.string().trim().max(120).optional(),
    blocks: z.array(blockSchema).max(100).optional(),
    theme: z.record(z.unknown()).nullable().optional(),
    seoTitle: z.string().trim().max(200).nullable().optional(),
    seoDescription: z.string().trim().max(400).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "PATCH body must include at least one field.",
  });

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const query = listSchema.parse(req.query);
    const data = await listPages(req.tenantId!, query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const page = await createPage(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "LandingPage",
      resourceId: page.id,
      newValues: { slug: page.slug, title: page.title },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const data = await getPage(req.tenantId!, req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const page = await updatePage(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "LandingPage",
      resourceId: page.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/publish", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const page = await publishPage(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "LandingPage",
      resourceId: page.id,
      newValues: { lifecycle: "PUBLISHED" },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/archive", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const page = await archivePage(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "LandingPage",
      resourceId: page.id,
      newValues: { lifecycle: "ARCHIVED" },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePage(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "LandingPage",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
