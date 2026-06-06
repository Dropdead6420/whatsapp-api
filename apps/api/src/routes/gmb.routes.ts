import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { GmbPostStatus, GmbPostType } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  buildGmbCaption,
  createPost,
  deletePost,
  getPost,
  listPosts,
  schedulePost,
  updatePost,
} from "../services/gmb.service";

// GMB AI Manager routes (Complete Planning PDF §2.19). Tenant-scoped post
// drafting + scheduling, gated by GMB_MANAGE. Mutations audited.

const router = Router();
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.GMB_MANAGE));

const ctaEnum = z.enum(["LEARN_MORE", "CALL", "ORDER", "BOOK", "SIGN_UP", "SHOP"]);

const listSchema = z.object({ status: z.nativeEnum(GmbPostStatus).optional() });

const createSchema = z.object({
  type: z.nativeEnum(GmbPostType).optional(),
  summary: z.string().trim().min(1).max(1500),
  mediaUrl: z.string().url().max(500).optional(),
  callToActionType: ctaEnum.optional(),
  callToActionUrl: z.string().url().max(500).optional(),
  locationLabel: z.string().trim().max(160).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const generateSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  type: z.nativeEnum(GmbPostType).optional(),
  topic: z.string().trim().max(300).optional(),
  tone: z.enum(["friendly", "professional", "playful"]).optional(),
  locationLabel: z.string().trim().max(160).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const updateSchema = z
  .object({
    type: z.nativeEnum(GmbPostType).optional(),
    summary: z.string().trim().min(1).max(1500).optional(),
    mediaUrl: z.string().url().max(500).nullable().optional(),
    callToActionType: ctaEnum.nullable().optional(),
    callToActionUrl: z.string().url().max(500).nullable().optional(),
    locationLabel: z.string().trim().max(160).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

const scheduleSchema = z.object({ scheduledAt: z.string().datetime() });

router.get("/posts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = listSchema.parse(req.query);
    res.json({ success: true, data: await listPosts(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/posts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const post = await createPost(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { type: post.type, status: post.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// AI caption generator → creates a draft (or scheduled) post.
router.post("/posts/generate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = generateSchema.parse(req.body);
    const caption = buildGmbCaption(body);
    const post = await createPost(req.tenantId!, {
      type: caption.type,
      summary: caption.summary,
      callToActionType: caption.callToActionType,
      locationLabel: body.locationLabel,
      scheduledAt: body.scheduledAt,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { generated: true, type: post.type },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.get("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPost(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const post = await updatePost(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.post("/posts/:id/schedule", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { scheduledAt } = scheduleSchema.parse(req.body);
    const post = await schedulePost(req.tenantId!, req.params.id, scheduledAt);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { scheduled: true },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.delete("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePost(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbPost",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
