import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  CampaignStatus,
  CampaignType,
  ErrorCodes,
  MessageDirection,
  Permissions,
  TemplateStatus,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  analyzeSentiment,
  describeSegmentFilter,
  generateCopy,
  planCampaignAutopilot,
  scoreLead,
  suggestReplies,
} from "../services/ai.service";
import { listTenantTags, specToWhere } from "../services/segment.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { requireFeature } from "../services/features.service";
import {
  listRecentChecks,
  recordOverride,
  runComplianceCheck,
} from "../services/compliance.service";
import { ComplianceScope } from "@nexaflow/db";

const router = Router();
router.use(requireAuth, requireTenantScope);

// ----------------------------------------------------------------------------
// AI copy generator (existing)
// ----------------------------------------------------------------------------

const copySchema = z.object({
  prompt: z.string().min(5).max(2000),
  channel: z.enum([
    "whatsapp",
    "facebook_ad",
    "google_ad",
    "email",
    "sms",
    "instagram_caption",
  ]),
  tone: z
    .enum(["professional", "friendly", "casual", "urgent", "playful"])
    .optional(),
  variantCount: z.number().int().min(1).max(5).optional(),
  brandName: z.string().max(80).optional(),
  audienceDescription: z.string().max(400).optional(),
});

router.post(
  "/copy",
  requireFeature("aiStudio"),
  requirePermission(Permissions.CAMPAIGN_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const payload = copySchema.parse(req.body);
      const variants = await generateCopy(req.tenantId!, payload);
      res.json({ success: true, data: { variants } });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2: AI Smart Segmentation — natural language → audience preview
// ----------------------------------------------------------------------------

const segmentSchema = z.object({
  request: z.string().min(3).max(400),
  preview: z.coerce.boolean().default(true),
});

router.post(
  "/segment",
  requireFeature("smartSegment"),
  requirePermission(Permissions.CONTACT_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { request, preview } = segmentSchema.parse(req.body);
      const tags = await listTenantTags(req.tenantId!);
      const spec = await describeSegmentFilter(req.tenantId!, request, tags);
      const where = specToWhere(req.tenantId!, spec);

      let sample: Array<{
        id: string;
        name: string;
        phoneNumber: string;
        tags: string[];
      }> = [];
      let count = 0;
      if (preview) {
        const [c, rows] = await prisma.$transaction([
          prisma.contact.count({ where }),
          prisma.contact.findMany({
            where,
            take: 25,
            orderBy: { lastInteractionAt: "desc" },
            select: { id: true, name: true, phoneNumber: true, tags: true },
          }),
        ]);
        count = c;
        sample = rows;
      }

      res.json({
        success: true,
        data: { spec, count, sample },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2: AI Lead Scoring — analyze a contact, persist aiScore
// ----------------------------------------------------------------------------

const scoreSchema = z.object({
  contactId: z.string().cuid(),
});

router.post(
  "/score-contact",
  requireFeature("leadScoring"),
  requirePermission(Permissions.LEAD_UPDATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { contactId } = scoreSchema.parse(req.body);
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, tenantId: req.tenantId },
      });
      if (!contact) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }

      const [conversation, openLeads] = await prisma.$transaction([
        prisma.conversation.findFirst({
          where: { tenantId: req.tenantId, contactId: contact.id },
          orderBy: { lastMessageAt: "desc" },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 50,
              select: { direction: true },
            },
          },
        }),
        prisma.lead.findMany({
          where: {
            tenantId: req.tenantId,
            contactId: contact.id,
            status: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
          },
          select: { title: true },
        }),
      ]);

      const inbound = conversation?.messages.filter(
        (m) => m.direction === MessageDirection.INBOUND,
      ).length ?? 0;
      const outbound = conversation?.messages.filter(
        (m) => m.direction === MessageDirection.OUTBOUND,
      ).length ?? 0;

      const daysSinceCreated = Math.floor(
        (Date.now() - contact.createdAt.getTime()) / 86_400_000,
      );
      const daysSinceLastInteraction = contact.lastInteractionAt
        ? Math.floor(
            (Date.now() - contact.lastInteractionAt.getTime()) / 86_400_000,
          )
        : null;

      let customFields: Record<string, unknown> = {};
      if (contact.customFields) {
        try {
          customFields = JSON.parse(contact.customFields) as Record<string, unknown>;
        } catch {
          customFields = {};
        }
      }

      const result = await scoreLead(req.tenantId!, {
        contactName: contact.name,
        tags: contact.tags,
        customFields,
        daysSinceCreated,
        daysSinceLastInteraction,
        inboundMessages: inbound,
        outboundMessages: outbound,
        openLeadsCount: openLeads.length,
        leadTitles: openLeads.map((l) => l.title),
      });

      // Persist aiScore (0-1).
      const normalized = Math.max(0, Math.min(1, result.probability));
      await prisma.contact.update({
        where: { id: contact.id },
        data: { aiScore: normalized },
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2: AI Reply Suggestions for the agent inbox
// ----------------------------------------------------------------------------

const repliesSchema = z.object({
  conversationId: z.string().cuid(),
});

router.post(
  "/reply-suggestions",
  requireFeature("replySuggest"),
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { conversationId } = repliesSchema.parse(req.body);
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: req.tenantId },
        include: {
          contact: { select: { name: true } },
          tenant: { select: { name: true } },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 30,
            select: { direction: true, content: true },
          },
        },
      });
      if (!conversation) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      if (conversation.messages.length === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Conversation has no messages to draft a reply for.",
        );
      }

      const suggestions = await suggestReplies(req.tenantId!, {
        conversationContext: conversation.messages.map((m) => ({
          direction: m.direction as "INBOUND" | "OUTBOUND",
          content: m.content,
        })),
        contactName: conversation.contact.name,
        businessName: conversation.tenant.name,
      });

      res.json({ success: true, data: { suggestions } });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2: AI Sentiment Analysis
