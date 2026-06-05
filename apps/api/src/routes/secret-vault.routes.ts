import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { SecretProvider, SecretStatus } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  createSecret,
  deleteSecret,
  deriveSecretContext,
  getSecret,
  listSecrets,
  revealSecret,
  rotateSecret,
  testSecret,
  updateSecret,
} from "../services/secretVault.service";

// API Secret Vault routes (Complete Planning PDF §2.9 / §5). The owning
// scope + tenant are derived from the authenticated caller, so SuperAdmin
// only ever touches PLATFORM secrets, a partner its PARTNER secrets, and a
// customer its CUSTOMER secrets. Ciphertext is never returned by list/get;
// reveal/rotate/test/delete write audit logs.

const router = Router();
router.use(requireAuth, requirePermission(Permissions.SECRET_VAULT_MANAGE));

function contextFor(req: RequestWithAuth) {
  return deriveSecretContext(req.userRole, req.tenantId ?? null);
}

const listSchema = z.object({
  provider: z.nativeEnum(SecretProvider).optional(),
  includeDisabled: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  provider: z.nativeEnum(SecretProvider),
  label: z.string().trim().min(1).max(120),
  value: z.string().min(1).max(20_000),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    status: z.nativeEnum(SecretStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "PATCH body must include at least one field.",
  });

const rotateSchema = z.object({
  value: z.string().min(1).max(20_000),
});

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const query = listSchema.parse(req.query);
    const data = await listSecrets(ctx, query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = createSchema.parse(req.body);
    const secret = await createSecret(ctx, {
      ...body,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "SecretVaultEntry",
      resourceId: secret.id,
      newValues: { scope: secret.scope, provider: secret.provider, label: secret.label },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: secret });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const data = await getSecret(contextFor(req), req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = updateSchema.parse(req.body);
    const secret = await updateSecret(ctx, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "SecretVaultEntry",
      resourceId: secret.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: secret });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/rotate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const body = rotateSchema.parse(req.body);
    const secret = await rotateSecret(ctx, req.params.id, body.value);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "SecretVaultEntry",
      resourceId: secret.id,
      newValues: { rotated: true },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: secret });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/test", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const result = await testSecret(ctx, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "SecretVaultEntry",
      resourceId: req.params.id,
      newValues: { tested: true, ok: result.ok },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Reveal the plaintext once. Heavily audited; ciphertext otherwise never
// leaves the server.
router.post("/:id/reveal", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    const data = await revealSecret(ctx, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "SECRET_REVEAL",
      resource: "SecretVaultEntry",
      resourceId: data.id,
      newValues: { revealed: true, provider: data.provider },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const ctx = contextFor(req);
    await deleteSecret(ctx, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "SecretVaultEntry",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
