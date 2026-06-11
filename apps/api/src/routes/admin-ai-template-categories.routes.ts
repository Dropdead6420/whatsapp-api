// ============================================================================
// SuperAdmin "AI Template Categories" (AI Center) — managed category groups for
// reusable AI prompt templates. CRUD, audited, SUPER_ADMIN only.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../services/aiTemplateCategory.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: z.string().trim().max(120).optional(),
  icon: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().trim().max(120).optional(),
    description: z.string().trim().max(500).optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listCategories() });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const category = await createCategory(body, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "AiTemplateCategory",
      resourceId: category.id,
      newValues: { key: category.key, name: category.name },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const category = await updateCategory(req.params.id, body, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiTemplateCategory",
      resourceId: category.id,
      newValues: { fields: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteCategory(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "AiTemplateCategory",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
