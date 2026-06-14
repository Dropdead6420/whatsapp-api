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
  validateTemplateButtons,
} from "../services/whatsappTemplate.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const createSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9_]+$/, "Template name must be lowercase letters, digits, or underscores"),
  // Meta's three buckets. OTP/ACCOUNT_UPDATE are legacy aliases mapped below.
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION", "OTP", "ACCOUNT_UPDATE"]),
  language: z.string().min(2).max(10).default("en_US"),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  headerText: z.string().max(60).optional(),
  headerMediaUrl: z.string().url().max(2000).optional(),
  bodyText: z.string().min(1).max(1024),
  footerText: z.string().max(60).optional(),
  buttons: z.array(z.record(z.unknown())).max(10).optional(),
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
      const template = await prisma.whatsAppTemplate.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name,
          category: CATEGORY_ALIASES[body.category] ?? body.category,
          language: body.language,
          headerType,
          headerText: headerType === "TEXT" ? body.headerText : null,
          headerMediaUrl: headerType !== "NONE" && headerType !== "TEXT" ? body.headerMediaUrl ?? null : null,
          bodyText: body.bodyText,
          footerText: body.footerText,
          buttons: buttons.length ? (buttons as unknown as object) : undefined,
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
