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

const router = Router();
router.use(requireAuth, requireTenantScope);

const templateCategorySchema = z.preprocess((value) => {
  if (value === "OTP") return "AUTHENTICATION";
  if (value === "ACCOUNT_UPDATE") return "UTILITY";
  return value;
}, z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]));

const createSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9_]+$/, "Template name must be lowercase letters, digits, or underscores"),
  category: templateCategorySchema,
  language: z.string().min(2).max(10).default("en_US"),
  headerText: z.string().max(60).optional(),
  bodyText: z.string().min(1).max(1024),
  footerText: z.string().max(60).optional(),
});

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
      const template = await prisma.whatsAppTemplate.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name,
          category: body.category,
          language: body.language,
          headerText: body.headerText,
          bodyText: body.bodyText,
          footerText: body.footerText,
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

export default router;
