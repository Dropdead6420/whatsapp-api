import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { GmbPostStatus, GmbPostType, GmbLocationStatus, GmbReviewStatus } from "@nexaflow/db";
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
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  updateLocation,
} from "../services/gmbLocation.service";
import {
  deleteReview,
  generateReplyDraft,
  getReputationSummary,
  getReview,
  ingestReview,
  listReviews,
  replyToReview,
  updateReviewStatus,
} from "../services/gmbReview.service";
import {
  addKeyword,
  deleteKeyword,
  getKeywordWithTrend,
  listKeywords,
  listSnapshots,
  recordSnapshot,
  setKeywordActive,
} from "../services/gmbRanking.service";

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

// --- Business Profile / locations (AdGrowly GMB-first) ---------------------

const locationListSchema = z.object({ status: z.nativeEnum(GmbLocationStatus).optional() });

const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  storeCode: z.string().trim().max(60).optional(),
  placeId: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().url().max(300).optional(),
  primaryCategory: z.string().trim().max(120).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(60).optional(),
  secretId: z.string().cuid().nullable().optional(),
});

const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    storeCode: z.string().trim().max(60).nullable().optional(),
    placeId: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    website: z.string().url().max(300).nullable().optional(),
    primaryCategory: z.string().trim().max(120).nullable().optional(),
    addressLine: z.string().trim().max(240).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    region: z.string().trim().max(120).nullable().optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().max(60).nullable().optional(),
    secretId: z.string().cuid().nullable().optional(),
    status: z.nativeEnum(GmbLocationStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/locations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = locationListSchema.parse(req.query);
    res.json({ success: true, data: await listLocations(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/locations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createLocationSchema.parse(req.body);
    const location = await createLocation(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbLocation",
      resourceId: location.id,
      newValues: { name: location.name, status: location.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

router.get("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getLocation(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateLocationSchema.parse(req.body);
    const location = await updateLocation(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbLocation",
      resourceId: location.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

router.delete("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteLocation(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbLocation",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Reputation / reviews (AdGrowly GMB-first) -----------------------------

const reviewListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbReviewStatus).optional(),
});

const summarySchema = z.object({ locationId: z.string().cuid().optional() });

const ingestReviewSchema = z.object({
  locationId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  authorName: z.string().trim().max(160).optional(),
  comment: z.string().trim().max(4000).optional(),
  reviewedAt: z.string().datetime().optional(),
  externalReviewId: z.string().trim().max(200).optional(),
});

const draftReplySchema = z.object({
  tone: z.enum(["warm", "professional"]).optional(),
});

const replySchema = z.object({ text: z.string().trim().min(1).max(1500) });

const reviewStatusSchema = z.object({ status: z.nativeEnum(GmbReviewStatus) });

router.get("/reviews", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = reviewListSchema.parse(req.query);
    res.json({ success: true, data: await listReviews(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/reviews/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = summarySchema.parse(req.query);
    res.json({ success: true, data: await getReputationSummary(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.post("/reviews", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = ingestReviewSchema.parse(req.body);
    const review = await ingestReview(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbReview",
      resourceId: review.id,
      newValues: { locationId: review.locationId, rating: review.rating },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

// Build an AI-assisted reply draft (not saved/published).
router.post("/reviews/:id/draft-reply", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { tone } = draftReplySchema.parse(req.body ?? {});
    res.json({ success: true, data: await generateReplyDraft(req.tenantId!, req.params.id, tone) });
  } catch (err) {
    next(err);
  }
});

// Approve + record a reply (operator-reviewed; publish to Google is a later slice).
router.post("/reviews/:id/reply", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { text } = replySchema.parse(req.body);
    const review = await replyToReview(req.tenantId!, req.params.id, text);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "REPLY",
      resource: "GmbReview",
      resourceId: review.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

router.get("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getReview(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = reviewStatusSchema.parse(req.body);
    const review = await updateReviewStatus(req.tenantId!, req.params.id, status);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbReview",
      resourceId: review.id,
      newValues: { status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

router.delete("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteReview(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbReview",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Local ranking tracker (AdGrowly GMB-first) ----------------------------

const keywordListSchema = z.object({
  locationId: z.string().cuid().optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const addKeywordSchema = z.object({
  locationId: z.string().cuid(),
  keyword: z.string().trim().min(1).max(160),
});

const keywordActiveSchema = z.object({ isActive: z.boolean() });

const snapshotSchema = z.object({
  rank: z.number().int().min(1).max(1000).nullable().optional(),
  source: z.string().trim().max(80).optional(),
  checkedAt: z.string().datetime().optional(),
});

const snapshotListSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

router.get("/keywords", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = keywordListSchema.parse(req.query);
    res.json({ success: true, data: await listKeywords(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.post("/keywords", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = addKeywordSchema.parse(req.body);
    const keyword = await addKeyword(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbTrackedKeyword",
      resourceId: keyword.id,
      newValues: { locationId: keyword.locationId, keyword: keyword.keyword },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: keyword });
  } catch (err) {
    next(err);
  }
});

router.get("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getKeywordWithTrend(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { isActive } = keywordActiveSchema.parse(req.body);
    const keyword = await setKeywordActive(req.tenantId!, req.params.id, isActive);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbTrackedKeyword",
      resourceId: keyword.id,
      newValues: { isActive },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: keyword });
  } catch (err) {
    next(err);
  }
});

router.delete("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteKeyword(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbTrackedKeyword",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

router.get("/keywords/:id/snapshots", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { limit } = snapshotListSchema.parse(req.query);
    res.json({ success: true, data: await listSnapshots(req.tenantId!, req.params.id, limit) });
  } catch (err) {
    next(err);
  }
});

// Record a rank check (rank null = not found in window). Live grid/SERP
// capture posts here in a later slice.
router.post("/keywords/:id/snapshots", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = snapshotSchema.parse(req.body);
    const snapshot = await recordSnapshot(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbRankSnapshot",
      resourceId: snapshot.id,
      newValues: { keywordId: snapshot.keywordId, rank: snapshot.rank },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: snapshot });
  } catch (err) {
    next(err);
  }
});

export default router;
