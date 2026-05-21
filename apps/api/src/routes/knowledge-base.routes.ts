import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  archiveEntry,
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  publishEntry,
  restoreEntryToDraft,
  updateEntry,
} from "../services/knowledgeBase.service";

// T-051 slice 1: CRUD + lifecycle endpoints for the Knowledge Base.
// Slice 2 will add an embeddings-rebuild endpoint; slice 3 hooks
// retrieval into the AI nodes.

const router = Router();
router.use(requireAuth, requireTenantScope);
router.use(requirePermission(Permissions.KNOWLEDGE_BASE_MANAGE));

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z
    .enum(["DRAFT", "PUBLISHED", "ARCHIVED", "ALL"])
    .optional(),
  category: z
    .enum(["FAQ", "SERVICE", "PRODUCT", "POLICY", "HOURS", "LOCATION", "OTHER"])
    .optional(),
  search: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50_000),
  summary: z.string().trim().max(1_000).optional(),
  category: z
    .enum(["FAQ", "SERVICE", "PRODUCT", "POLICY", "HOURS", "LOCATION", "OTHER"])
    .optional(),
  tags: z.array(z.string()).max(20).optional(),
  source: z.string().trim().max(40).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  publish: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ publish: true });

// GET /api/v1/knowledge-base
router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const result = await listEntries(req.tenantId!, q);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/knowledge-base
router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const entry = await createEntry(req.tenantId!, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "KnowledgeBaseEntry",
        resourceId: entry.id,
        newValues: {
          title: entry.title,
          category: entry.category,
          status: entry.status,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/knowledge-base/:id
router.get(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const entry = await getEntry(req.tenantId!, req.params.id);
      res.json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/knowledge-base/:id
router.patch(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      if (Object.keys(body).length === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "PATCH body must include at least one field.",
        );
      }
      const entry = await updateEntry(req.tenantId!, req.params.id, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        resourceId: entry.id,
        newValues: { fieldsUpdated: Object.keys(body) },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/knowledge-base/:id/publish
router.post(
  "/:id/publish",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const entry = await publishEntry(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        resourceId: entry.id,
        newValues: { lifecycle: "PUBLISHED" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/knowledge-base/:id/archive
router.post(
  "/:id/archive",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const entry = await archiveEntry(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        resourceId: entry.id,
        newValues: { lifecycle: "ARCHIVED" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/knowledge-base/:id/restore — ARCHIVED → DRAFT
router.post(
  "/:id/restore",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const entry = await restoreEntryToDraft(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        resourceId: entry.id,
        newValues: { lifecycle: "DRAFT (restored)" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/knowledge-base/:id
router.delete(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await deleteEntry(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "KnowledgeBaseEntry",
        resourceId: req.params.id,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
