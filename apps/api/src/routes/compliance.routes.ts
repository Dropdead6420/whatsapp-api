import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireFeature } from "../services/features.service";
import {
  ComplianceMode,
  ComplianceScope,
  ComplianceVerdict,
  decisionForCheck,
  getTenantComplianceModeConfig,
  overrideComplianceCheck,
  runComplianceCheck,
  setTenantComplianceModeConfig,
} from "../services/compliance.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requireFeature("complianceFirewall"),
);

const checkSchema = z.object({
  scope: z.nativeEnum(ComplianceScope),
  refId: z.string().trim().min(1).max(120).nullable().optional(),
  content: z.string().trim().min(1).max(4096),
  mode: z.nativeEnum(ComplianceMode).optional(),
  useAi: z.boolean().optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.nativeEnum(ComplianceScope).optional(),
  verdict: z.nativeEnum(ComplianceVerdict).optional(),
  refId: z.string().trim().min(1).max(120).optional(),
});

const modeSchema = z
  .object({
    default: z.nativeEnum(ComplianceMode).optional(),
    CAMPAIGN: z.nativeEnum(ComplianceMode).nullable().optional(),
    DRIP_STEP: z.nativeEnum(ComplianceMode).nullable().optional(),
    TEMPLATE: z.nativeEnum(ComplianceMode).nullable().optional(),
    REPLY: z.nativeEnum(ComplianceMode).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one mode value.",
  });

const overrideSchema = z.object({
  reason: z.string().trim().min(8).max(500),
});

router.get(
  "/mode",
  requirePermission(Permissions.COMPLIANCE_REVIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const mode = await getTenantComplianceModeConfig(req.tenantId!);
      res.json({ success: true, data: mode });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/mode",
  requirePermission(Permissions.COMPLIANCE_REVIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = modeSchema.parse(req.body);
      const updates = {
        default: body.default,
        CAMPAIGN: body.CAMPAIGN,
        DRIP_STEP: body.DRIP_STEP,
        TEMPLATE: body.TEMPLATE,
        REPLY: body.REPLY,
      };
      const mode = await setTenantComplianceModeConfig(req.tenantId!, updates);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "ComplianceMode",
        resourceId: req.tenantId!,
        newValues: mode,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: mode });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/check",
  requirePermission(Permissions.COMPLIANCE_REVIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = checkSchema.parse(req.body);
      const result = await runComplianceCheck({
        tenantId: req.tenantId!,
        scope: body.scope,
        refId: body.refId,
        content: body.content,
        mode: body.mode,
        createdByUserId: req.userId,
        useAi: body.useAi,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "ComplianceCheck",
        resourceId: result.check.id,
        newValues: {
          scope: result.check.scope,
          verdict: result.check.verdict,
          score: result.check.score,
          cached: result.cached,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/checks",
  requirePermission(Permissions.COMPLIANCE_REVIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const where = {
        tenantId: req.tenantId!,
        ...(q.scope && { scope: q.scope }),
        ...(q.verdict && { verdict: q.verdict }),
        ...(q.refId && { refId: q.refId }),
      };
      const [items, total] = await prisma.$transaction([
        prisma.complianceCheck.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        prisma.complianceCheck.count({ where }),
      ]);
      res.json({
        success: true,
        data: {
          items: items.map((check) => ({
            ...check,
            decision: decisionForCheck(check),
          })),
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/checks/:id/override",
  requirePermission(Permissions.COMPLIANCE_REVIEW),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = overrideSchema.parse(req.body);
      const updated = await overrideComplianceCheck({
        tenantId: req.tenantId!,
        checkId: req.params.id,
        userId: req.userId!,
        reason: body.reason,
      });
      if (!decisionForCheck(updated).allowed) {
        throw new ApiError(
          ErrorCodes.INTERNAL_SERVER_ERROR,
          500,
          "Compliance override did not produce an allowed decision.",
        );
      }
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "COMPLIANCE_OVERRIDE",
        resource: "ComplianceCheck",
        resourceId: updated.id,
        newValues: {
          verdict: updated.verdict,
          mode: updated.mode,
          reason: body.reason,
        },
        ...extractRequestMeta(req),
      });
      res.json({
        success: true,
        data: { check: updated, decision: decisionForCheck(updated) },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
