import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions, UserRole } from "@nexaflow/shared";
import { WhatsAppProviderKey } from "@nexaflow/db";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission, requireRole } from "../middleware/rbac";
import {
  createProviderRoute,
  deleteProviderRoute,
  listProviderRoutes,
  updateProviderRoute,
} from "../services/providerRoute.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

// SuperAdmin-only CRUD for ProviderRoute (T-005e). The route mounts
// after the global auth middleware; SUPER_ADMIN is the only role that
// holds PROVIDER_ROUTE_MANAGE. Every mutation writes an AuditLog row.

const router = Router();
router.use(
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  requirePermission(Permissions.PROVIDER_ROUTE_MANAGE),
);

const createSchema = z.object({
  tenantId: z.string().cuid(),
  providerKey: z.nativeEnum(WhatsAppProviderKey),
  phoneNumberId: z.string().trim().min(1).max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateSchema = z.object({
  providerKey: z.nativeEnum(WhatsAppProviderKey).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const listQuerySchema = z.object({
  tenantId: z.string().cuid().optional(),
});

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const routes = await listProviderRoutes({ tenantId: q.tenantId });
      res.json({ success: true, data: routes });
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
      const created = await createProviderRoute({
        tenantId: body.tenantId,
        providerKey: body.providerKey,
        phoneNumberId: body.phoneNumberId,
        isActive: body.isActive,
        config: body.config ?? null,
      });
      await logAudit({
        tenantId: created.tenantId,
        userId: req.userId!,
        action: "CREATE",
        resource: "ProviderRoute",
        resourceId: created.id,
        // Never log the raw config — only its redacted preview.
        newValues: {
          providerKey: created.providerKey,
          phoneNumberId: created.phoneNumberId,
          isActive: created.isActive,
          configKeys: created.configPreview
            ? Object.keys(created.configPreview)
            : [],
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: created });
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
      const updated = await updateProviderRoute({
        id: req.params.id,
        providerKey: body.providerKey,
        isActive: body.isActive,
        config: body.config,
      });
      await logAudit({
        tenantId: updated.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "ProviderRoute",
        resourceId: updated.id,
        newValues: {
          providerKey: updated.providerKey,
          phoneNumberId: updated.phoneNumberId,
          isActive: updated.isActive,
          configKeys: updated.configPreview
            ? Object.keys(updated.configPreview)
            : [],
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
      const deleted = await deleteProviderRoute(req.params.id);
      await logAudit({
        tenantId: deleted.tenantId,
        userId: req.userId!,
        action: "DELETE",
        resource: "ProviderRoute",
        resourceId: deleted.id,
        oldValues: {
          providerKey: deleted.providerKey,
          phoneNumberId: deleted.phoneNumberId,
          isActive: deleted.isActive,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
