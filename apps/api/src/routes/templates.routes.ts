import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, Permissions, TemplateStatus } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  generateWhatsAppTemplate,
  predictTemplateApproval,
} from "../services/ai.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  normalizeHeaderType,
  normalizeTemplateType,
  normalizeCatalogFormat,
  validateTemplateButtons,
  validateCarousel,
  assertTemplateContentPolicy,
  buildMetaTemplatePayload,
} from "../services/whatsappTemplate.service";
import { syncTemplatesFromMeta } from "../services/whatsappTemplateSync.service";
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";

const META_GRAPH_BASE =
  process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0";

const router = Router();
router.use(requireAuth, requireTenantScope);

const createSchema = z.object({
  name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/, "Template name must be lowercase letters, digits, or underscores"),
  // Meta's three buckets. OTP/ACCOUNT_UPDATE are legacy aliases mapped below.
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "OTP", "ACCOUNT_UPDATE"]),
  // Composer sub-type within the category (defaults to CUSTOM if omitted).
  templateType: z.enum(["CUSTOM", "CATALOGUE", "FLOWS", "ORDER_DETAILS", "CAROUSEL", "OTP"]).optional(),
  catalogFormat: z.enum(["CATALOG_MESSAGE", "MPM"]).optional(),
  language: z.string().min(2).max(10).default("en_US"),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  headerText: z.string().max(60).optional(),
  headerMediaUrl: z.string().url().max(2000).optional(),
  bodyText: z.string().min(1).max(1024),
  footerText: z.string().max(60).optional(),
  buttons: z.array(z.record(z.unknown())).max(10).optional(),
  carousel: z.array(z.record(z.unknown())).max(10).optional(),
  samples: z
    .object({ body: z.array(z.string()).max(20).optional(), header: z.string().max(200).optional() })
    .optional(),
});

// Legacy category aliases → Meta buckets, so older callers keep working.
const CATEGORY_ALIASES: Record<string, string> = { OTP: "AUTHENTICATION", ACCOUNT_UPDATE: "UTILITY" };

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.whatsAppTemplate.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      // Enforce Meta's authoring policy (variable numbering, footer/header
      // variable rules, etc.) so we reject locally what Meta would reject.
      assertTemplateContentPolicy(body);
      const dup = await prisma.whatsAppTemplate.findFirst({
        where: { tenantId: req.tenantId, name: body.name },
      });
      if (dup) {
        throw new ApiError(
          ErrorCodes.CONFLICT,
          409,
          "Template with this name already exists.",
        );
      }
      const buttons = validateTemplateButtons(body.buttons);
      const headerType = normalizeHeaderType(body.headerType ?? (body.headerText ? "TEXT" : "NONE"));
      const templateType = normalizeTemplateType(body.templateType);
      const carousel = validateCarousel(body.carousel);
      // catalogFormat only meaningful for Catalogue templates.
      const catalogFormat = templateType === "CATALOGUE" ? normalizeCatalogFormat(body.catalogFormat) : null;
      const template = await prisma.whatsAppTemplate.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name,
          category: CATEGORY_ALIASES[body.category] ?? body.category,
          templateType,
          catalogFormat,
          language: body.language,
          headerType,
          headerText: headerType === "TEXT" ? body.headerText : null,
          headerMediaUrl: headerType !== "NONE" && headerType !== "TEXT" ? body.headerMediaUrl ?? null : null,
          bodyText: body.bodyText,
          footerText: body.footerText,
          buttons: buttons.length ? (buttons as unknown as object) : undefined,
          carousel: carousel.length ? (carousel as unknown as object) : undefined,
          samples: body.samples && (body.samples.body?.length || body.samples.header)
            ? (body.samples as unknown as object)
            : undefined,
          status: TemplateStatus.DRAFT,
          variants: [],
        },
      });
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Sync: pull the tenant's message templates from Meta and upsert them locally
// (matches the reference "Sync Templates" button). Upserts by (name, language)
// so re-running keeps statuses fresh without creating duplicates.
// ---------------------------------------------------------------------------
router.post(
  "/sync",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const result = await syncTemplatesFromMeta(req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WhatsAppTemplate",
        resourceId: "sync",
        newValues: result,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Submit a draft template to Meta for approval. Builds the components payload,
// POSTs it to {wabaId}/message_templates, then records the Meta template id +
// SUBMITTED status (or stores the rejection reason on failure).
// ---------------------------------------------------------------------------
router.post(
  "/:id/submit",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const template = await prisma.whatsAppTemplate.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!template) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found in tenant scope.");
      }
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { wabaId: true, wabaAccessToken: true },
      });
      if (!tenant?.wabaId || !tenant?.wabaAccessToken) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Connect your WhatsApp Business account (WABA ID + access token) before submitting templates.",
        );
      }
      const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
      if (!accessToken) {
        throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "WhatsApp access token failed to decrypt.");
      }

      const payload = buildMetaTemplatePayload(template);
      const url = `${META_GRAPH_BASE}/${tenant.wabaId}/message_templates`;
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        const message = data.error?.message ?? `Meta Graph API returned HTTP ${response.status}.`;
        await prisma.whatsAppTemplate.update({
          where: { id: template.id },
          data: { approvalReason: message },
        });
        throw new ApiError(ErrorCodes.BAD_REQUEST, 502, message);
      }

      const updated = await prisma.whatsAppTemplate.update({
        where: { id: template.id },
        data: {
          metaTemplateId: data.id ?? template.metaTemplateId,
          status: TemplateStatus.SUBMITTED,
          approvalReason: null,
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WhatsAppTemplate",
        resourceId: template.id,
        newValues: { submittedToMeta: true, metaTemplateId: data.id ?? null },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Delete a template — removes it from Meta (by name, if it was pushed there
// and the WABA is connected) and then deletes the local row.
// ---------------------------------------------------------------------------
router.delete(
  "/:id",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const template = await prisma.whatsAppTemplate.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!template) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found in tenant scope.");
      }

      // If it reached Meta and the WABA is connected, delete it there first so
      // we don't orphan an approved template the tenant can no longer see.
      if (template.metaTemplateId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: req.tenantId! },
          select: { wabaId: true, wabaAccessToken: true },
        });
        const accessToken = tenant?.wabaAccessToken ? decryptTokenIfNeeded(tenant.wabaAccessToken) : null;
        if (tenant?.wabaId && accessToken) {
          const url = `${META_GRAPH_BASE}/${tenant.wabaId}/message_templates?name=${encodeURIComponent(template.name)}`;
          const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new ApiError(
              ErrorCodes.BAD_REQUEST,
              502,
              data.error?.message ?? `Meta template delete failed (HTTP ${response.status}).`,
            );
          }
        }
      }

      await prisma.whatsAppTemplate.delete({ where: { id: template.id } });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "WhatsAppTemplate",
        resourceId: template.id,
        oldValues: { name: template.name, status: template.status },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: { id: template.id } });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// T-055: AI-assisted template generation + approval prediction.
