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
  deleteMetaAdsConnection,
  discoverLeadForms,
  getAccountInsightsByCampaign,
  getCampaignInsights,
  getMetaAdsConnection,
  listCampaigns,
  listSubscribedLeadForms,
  saveMetaAdsConnection,
  subscribeLeadForm,
  unsubscribeLeadForm,
  type MetaCampaignInsights,
} from "../services/metaAds.service";

const router = Router();

router.use(requireAuth, requireTenantScope);

// ----------------------------------------------------------------------------
// Connection
// ----------------------------------------------------------------------------

router.get(
  "/connection",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const conn = await getMetaAdsConnection(req.tenantId!);
      if (!conn) {
        res.json({ success: true, data: null });
        return;
      }
      // Never return the encrypted token — the UI doesn't need it.
      res.json({
        success: true,
        data: {
          id: conn.id,
          adAccountId: conn.adAccountId,
          adAccountName: conn.adAccountName,
          businessName: conn.businessName,
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
  accessToken: z.string().trim().min(20).max(4000),
  adAccountId: z.string().trim().min(1).max(64),
});

router.post(
  "/connection",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = connectSchema.parse(req.body);
      const conn = await saveMetaAdsConnection({
        tenantId: req.tenantId!,
        accessToken: body.accessToken,
        adAccountId: body.adAccountId,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "MetaAdsConnection",
        resourceId: conn.id,
        newValues: {
          adAccountId: conn.adAccountId,
          businessName: conn.businessName,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({
        success: true,
        data: {
          adAccountId: conn.adAccountId,
          adAccountName: conn.adAccountName,
          businessName: conn.businessName,
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
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await deleteMetaAdsConnection(req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "MetaAdsConnection",
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
// Campaigns + insights
// ----------------------------------------------------------------------------

const datePresetSchema = z
  .enum(["today", "yesterday", "last_7d", "last_28d", "this_month"])
  .default("last_7d");

router.get(
  "/campaigns",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const datePreset = datePresetSchema.parse(req.query.datePreset);
      const [campaigns, insightsByCampaign] = await Promise.all([
        listCampaigns({ tenantId: req.tenantId! }),
        // Insights call may fail (campaigns can exist without spend) — don't
        // block the campaign list response on it.
        getAccountInsightsByCampaign({
          tenantId: req.tenantId!,
          datePreset,
        }).catch((): Record<string, MetaCampaignInsights> => ({})),
      ]);
      const merged = campaigns.map((c) => ({
        ...c,
        insights: insightsByCampaign[c.id] ?? null,
      }));
      res.json({ success: true, data: { datePreset, campaigns: merged } });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/campaigns/:id/insights",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const datePreset = datePresetSchema.parse(req.query.datePreset);
      const insights = await getCampaignInsights({
        tenantId: req.tenantId!,
        campaignId: req.params.id,
        datePreset,
      });
      res.json({ success: true, data: insights });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Lead Ads — discovery + subscriptions (slice 2)
// ----------------------------------------------------------------------------

router.get(
  "/lead-forms",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const forms = await listSubscribedLeadForms(req.tenantId!);
      res.json({ success: true, data: forms });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/lead-forms/discover",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const forms = await discoverLeadForms(req.tenantId!);
      res.json({ success: true, data: forms });
    } catch (err) {
      next(err);
    }
  },
);

const subscribeSchema = z.object({
  formId: z.string().trim().min(1).max(64),
  formName: z.string().trim().max(200).optional(),
  pageId: z.string().trim().max(64).optional(),
  pageName: z.string().trim().max(200).optional(),
  importTag: z.string().trim().max(80).optional(),
});

router.post(
  "/lead-forms",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = subscribeSchema.parse(req.body);
      const form = await subscribeLeadForm({
        tenantId: req.tenantId!,
        ...body,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "MetaAdsLeadForm",
        resourceId: form.id,
        newValues: { formId: form.formId, formName: form.formName },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: form });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/lead-forms/:id",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await unsubscribeLeadForm({
        tenantId: req.tenantId!,
        id: req.params.id,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "MetaAdsLeadForm",
        resourceId: req.params.id,
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
