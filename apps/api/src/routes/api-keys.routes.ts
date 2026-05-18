import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireFeature } from "../services/features.service";
import {
  createApiKey,
  listApiRequestLogs,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} from "../services/apiKey.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireFeature("developerPortal"),
  requirePermission(Permissions.API_KEYS_MANAGE),
);

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  rateLimit: z.number().int().min(60).max(10_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  rateLimit: z.number().int().min(60).max(10_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const keys = await listApiKeys(req.tenantId!);
      res.json({ success: true, data: keys });
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
      const created = await createApiKey({
        tenantId: req.tenantId!,
        userId: req.userId!,
        name: body.name,
        rateLimit: body.rateLimit,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "ApiKey",
        resourceId: created.apiKey.id,
        newValues: {
          name: created.apiKey.name,
          rateLimit: created.apiKey.rateLimit,
          expiresAt: created.apiKey.expiresAt,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({
        success: true,
        data: {
          ...created.apiKey,
          secret: created.secret,
        },
      });
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
      const updated = await updateApiKey({
        tenantId: req.tenantId!,
        id: req.params.id,
        name: body.name,
        rateLimit: body.rateLimit,
        expiresAt:
          body.expiresAt === undefined
            ? undefined
            : body.expiresAt
              ? new Date(body.expiresAt)
              : null,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "ApiKey",
        resourceId: updated.id,
        newValues: {
          name: updated.name,
          rateLimit: updated.rateLimit,
          expiresAt: updated.expiresAt,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const revoked = await revokeApiKey({
        tenantId: req.tenantId!,
        id: req.params.id,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "ApiKey",
        resourceId: revoked.id,
        oldValues: {
          name: revoked.name,
          rateLimit: revoked.rateLimit,
          expiresAt: revoked.expiresAt,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id/logs",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const logs = await listApiRequestLogs({
        tenantId: req.tenantId!,
        apiKeyId: req.params.id,
      });
      res.json({ success: true, data: logs });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
