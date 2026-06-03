// ============================================================================
// SuperAdmin WhatsApp rate-table control (Claude Corrected Billing §3)
//
// CRUD over WhatsAppRateTable — the source the rate engine reads to price
// every chargeable send. SUPER_ADMIN only. Costs are stored in micros
// (BigInt), so responses serialize them to strings. Every mutation is
// audited.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  WhatsAppProviderKey,
  WhatsAppUsageCategory,
} from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  createRate,
  deactivateRate,
  getRate,
  listRates,
  serializeRate,
  updateRate,
} from "../services/rateAdmin.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

// Micros come over the wire as an integer or a numeric string (BigInt is
// not JSON-native). The service's toMicros() validates either form.
const microsSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

const listQuerySchema = z.object({
  countryCode: z.string().trim().min(1).max(16).optional(),
  category: z.nativeEnum(WhatsAppUsageCategory).optional(),
  providerKey: z.nativeEnum(WhatsAppProviderKey).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  countryCode: z.string().trim().min(1).max(16),
  category: z.nativeEnum(WhatsAppUsageCategory),
  providerKey: z.nativeEnum(WhatsAppProviderKey),
  currency: z.string().trim().min(1).max(8).optional(),
  baseCostMicros: microsSchema,
  providerCostMicros: microsSchema.optional(),
  taxBps: z.number().int().optional(),
  gatewayFeeBps: z.number().int().optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  supersedePrevious: z.boolean().optional(),
});

const updateSchema = z.object({
  currency: z.string().trim().min(1).max(8).optional(),
  baseCostMicros: microsSchema.optional(),
  providerCostMicros: microsSchema.optional(),
  taxBps: z.number().int().optional(),
  gatewayFeeBps: z.number().int().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/admin/rates
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const rows = await listRates(q);
    res.json({ success: true, data: rows.map(serializeRate) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/rates
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const row = await createRate(body, req.userId!);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "WhatsAppRateTable",
      resourceId: row.id,
      newValues: serializeRate(row),
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: serializeRate(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/admin/rates/:id
router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const before = await getRate(req.params.id);
    const row = await updateRate(req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "WhatsAppRateTable",
      resourceId: row.id,
      oldValues: serializeRate(before),
      newValues: serializeRate(row),
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: serializeRate(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/rates/:id/deactivate
router.post(
  "/:id/deactivate",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await deactivateRate(req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WhatsAppRateTable",
        resourceId: row.id,
        newValues: { isActive: false, effectiveTo: row.effectiveTo },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: serializeRate(row) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
