import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  CampaignStatus,
  CampaignType,
  ErrorCodes,
  Permissions,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { enqueueCampaign } from "../services/campaign.service";
import { requireFeature } from "../services/features.service";
import { enforceCompliance } from "../services/compliance.service";
import { ComplianceScope } from "@nexaflow/db";

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("campaigns"));

const audienceSchema = z.object({
  contactIds: z.array(z.string().cuid()).optional(),
  tags: z.array(z.string()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.nativeEnum(CampaignType).default(CampaignType.BROADCAST),
  templateId: z.string().cuid(),
  audience: audienceSchema,
  scheduledFor: z.string().datetime().optional(),
});

router.get("/", requirePermission(Permissions.CAMPAIGN_CREATE), async (req: RequestWithAuth, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      include: { template: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requirePermission(Permissions.CAMPAIGN_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const template = await prisma.whatsAppTemplate.findFirst({
        where: { id: body.templateId, tenantId: req.tenantId },
      });
      if (!template) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found.");
      }

      // Pre-send Compliance Firewall check. Throws ComplianceBlockedError
      // (→ 403) when the tenant's mode enforces the verdict; otherwise
      // returns the result for audit logging on the response.
      const complianceCheck = await enforceCompliance({
        tenantId: req.tenantId!,
        userId: req.userId,
        scope: ComplianceScope.CAMPAIGN,
        content: template.bodyText,
      });

      const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
      const status = scheduledFor ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT;

      const campaign = await prisma.campaign.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name,
          description: body.description,
          type: body.type,
          status,
          templateId: template.id,
          targetContacts: JSON.stringify(body.audience),
          scheduledFor,
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Campaign",
        resourceId: campaign.id,
        newValues: { name: campaign.name, status: campaign.status },
        ...extractRequestMeta(req),
      });

      res.status(201).json({
        success: true,
        data: campaign,
        meta: {
          compliance: {
            verdict: complianceCheck.verdict,
            score: complianceCheck.score,
            mode: complianceCheck.mode,
            violations: complianceCheck.violations,
            rewrite: complianceCheck.rewrite,
            reasoning: complianceCheck.reasoning,
            checkId: complianceCheck.id,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /campaigns/:id/send — dispatch immediately
router.post(
  "/:id/send",
  requirePermission(Permissions.CAMPAIGN_SEND),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!campaign) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Campaign not found.");
      }
      // Enqueue into BullMQ. The worker processes one dispatch at a time and
      // the jobId dedupes against the scan scheduler racing the same campaign.
      await enqueueCampaign(campaign.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Campaign",
        resourceId: campaign.id,
        newValues: { dispatchedAt: new Date().toISOString() },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: { dispatched: true } });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id",
  requirePermission(Permissions.CAMPAIGN_DELETE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!campaign) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Campaign not found.");
      }
      if (
        campaign.status === CampaignStatus.RUNNING ||
        campaign.status === CampaignStatus.COMPLETED
      ) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          `Cannot delete a campaign in status ${campaign.status}.`,
        );
      }
      await prisma.campaign.delete({ where: { id: campaign.id } });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "Campaign",
        resourceId: campaign.id,
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