// ----------------------------------------------------------------------------

const sentimentSchema = z.object({
  conversationId: z.string().cuid(),
});

router.post(
  "/sentiment",
  requireFeature("sentiment"),
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { conversationId } = sentimentSchema.parse(req.body);
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: req.tenantId },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { direction: true, content: true, createdAt: true },
          },
        },
      });
      if (!conversation) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      if (conversation.messages.length === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Conversation has no messages to analyze.",
        );
      }

      // Reverse to chronological order before sending to LLM.
      const ordered = [...conversation.messages].reverse();
      const result = await analyzeSentiment(
        req.tenantId!,
        ordered.map((m) => ({
          direction: m.direction as "INBOUND" | "OUTBOUND",
          content: m.content,
        })),
      );

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2 FLAGSHIP: AI Campaign Autopilot
// ----------------------------------------------------------------------------

const autopilotSchema = z.object({
  goal: z.string().min(5).max(600),
  businessType: z.string().max(80).optional(),
});

router.post(
  "/autopilot/campaign",
  requireFeature("autopilot"),
  requirePermission(Permissions.CAMPAIGN_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { goal, businessType } = autopilotSchema.parse(req.body);
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { name: true },
      });
      if (!tenant) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
      }
      const tags = await listTenantTags(req.tenantId!);

      const draft = await planCampaignAutopilot(req.tenantId!, {
        goal,
        businessName: tenant.name,
        businessType,
        availableTags: tags,
      });

      // Estimate audience size against the proposed filter.
      const where = specToWhere(req.tenantId!, draft.audienceFilter);
      const audienceSize = await prisma.contact.count({ where });

      res.json({
        success: true,
        data: { ...draft, estimatedAudienceSize: audienceSize },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// V2 FLAGSHIP: Launch an AI-drafted campaign — closes the autopilot loop.
// Creates a draft WhatsApp template + a SCHEDULED Campaign in one atomic step.
// ----------------------------------------------------------------------------

const launchSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().max(600).optional(),
  bodyText: z.string().min(1).max(1024),
  audienceFilter: z.object({
    reasoning: z.string().optional(),
    tagsAny: z.array(z.string()).optional(),
    tagsAll: z.array(z.string()).optional(),
    optedOut: z.boolean().optional(),
    inactiveSinceDays: z.number().int().positive().optional(),
    interactedWithinDays: z.number().int().positive().optional(),
    aiScoreGte: z.number().min(0).max(1).optional(),
    aiScoreLte: z.number().min(0).max(1).optional(),
    hasEmail: z.boolean().optional(),
  }),
  scheduledFor: z.string().datetime().optional(),
  category: z.enum(["MARKETING", "OTP", "ACCOUNT_UPDATE"]).default("MARKETING"),
  language: z.string().min(2).max(10).default("en_US"),
  followUpSequence: z
    .array(
      z.object({
        delayHours: z.number().int().positive().max(24 * 30), // up to 30 days
        message: z.string().min(1).max(1024),
      }),
    )
    .max(5)
    .optional(),
});

