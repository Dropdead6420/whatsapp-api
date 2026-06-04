// ============================================================================
// SuperAdmin language master + customer/partner defaults
// Final Currency/Language PDF §9.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { TextDirection, TranslationJobStatus, TranslationSourceType } from "@nexaflow/db";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  createTranslationJob,
  ensureLaunchLanguages,
  getCustomerLanguageSetting,
  getPartnerLanguageSetting,
  listLanguages,
  listTranslationJobs,
  setCustomerLanguageSetting,
  setPartnerLanguageSetting,
  upsertLanguage,
  upsertPortalTranslation,
  upsertTranslationKey,
} from "../services/languageSettings.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const upsertLanguageSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(80),
  nativeName: z.string().trim().min(1).max(80),
  direction: z.nativeEnum(TextDirection).optional(),
  isActive: z.boolean().optional(),
  isLaunchLanguage: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
});

const listSchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
});

const customerSettingSchema = z.object({
  languageCode: z.string().trim().min(1).max(16),
  locale: z.string().trim().min(2).max(20).optional(),
  allowAutoTranslate: z.boolean().optional(),
  requireApprovalForSensitive: z.boolean().optional(),
});

const partnerSettingSchema = z.object({
  defaultLanguageCode: z.string().trim().min(1).max(16),
  allowedLanguages: z.array(z.string().trim().min(1).max(16)).max(64).optional(),
  allowCustomerOverride: z.boolean().optional(),
});

const translationKeySchema = z.object({
  namespace: z.string().trim().min(1).max(80).optional(),
  key: z.string().trim().min(2).max(180),
  defaultText: z.string().trim().min(1).max(5_000),
  description: z.string().trim().max(500).optional(),
});

const portalTranslationSchema = z.object({
  languageCode: z.string().trim().min(1).max(16),
  text: z.string().trim().min(1).max(10_000),
  status: z.enum(["draft", "review", "published"]).optional(),
});

const jobListSchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
  status: z.nativeEnum(TranslationJobStatus).optional(),
  sourceType: z.nativeEnum(TranslationSourceType).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const jobCreateSchema = z.object({
  tenantId: z.string().trim().min(1),
  sourceType: z.nativeEnum(TranslationSourceType),
  sourceId: z.string().trim().min(1).max(200),
  sourceLanguageCode: z.string().trim().min(1).max(16).optional(),
  targetLanguageCode: z.string().trim().min(1).max(16),
});

// GET /api/v1/admin/languages
router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = listSchema.parse(req.query);
    const rows = await listLanguages(q);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/languages/seed-launch
router.post(
  "/seed-launch",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await ensureLaunchLanguages();
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Language",
        newValues: { launchLanguagesSeeded: true },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: await listLanguages({ activeOnly: true }) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/admin/languages
router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = upsertLanguageSchema.parse(req.body);
    const row = await upsertLanguage(body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Language",
      resourceId: row.code,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/languages/settings/customer/:tenantId
router.get(
  "/settings/customer/:tenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await getCustomerLanguageSetting(req.params.tenantId);
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/languages/settings/customer/:tenantId
router.patch(
  "/settings/customer/:tenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = customerSettingSchema.parse(req.body);
      const row = await setCustomerLanguageSetting({
        tenantId: req.params.tenantId,
        ...body,
        createdByUserId: req.userId!,
      });
      await logAudit({
        tenantId: req.params.tenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "CustomerLanguageSetting",
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

// GET /api/v1/admin/languages/settings/partner/:partnerTenantId
router.get(
  "/settings/partner/:partnerTenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const row = await getPartnerLanguageSetting(req.params.partnerTenantId);
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/admin/languages/settings/partner/:partnerTenantId
router.patch(
  "/settings/partner/:partnerTenantId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = partnerSettingSchema.parse(req.body);
      const row = await setPartnerLanguageSetting({
        partnerTenantId: req.params.partnerTenantId,
        ...body,
        createdByUserId: req.userId!,
      });
      await logAudit({
        tenantId: req.params.partnerTenantId,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PartnerLanguageSetting",
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

// POST /api/v1/admin/languages/keys
router.post("/keys", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = translationKeySchema.parse(req.body);
    const row = await upsertTranslationKey(body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "TranslationKey",
      resourceId: row.id,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/languages/keys/:id/translations
router.post(
  "/keys/:id/translations",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = portalTranslationSchema.parse(req.body);
      const row = await upsertPortalTranslation({
        translationKeyId: req.params.id,
        ...body,
        reviewedByUserId: req.userId!,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "PortalTranslation",
        resourceId: row.id,
        newValues: row,
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/admin/languages/jobs
router.get("/jobs", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const q = jobListSchema.parse(req.query);
    const data = await listTranslationJobs(q);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/languages/jobs
router.post("/jobs", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = jobCreateSchema.parse(req.body);
    const row = await createTranslationJob({
      ...body,
      requestedByUserId: req.userId!,
    });
    await logAudit({
      tenantId: body.tenantId,
      userId: req.userId!,
      action: "CREATE",
      resource: "TranslationJob",
      resourceId: row.id,
      newValues: row,
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

export default router;
