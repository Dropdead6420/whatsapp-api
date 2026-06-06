import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { IntegrationProvider, IntegrationStatus } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  connectIntegration,
  disconnectIntegration,
  getConnectorCatalog,
  getIntegration,
  listIntegrations,
  updateIntegration,
} from "../services/integrations.service";

// Integrations Hub routes (Complete Planning PDF §2.22). Tenant-scoped
// connector catalog + connection management, gated by INTEGRATION_MANAGE.
// Credentials are referenced by secretId in the Secret Vault; this layer
// never stores or returns raw secrets.

const router = Router();
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.INTEGRATION_MANAGE));

const listSchema = z.object({ status: z.nativeEnum(IntegrationStatus).optional() });

const connectSchema = z.object({
  provider: z.nativeEnum(IntegrationProvider),
  label: z.string().trim().max(120).optional(),
  config: z.record(z.unknown()).optional(),
  secretId: z.string().cuid().nullable().optional(),
  externalAccountLabel: z.string().trim().max(160).optional(),
});

const updateSchema = z
  .object({
    label: z.string().trim().max(120).optional(),
    config: z.record(z.unknown()).nullable().optional(),
    secretId: z.string().cuid().nullable().optional(),
    externalAccountLabel: z.string().trim().max(160).nullable().optional(),
    status: z.nativeEnum(IntegrationStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

// Static catalog of available connectors.
router.get("/catalog", (_req: RequestWithAuth, res: Response) => {
  res.json({ success: true, data: getConnectorCatalog() });
});

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = listSchema.parse(req.query);
    res.json({ success: true, data: await listIntegrations(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = connectSchema.parse(req.body);
    const integration = await connectIntegration(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "Integration",
      resourceId: integration.id,
      newValues: { provider: integration.provider, label: integration.label },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: integration });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getIntegration(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const integration = await updateIntegration(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Integration",
      resourceId: integration.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: integration });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await disconnectIntegration(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "Integration",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { disconnected: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