router.post(
  "/autopilot/launch",
  requireFeature("autopilot"),
  requirePermission(Permissions.CAMPAIGN_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = launchSchema.parse(req.body);

      // Filter must match at least one contact, otherwise refuse.
      const where = specToWhere(req.tenantId!, body.audienceFilter);
      const audienceSize = await prisma.contact.count({
        where: { ...where, optedOut: false },
      });
      if (audienceSize === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Audience is empty after filtering opted-out contacts. Broaden your segment.",
        );
      }

      // Build a deterministic template name from the campaign name.
      const slug = body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 90);
      const templateName = `autopilot_${slug}_${Date.now().toString(36)}`;

      const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
      const status = scheduledFor ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT;

      const sendAnchor = scheduledFor ?? new Date();

      const result = await prisma.$transaction(async (tx) => {
        const template = await tx.whatsAppTemplate.create({
          data: {
            tenantId: req.tenantId!,
            name: templateName,
            category: body.category,
            language: body.language,
            bodyText: body.bodyText,
            status: TemplateStatus.DRAFT,
            variants: [],
          },
        });
        const campaign = await tx.campaign.create({
          data: {
            tenantId: req.tenantId!,
            name: body.name,
            description: body.goal,
            type: CampaignType.BROADCAST,
            status,
            templateId: template.id,
            targetContacts: JSON.stringify({ filterSpec: body.audienceFilter }),
            scheduledFor,
            totalContacts: audienceSize,
          },
        });

        // Follow-up sequence: one template + one SCHEDULED campaign per step.
        const followUps: Array<{ campaignId: string; scheduledFor: Date }> = [];
        for (const [idx, step] of (body.followUpSequence ?? []).entries()) {
          const stepSendAt = new Date(
            sendAnchor.getTime() + step.delayHours * 60 * 60 * 1000,
          );
          const stepTemplate = await tx.whatsAppTemplate.create({
            data: {
              tenantId: req.tenantId!,
              name: `${templateName}_followup_${idx + 1}`,
              category: body.category,
              language: body.language,
              bodyText: step.message,
              status: TemplateStatus.DRAFT,
              variants: [],
            },
          });
          const stepCampaign = await tx.campaign.create({
            data: {
              tenantId: req.tenantId!,
              name: `${body.name} · follow-up ${idx + 1}`,
              description: `Auto-generated follow-up #${idx + 1} (+${step.delayHours}h)`,
              type: CampaignType.SCHEDULED,
              status: CampaignStatus.SCHEDULED,
              templateId: stepTemplate.id,
              targetContacts: JSON.stringify({ filterSpec: body.audienceFilter }),
              scheduledFor: stepSendAt,
              totalContacts: audienceSize,
            },
          });
          followUps.push({
            campaignId: stepCampaign.id,
            scheduledFor: stepSendAt,
          });
        }

        return { template, campaign, followUps };
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Campaign",
        resourceId: result.campaign.id,
        newValues: {
          name: result.campaign.name,
          status: result.campaign.status,
          source: "autopilot",
          audienceSize,
        },
        ...extractRequestMeta(req),
      });

      res.status(201).json({
        success: true,
        data: {
          campaign: result.campaign,
          template: result.template,
          followUps: result.followUps,
          audienceSize,
          warnings: [
            "All templates are in DRAFT status. Submit them to Meta for approval before any campaign in this sequence can broadcast.",
          ],
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Compliance Firewall (PRD-v2 Sprint 2 slice 1)
// ----------------------------------------------------------------------------

const complianceScopeSchema = z.nativeEnum(ComplianceScope);

const checkSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  scope: complianceScopeSchema,
  refId: z.string().max(64).optional(),
  industry: z.string().trim().max(120).optional(),
  audienceDescription: z.string().trim().max(400).optional(),
});

router.post(
  "/compliance-check",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = checkSchema.parse(req.body);
      const result = await runComplianceCheck({
        tenantId: req.tenantId!,
        userId: req.userId,
        scope: body.scope,
        refId: body.refId,
        content: body.content,
        industry: body.industry,
        audienceDescription: body.audienceDescription,
      });
      // Audit the check itself so an audit trail exists even when no
      // send follows (preview-only).
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "COMPLIANCE_CHECK",
        resource: "ComplianceCheck",
        resourceId: result.id,
        newValues: { verdict: result.verdict, score: result.score },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/compliance-checks",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query.limit ?? 100);
      const rows = await listRecentChecks(
        req.tenantId!,
        Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

const overrideSchema = z.object({
  reason: z.string().trim().min(3).max(400),
});

router.post(
  "/compliance-checks/:id/override",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = overrideSchema.parse(req.body);
      const updated = await recordOverride({
        tenantId: req.tenantId!,
        checkId: req.params.id,
        userId: req.userId!,
        reason: body.reason,
      });
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
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
