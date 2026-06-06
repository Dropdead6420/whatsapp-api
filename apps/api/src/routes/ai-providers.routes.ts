import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AiProviderKey, AiProviderKind, AiProviderStatus } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  createProvider,
  deleteProvider,
  deriveProviderContext,
  getProvider,
  listProviders,
  resolveProviderChain,
  setDefaultProvider,
  updateProvider,
} from "../services/aiProviderHub.service";
import { getAiUsageSummary, recordAiUsage } from "../services/aiCostManager.service";
import { chatViaHub, testProviderConnection } from "../services/aiGateway.service";

// AI Provider Hub routes (Complete Planning PDF §2.10 / Phase 4). Scope +
// owning tenant are derived from the caller (SuperAdmin→PLATFORM,
// partner→PARTNER, customer→CUSTOMER), so provider configs stay isolated.
// Mutations are audited. Secrets are never returned — only a `hasKey` flag
// and the vault pointer id.

const router = Router();
router.use(requireAuth, requirePermission(Permissions.AI_PROVIDER_MANAGE));

function contextFor(req: RequestWithAuth) {
  return deriveProviderContext(req.userRole, req.tenantId ?? null);
}

const listSchema = z.object({
  kind: z.nativeEnum(AiProviderKind).optional(),
  includeDisabled: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  provider: z.nativeEnum(AiProviderKey),
  kind: z.nativeEnum(AiProviderKind).optional(),
  label: z.string().trim().min(1).max(120),
  secretId: z.string().cuid().nullable().optional(),
  defaultModel: z.string().trim().max(120).nullable().optional(),
  models: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  baseUrl: z.string().url().max(300).nullable().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    secretId: z.string().cuid().nullable().optional(),
    defaultModel: z.string().trim().max(120).nullable().optional(),
    models: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    baseUrl: z.string().url().max(300).nullable().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    status: z.nativeEnum(AiProviderStatus).optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "PATCH body must include at least one field.",
  });

const resolveSchema = z.object({
  kind: z.nativeEnum(AiProviderKind).optional(),
});

const usageSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

const chatSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  system: z.string().trim().max(4000).optional(),
  kind: z.nativeEnum(AiProviderKind).optional(),
});

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const query = listSchema.parse(req.query);
    const data = await listProviders(contextFor(req), query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = createSchema.parse(req.body);
    const config = await createProvider(ctx, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "AiProviderConfig",
      resourceId: config.id,
      newValues: { provider: config.provider, kind: config.kind, label: config.label },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

// Debug/preview: ordered fallback chain for a kind (no secrets returned).
router.get("/resolve", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { kind } = resolveSchema.parse(req.query);
    const data = await resolveProviderChain(contextFor(req), kind);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Live chat completion through the caller's provider fallback chain. Uses
// the linked vault keys; records token usage to the cost ledger.
router.post("/chat", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = chatSchema.parse(req.body);
    const result = await chatViaHub(ctx, body);
    await recordAiUsage(req.tenantId!, {
      model: result.model,
      feature: "hub_chat",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    res.json({
      success: true,
      data: {
        provider: result.provider,
        model: result.model,
        text: result.text,
      },
    });
  } catch (err) {
    next(err);
  }
});

// AI cost manager: spend summary over a window, scoped to the caller
// (PLATFORM sees all tenants; PARTNER / CUSTOMER see their own).
router.get("/usage", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { days } = usageSchema.parse(req.query);
    const data = await getAiUsageSummary(contextFor(req), days ?? 30);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const data = await getProvider(contextFor(req), req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = updateSchema.parse(req.body);
    const config = await updateProvider(ctx, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiProviderConfig",
      resourceId: config.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/set-default", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const config = await setDefaultProvider(ctx, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "AiProviderConfig",
      resourceId: config.id,
      newValues: { setDefault: true, kind: config.kind },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

// Live connectivity test: pings the provider with a tiny prompt using the
// linked vault key. Returns a result object (never throws on provider error).
router.post("/:id/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const result = await testProviderConnection(contextFor(req), req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    await deleteProvider(ctx, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "AiProviderConfig",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
