// ============================================================================
// SuperAdmin currency master + customer/partner defaults
// Final Currency/Language PDF §7.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  ensureLaunchCurrencies,
  getCustomerCurrencySetting,
  getPartnerCurrencySetting,
  listCurrencies,
  setCustomerCurrencySetting,
  setPartnerCurrencySetting,
  upsertCurrency,
} from "../services/currencySettings.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const upsertCurrencySchema = z.object({
  code: z.string().trim().min(1).max(8),
  name: z.string().trim().min(1).max(80),
  symbol: z.string().trim().min(1).max(12),
  minorUnit: z.number().int().min(0).max(8).optional(),
  isActive: z.boolean().optional(),
  isLaunchCurrency: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
});

const listSchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
});

const customerSettingSchema = z.object({
  currencyCode: z.string().trim().min(1).max(8),
  locale: z.string().trim().min(2).max(20).optional(),
  showConvertedAmounts: z.boolean().optional(),
});

const partnerSettingSchema = z.object({
  defaultCurrencyCode: z.string().trim().min(1).max(8),
  settlementCurrencyCode: z.string().trim().min(1).max(8).optional(),
  allowedCurrencies: z.array(z.string().trim().min(1).max(8)).max(32).optional(),
  passThroughCustomerCurrency: z.boolean().optional(),
});

// GET /api/v1/admin/currencies
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listSchema.parse(req.query);
    const rows = await listCurrencies(q);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/currencies/seed-launch
router.post(
  "/seed-launch",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await ensureLaunchCurrencies();
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Currency",
        newValues: { launchCurrenciesSeeded: true },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: await listCurrencies({ activeOnly: true }) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/currencies
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = upsertCurrencySchema.parse(req.body);
    const row = await upsertCurrency(body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Currency",
      resourceId: row.code,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/currencies/settings/customer/:tenantId
router.get(
  "/settings/customer/:tenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await getCustomerCurrencySetting(req.params.tenantId);
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/currencies/settings/customer/:tenantId
router.patch(
  "/settings/customer/:tenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = customerSettingSchema.parse(req.body);
      const row = await setCustomerCurrencySetting({
        tenantId: req.params.tenantId,
        ...body,
        createdByUserId: req.userId!,
      });
      await logAudit({
        tenantId: req.params.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "CustomerCurrencySetting",
        resourceId: row.id,
        newValues: row,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/currencies/settings/partner/:partnerTenantId
router.get(
  "/settings/partner/:partnerTenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await getPartnerCurrencySetting(req.params.partnerTenantId);
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/currencies/settings/partner/:partnerTenantId
router.patch(
  "/settings/partner/:partnerTenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = partnerSettingSchema.parse(req.body);
      const row = await setPartnerCurrencySetting({
        partnerTenantId: req.params.partnerTenantId,
        ...body,
        createdByUserId: req.userId!,
      });
      await logAudit({
        tenantId: req.params.partnerTenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerCurrencySetting",
        resourceId: row.id,
        newValues: row,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
