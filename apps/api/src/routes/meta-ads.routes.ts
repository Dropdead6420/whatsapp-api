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
  createClickToWhatsAppDraft,
  deleteMetaAdsConnection,
  deleteMetaAudienceLocal,
  discoverLeadForms,
  exportMetaAudience,
  getAccountInsightsByCampaign,
  getCampaignInsights,
  getMetaAdsConnection,
  listCampaigns,
  listMetaAudiences,
  listPromotablePages,
  listSubscribedLeadForms,
  previewAudienceSize,
  refreshMetaAudience,
  runMetaCampaignOptimizer,
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

// ----------------------------------------------------------------------------
// Custom audiences — retargeting export (slice 3)
// ----------------------------------------------------------------------------

const audienceSpecSchema = z.object({
  tagsAny: z.array(z.string().max(80)).max(40).optional(),
  tagsAll: z.array(z.string().max(80)).max(40).optional(),
  inactiveSinceDays: z.number().int().positive().max(3650).optional(),
  interactedWithinDays: z.number().int().positive().max(3650).optional(),
  aiScoreGte: z.number().min(0).max(1).optional(),
  aiScoreLte: z.number().min(0).max(1).optional(),
  hasEmail: z.boolean().optional(),
  // optedOut is intentionally rejected — service always forces false.
});

router.get(
  "/audiences",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const data = await listMetaAudiences(req.tenantId!);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/audiences/preview",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const spec = audienceSpecSchema.parse(req.body ?? {});
      const preview = await previewAudienceSize({
        tenantId: req.tenantId!,
        spec,
      });
      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  },
);

const exportAudienceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(800).optional(),
  spec: audienceSpecSchema.default({}),
});

router.post(
  "/audiences",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = exportAudienceSchema.parse(req.body);
      const audience = await exportMetaAudience({
        tenantId: req.tenantId!,
        name: body.name,
        description: body.description,
        spec: body.spec,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "MetaAdsAudience",
        resourceId: audience.id,
        newValues: {
          name: audience.name,
          uploadedCount: audience.uploadedCount,
          metaAudienceId: audience.metaAudienceId,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: audience });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/audiences/:id/refresh",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const audience = await refreshMetaAudience({
        tenantId: req.tenantId!,
        audienceRowId: req.params.id,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "MetaAdsAudience",
        resourceId: audience.id,
        newValues: { uploadedCount: audience.uploadedCount },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: audience });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/audiences/:id",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await deleteMetaAudienceLocal({
        tenantId: req.tenantId!,
        audienceRowId: req.params.id,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "MetaAdsAudience",
        resourceId: req.params.id,
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Click-to-WhatsApp ad drafts (slice 4)
// ----------------------------------------------------------------------------

router.get(
  "/pages",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const pages = await listPromotablePages(req.tenantId!);
      res.json({ success: true, data: pages });
    } catch (err) {
      next(err);
    }
  },
);

const ctwaSchema = z.object({
  pageId: z.string().trim().min(1).max(64),
  campaignName: z.string().trim().min(1).max(200),
  dailyBudgetMinor: z.number().int().min(1).max(10_000_000_00), // 10M minor units
  geoCountries: z
    .array(z.string().trim().regex(/^[A-Z]{2}$/))
    .max(60)
    .optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(18).max(65).optional(),
});

// ----------------------------------------------------------------------------
// AI campaign optimizer (slice 5)
// ----------------------------------------------------------------------------

const optimizerSchema = z.object({
  datePreset: z
    .enum(["today", "yesterday", "last_7d", "last_28d", "this_month"])
    .default("last_7d"),
});

router.post(
  "/optimizer",
  requirePermission(Permissions.META_ADS_VIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = optimizerSchema.parse(req.body ?? {});
      const result = await runMetaCampaignOptimizer({
        tenantId: req.tenantId!,
        datePreset: body.datePreset,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/click-to-whatsapp",
  requirePermission(Permissions.META_ADS_MANAGE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = ctwaSchema.parse(req.body);
      const draft = await createClickToWhatsAppDraft({
        tenantId: req.tenantId!,
        pageId: body.pageId,
        campaignName: body.campaignName,
        dailyBudgetMinor: body.dailyBudgetMinor,
        geoCountries: body.geoCountries,
        ageMin: body.ageMin,
        ageMax: body.ageMax,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "MetaAdsClickToWhatsAppDraft",
        resourceId: draft.campaignId,
        newValues: {
          adSetId: draft.adSetId,
          campaignName: body.campaignName,
          pageId: body.pageId,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: draft });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
