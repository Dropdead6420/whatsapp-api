// ============================================================================
// SuperAdmin FX / currency-rate control (Claude Corrected Billing §3)
//
// CRUD over CurrencyRate — the platform FX table the billing engine will
// use to convert a send priced in the rate row's currency into the
// customer's wallet currency. SUPER_ADMIN only. rateMicros is BigInt, so
// responses serialize it to a string. Every mutation is audited.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  createCurrencyRate,
  deactivateCurrencyRate,
  getCurrencyRate,
  listCurrencyRates,
  serializeCurrencyRate,
  updateCurrencyRate,
} from "../services/currency.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const microsSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);

const listQuerySchema = z.object({
  baseCurrency: z.string().trim().min(1).max(8).optional(),
  quoteCurrency: z.string().trim().min(1).max(8).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  baseCurrency: z.string().trim().min(1).max(8),
  quoteCurrency: z.string().trim().min(1).max(8),
  rateMicros: microsSchema,
  source: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
  supersedePrevious: z.boolean().optional(),
});

const updateSchema = z.object({
  rateMicros: microsSchema.optional(),
  source: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/admin/currency-rates
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const rows = await listCurrencyRates(q);
    res.json({ success: true, data: rows.map(serializeCurrencyRate) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/currency-rates
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const row = await createCurrencyRate(body, req.userId!);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "CurrencyRate",
      resourceId: row.id,
      newValues: serializeCurrencyRate(row),
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: serializeCurrencyRate(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/admin/currency-rates/:id
router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const before = await getCurrencyRate(req.params.id);
    const row = await updateCurrencyRate(req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CurrencyRate",
      resourceId: row.id,
      oldValues: serializeCurrencyRate(before),
      newValues: serializeCurrencyRate(row),
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: serializeCurrencyRate(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/currency-rates/:id/deactivate
router.post(
  "/:id/deactivate",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await deactivateCurrencyRate(req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "CurrencyRate",
        resourceId: row.id,
        newValues: { isActive: false, effectiveTo: row.effectiveTo },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: serializeCurrencyRate(row) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
