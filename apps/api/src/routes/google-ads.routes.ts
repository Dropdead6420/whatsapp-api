import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  deleteGoogleAdsConnection,
  getGoogleAdsConnection,
  listCampaignsWithMetrics,
  saveGoogleAdsConnection,
} from "../services/googleAds.service";

const router = Router();

router.use(requireAuth, requireTenantScope);

// ----------------------------------------------------------------------------
// Connection
// ----------------------------------------------------------------------------

router.get(
  "/connection",
  requirePermission(Permissions.GOOGLE_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const conn = await getGoogleAdsConnection(req.tenantId!);
      if (!conn) {
        res.json({ success: true, data: null });
        return;
      }
      res.json({
        success: true,
        data: {
          id: conn.id,
          customerId: conn.customerId,
          loginCustomerId: conn.loginCustomerId,
          customerName: conn.customerName,
          currency: conn.currency,
          timeZoneName: conn.timeZoneName,
          lastSyncedAt: conn.lastSyncedAt,
          lastSyncError: conn.lastSyncError,
          createdAt: conn.createdAt,
          updatedAt: conn.updatedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

const connectSchema = z.object({
  refreshToken: z.string().trim().min(20).max(4000),
  customerId: z.string().trim().min(1).max(20),
  loginCustomerId: z.string().trim().max(20).optional(),
});

router.post(
  "/connection",
  requirePermission(Permissions.GOOGLE_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = connectSchema.parse(req.body);
      const conn = await saveGoogleAdsConnection({
        tenantId: req.tenantId!,
        refreshToken: body.refreshToken,
        customerId: body.customerId,
        loginCustomerId: body.loginCustomerId,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "GoogleAdsConnection",
        resourceId: conn.id,
        newValues: {
          customerId: conn.customerId,
          customerName: conn.customerName,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({
        success: true,
        data: {
          customerId: conn.customerId,
          loginCustomerId: conn.loginCustomerId,
          customerName: conn.customerName,
          currency: conn.currency,
          timeZoneName: conn.timeZoneName,
          lastSyncedAt: conn.lastSyncedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/connection",
  requirePermission(Permissions.GOOGLE_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await deleteGoogleAdsConnection(req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "GoogleAdsConnection",
        resourceId: req.tenantId!,
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Campaigns + metrics
// ----------------------------------------------------------------------------

const datePresetSchema = z
  .enum([
    "TODAY",
    "YESTERDAY",
    "LAST_7_DAYS",
    "LAST_14_DAYS",
    "LAST_30_DAYS",
    "THIS_MONTH",
    "LAST_MONTH",
  ])
  .default("LAST_7_DAYS");

router.get(
  "/campaigns",
  requirePermission(Permissions.GOOGLE_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const datePreset = datePresetSchema.parse(req.query.datePreset);
      const campaigns = await listCampaignsWithMetrics({
        tenantId: req.tenantId!,
        datePreset,
      });
      res.json({ success: true, data: { datePreset, campaigns } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
