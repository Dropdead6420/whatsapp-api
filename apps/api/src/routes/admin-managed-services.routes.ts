// ============================================================================
// Managed Services (AdGrowly — agency service packages). SUPER_ADMIN curates
// the package catalog and runs customer engagements through their lifecycle.
// Every mutation is audited. Lifecycle/validation lives in the service.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ManagedServiceInterval, ManagedServiceStatus } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  createEngagement,
  createPackage,
  deleteEngagement,
  deletePackage,
  getEngagement,
  getEngagementSummary,
  getPackage,
  listEngagements,
  listPackages,
  updateEngagement,
  updatePackage,
} from "../services/managedService.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

// ---- Package catalog -------------------------------------------------------

const packageListSchema = z.object({
  category: z.string().trim().max(80).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const createPackageSchema = z.object({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_.-]*$/i),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(80).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  interval: z.nativeEnum(ManagedServiceInterval).optional(),
  deliverables: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const updatePackageSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    category: z.string().trim().max(80).nullable().optional(),
    priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    currency: z.string().trim().min(1).max(8).optional(),
    interval: z.nativeEnum(ManagedServiceInterval).optional(),
    deliverables: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/packages", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPackages(packageListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.post("/packages", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const pkg = await createPackage(createPackageSchema.parse(req.body));
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "ManagedServicePackage",
      resourceId: pkg.id,
      newValues: { key: pkg.key, interval: pkg.interval },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: pkg });
  } catch (err) {
    next(err);
  }
});

router.get("/packages/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPackage(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/packages/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updatePackageSchema.parse(req.body);
    const pkg = await updatePackage(req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "ManagedServicePackage",
      resourceId: pkg.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: pkg });
  } catch (err) {
    next(err);
  }
});

router.delete("/packages/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePackage(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "ManagedServicePackage",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// ---- Engagements -----------------------------------------------------------

const engagementListSchema = z.object({
  tenantId: z.string().trim().max(64).optional(),
  packageId: z.string().cuid().optional(),
  status: z.nativeEnum(ManagedServiceStatus).optional(),
});

const engagementSummarySchema = z.object({
  tenantId: z.string().trim().max(64).optional(),
  packageId: z.string().cuid().optional(),
});

const createEngagementSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  packageId: z.string().cuid(),
  locationId: z.string().cuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  assignedToUserId: z.string().trim().max(64).optional(),
});

const updateEngagementSchema = z
  .object({
    status: z.nativeEnum(ManagedServiceStatus).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    assignedToUserId: z.string().trim().max(64).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/engagements", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listEngagements(engagementListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getEngagementSummary(engagementSummarySchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.post("/engagements", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createEngagementSchema.parse(req.body);
    const engagement = await createEngagement({ ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "ManagedServiceEngagement",
      resourceId: engagement.id,
      newValues: { tenantId: engagement.tenantId, packageId: engagement.packageId },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: engagement });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getEngagement(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/engagements/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateEngagementSchema.parse(req.body);
    const engagement = await updateEngagement(req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "ManagedServiceEngagement",
      resourceId: engagement.id,
      newValues: { fieldsUpdated: Object.keys(body), status: engagement.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: engagement });
  } catch (err) {
    next(err);
  }
});

router.delete("/engagements/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteEngagement(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "ManagedServiceEngagement",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