//
// /ai/generate    -> stateless. Returns up to 3 variants the operator
//                    can copy into the create form. Does NOT persist
//                    anything — generation is cheap to iterate, the
//                    operator decides which variant (if any) to save.
//
// /ai/predict-approval -> two modes:
//                    1) Given a templateId, score it AND persist the
//                       score to aiScoreApprovalChance.
//                    2) Given raw fields (no id), score without
//                       persisting — used inside the "create" form
//                       before the row exists.
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  industry: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(10).optional(),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
  tone: z.string().trim().max(80).optional(),
  samples: z.array(z.string()).max(5).optional(),
  placeholders: z.array(z.string()).max(10).optional(),
});

router.post(
  "/ai/generate",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = generateSchema.parse(req.body);
      const variants = await generateWhatsAppTemplate(req.tenantId!, body);
      res.json({ success: true, data: { variants } });
    } catch (err) {
      next(err);
    }
  },
);

const predictSchema = z.union([
  // Mode 1: score an existing template (persists the score).
  z.object({
    templateId: z.string().min(1),
  }),
  // Mode 2: score raw fields (no persistence).
  z.object({
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    language: z.string().trim().min(2).max(10).optional(),
    headerText: z.string().trim().max(60).nullable().optional(),
    bodyText: z.string().trim().min(1).max(1024),
    footerText: z.string().trim().max(60).nullable().optional(),
  }),
]);

router.post(
  "/ai/predict-approval",
  requirePermission(Permissions.TEMPLATE_SUBMIT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = predictSchema.parse(req.body);
      let categoryForScoring: "MARKETING" | "UTILITY" | "AUTHENTICATION";
      let headerText: string | null | undefined;
      let bodyText: string;
      let footerText: string | null | undefined;
      let language: string | undefined;
      let persistTo: string | null = null;

      if ("templateId" in body) {
        const tmpl = await prisma.whatsAppTemplate.findFirst({
          where: { id: body.templateId, tenantId: req.tenantId },
        });
        if (!tmpl) {
          throw new ApiError(
            ErrorCodes.NOT_FOUND,
            404,
            "Template not found in tenant scope.",
          );
        }
        // The schema column is loose String; map common values to the
        // ai.service union and refuse anything we can't score.
        const upper = tmpl.category.toUpperCase();
        if (
          upper !== "MARKETING" &&
          upper !== "UTILITY" &&
          upper !== "AUTHENTICATION"
        ) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            400,
            `Template category "${tmpl.category}" is not scorable. Allowed: MARKETING, UTILITY, AUTHENTICATION.`,
          );
        }
        categoryForScoring = upper;
        headerText = tmpl.headerText;
        bodyText = tmpl.bodyText;
        footerText = tmpl.footerText;
        language = tmpl.language;
        persistTo = tmpl.id;
      } else {
        categoryForScoring = body.category;
        headerText = body.headerText;
        bodyText = body.bodyText;
        footerText = body.footerText;
        language = body.language;
      }

      const result = await predictTemplateApproval(req.tenantId!, {
        category: categoryForScoring,
        language,
        headerText,
        bodyText,
        footerText,
      });

      if (persistTo) {
        await prisma.whatsAppTemplate.update({
          where: { id: persistTo },
          data: { aiScoreApprovalChance: result.score },
        });
        // Audit-log the score so a tenant can see who ran predictions
        // and when (useful when an approval is contested later).
        await logAudit({
          tenantId: req.tenantId!,
          userId: req.userId!,
          action: "UPDATE",
          resource: "WhatsAppTemplate",
          resourceId: persistTo,
          newValues: {
            aiScoreApprovalChance: result.score,
            aiPredictVerdict: result.verdict,
          },
          ...extractRequestMeta(req),
        });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
