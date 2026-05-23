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
import { requireFeature } from "../services/features.service";
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
import {
  embedKnowledgeBaseEntry,
  embedStaleKnowledgeBaseEntries,
  enqueueKnowledgeBaseEmbedding,
  retrieveKnowledge,
} from "../services/knowledgeBaseEmbedding.service";

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("knowledgeBase"));
router.use(requirePermission(Permissions.KNOWLEDGE_BASE_MANAGE));

const categorySchema = z.enum([
  "FAQ",
  "SERVICE",
  "PRODUCT",
  "POLICY",
  "HOURS",
  "LOCATION",
  "OTHER",
]);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "ALL"]).optional(),
  category: categorySchema.optional(),
  search: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50_000),
  summary: z.string().trim().max(1000).optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string()).max(20).optional(),
  source: z.string().trim().max(40).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  publish: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ publish: true });

const embedStaleSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  async: z.boolean().optional(),
});

const retrieveSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(10).optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

function scheduleEmbedding(tenantId: string, entryId: string): void {
  void enqueueKnowledgeBaseEmbedding({ tenantId, entryId }).catch((err) => {
    console.error("[knowledge-base] failed to enqueue embedding job", err);
  });
}

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = listSchema.parse(req.query);
      const result = await listEntries(req.tenantId!, query);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const entry = await createEntry(req.tenantId!, body);
      if (entry.status === "PUBLISHED") scheduleEmbedding(req.tenantId!, entry.id);

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

router.post(
  "/embed-stale",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = embedStaleSchema.parse(req.body ?? {});
      if (body.async) {
        await enqueueKnowledgeBaseEmbedding({
          kind: "embed-stale",
          tenantId: req.tenantId!,
          limit: body.limit,
        });
        res.status(202).json({
          success: true,
          data: { queued: true, limit: body.limit },
        });
        return;
      }

      const result = await embedStaleKnowledgeBaseEntries(
        req.tenantId!,
        body.limit,
      );
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        newValues: {
          embeddingBatch: {
            embedded: result.embedded,
            failed: result.failed,
            checked: result.checked,
          },
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/retrieve",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = retrieveSchema.parse(req.body);
      const result = await retrieveKnowledge(req.tenantId!, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

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
      if (entry.status === "PUBLISHED" && entry.needsEmbedding) {
        scheduleEmbedding(req.tenantId!, entry.id);
      }

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

router.post(
  "/:id/embed",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const result = await embedKnowledgeBaseEntry(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "KnowledgeBaseEntry",
        resourceId: result.id,
        newValues: {
          embeddingModel: result.embeddingModel,
          embeddingVectorLength: result.embeddingVectorLength,
          stale: result.stale,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/publish",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const entry = await publishEntry(req.tenantId!, req.params.id);
      scheduleEmbedding(req.tenantId!, entry.id);
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
