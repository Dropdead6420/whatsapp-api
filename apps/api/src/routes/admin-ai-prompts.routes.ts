// ============================================================================
// AI prompt template management (AdGrowly planning PDF — AI prompt management)
//
// Global, SUPER_ADMIN-curated prompt templates used across AI features. Only
// Super Admin can edit; partners/customers consume the active template. Every
// mutation is audited. Pure template engine lives in the service.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  previewTemplate,
  updateTemplate,
} from "../services/aiPromptTemplate.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const listQuerySchema = z.object({
  category: z.string().trim().max(80).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/i, "Key may contain letters, numbers, dot, dash and underscore.");

const createSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(80).optional(),
  template: z.string().trim().min(1).max(8000),
  variables: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  model: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().max(80).nullable().optional(),
    template: z.string().trim().min(1).max(8000).optional(),
    variables: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    model: z.string().trim().max(80).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

const previewSchema = z.object({
  variables: z.record(z.union([z.string(), z.number()])).default({}),
});

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = listQuerySchema.parse(req.query);
    res.json({ success: true, data: await listTemplates(filter) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const template = await createTemplate({ ...body, updatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "AiPromptTemplate",
      resourceId: template.id,
      newValues: { key: template.key, category: template.category },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getTemplate(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const template = await updateTemplate(req.params.id, { ...body, updatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiPromptTemplate",
      resourceId: template.id,
      newValues: { fieldsUpdated: Object.keys(body), version: template.version },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

// Render a stored template with sample variables (no mutation).
router.post("/:id/preview", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { variables } = previewSchema.parse(req.body ?? {});
    res.json({ success: true, data: await previewTemplate(req.params.id, variables) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteTemplate(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "AiPromptTemplate",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
