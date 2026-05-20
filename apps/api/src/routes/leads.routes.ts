import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, LeadStatus, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { emitWebhookEvent } from "../services/webhook.service";
import { dispatchFlowTriggers } from "../services/flow/flowTrigger.service";
import { requireFeature } from "../services/features.service";
import { recommendLeadFollowUp } from "../services/ai.service";
import { sendLeadFollowUp } from "../services/leadFollowUp.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const createSchema = z.object({
  contactId: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  value: z.number().nonnegative().optional(),
  assigneeId: z.string().cuid().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  value: z.number().nonnegative().nullable().optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  probability: z.number().min(0).max(1).nullable().optional(),
});

const recommendFollowUpSchema = z.object({
  goal: z.string().trim().min(3).max(300).optional(),
});

const followUpStatusSchema = z.enum([
  "RECOMMENDED",
  "SCHEDULED",
  "SENT",
  "DISMISSED",
  "FAILED",
]);

const updateFollowUpSchema = z.object({
  followUpStatus: followUpStatusSchema.optional(),
  followUpDueAt: z.coerce.date().nullable().optional(),
  followUpMessage: z.string().trim().min(1).max(1000).nullable().optional(),
});

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((a.getTime() - b.getTime()) / 86_400_000));
}

// GET /leads — Kanban view, grouped by status
router.get("/", requirePermission(Permissions.CONTACT_READ), async (req: RequestWithAuth, res, next) => {
  try {
    const where: { tenantId: string; assigneeId?: string } = { tenantId: req.tenantId! };
    if (req.userRole === "AGENT") {
      where.assigneeId = req.userId!;
    }
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { contact: true, assignee: { select: { id: true, name: true } } },
    });
    const grouped: Record<LeadStatus, typeof leads> = {
      [LeadStatus.NEW]: [],
      [LeadStatus.QUALIFIED]: [],
      [LeadStatus.NEGOTIATION]: [],
      [LeadStatus.PROPOSAL_SENT]: [],
      [LeadStatus.NEGOTIATION_FAILED]: [],
      [LeadStatus.CLOSED_WON]: [],
      [LeadStatus.CLOSED_LOST]: [],
    };
    for (const lead of leads) {
      grouped[lead.status as LeadStatus].push(lead);
    }
    res.json({ success: true, data: grouped });
  } catch (err) {
    next(err);
  }
});

// POST /leads
router.post("/", requirePermission(Permissions.LEAD_UPDATE), async (req: RequestWithAuth, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, tenantId: req.tenantId },
    });
    if (!contact) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
    }

    const lead = await prisma.lead.create({
      data: {
        tenantId: req.tenantId!,
        contactId: contact.id,
        title: body.title,
        description: body.description,
        value: body.value,
        assigneeId: body.assigneeId,
        status: LeadStatus.NEW,
      },
      include: { contact: true },
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "Lead",
      resourceId: lead.id,
      newValues: { title: lead.title, status: lead.status },
      ...extractRequestMeta(req),
    });
    void emitWebhookEvent(req.tenantId!, "LEAD_CREATED", {
      leadId: lead.id,
      contactId: lead.contactId,
      title: lead.title,
      value: lead.value,
    });
    void dispatchFlowTriggers({
      tenantId: req.tenantId!,
      trigger: "lead_created",
      contactId: lead.contactId,
      initialVars: { leadId: lead.id, leadTitle: lead.title },
    });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:id/follow-up/recommend — AI/reasoned next-best-action for a lead
router.post(
  "/:id/follow-up/recommend",
  requireFeature("followUpRecommendations"),
  requirePermission(Permissions.LEAD_UPDATE),
  async (req: RequestWithAuth, res, next) => {
    try {
      const body = recommendFollowUpSchema.parse(req.body);
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: {
          contact: true,
          assignee: { select: { id: true, name: true } },
        },
      });
      if (!lead) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
      }

      const [tenant, conversation] = await prisma.$transaction([
        prisma.tenant.findUnique({
          where: { id: req.tenantId! },
          select: { name: true },
        }),
        prisma.conversation.findFirst({
          where: { tenantId: req.tenantId, contactId: lead.contactId },
          orderBy: { lastMessageAt: "desc" },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: { direction: true, content: true, createdAt: true },
            },
          },
        }),
      ]);

      const now = new Date();
      const recommendation = await recommendLeadFollowUp(req.tenantId!, {
        businessName: tenant?.name ?? "the business",
        leadTitle: lead.title,
        leadDescription: lead.description,
        leadStatus: lead.status,
        leadValue: lead.value,
        leadProbability: lead.probability,
        contactName: lead.contact.name,
        contactTags: lead.contact.tags,
        contactOptedOut: lead.contact.optedOut,
        daysSinceLeadUpdated: daysBetween(now, lead.updatedAt),
        daysSinceLastInteraction: lead.contact.lastInteractionAt
          ? daysBetween(now, lead.contact.lastInteractionAt)
          : null,
        recentMessages:
          conversation?.messages
            .slice()
            .reverse()
            .map((m) => ({
              direction: m.direction,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            })) ?? [],
        goal: body.goal,
      });

      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpStatus: "RECOMMENDED",
          followUpPriority: recommendation.priority,
          followUpMessage: recommendation.message,
          followUpReason: recommendation.reasoning,
          followUpDueAt: new Date(recommendation.dueAt),
          followUpRecommendedAt: now,
          followUpLastError: null,
        },
        include: {
          contact: true,
          assignee: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Lead",
        resourceId: updated.id,
        oldValues: {
          followUpStatus: lead.followUpStatus,
          followUpDueAt: lead.followUpDueAt,
        },
        newValues: {
          followUpStatus: updated.followUpStatus,
          followUpPriority: updated.followUpPriority,
          followUpDueAt: updated.followUpDueAt,
        },
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: { lead: updated, recommendation } });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /leads/:id/follow-up — schedule, edit, or dismiss a recommendation
router.patch(
  "/:id/follow-up",
  requireFeature("followUpRecommendations"),
  requirePermission(Permissions.LEAD_UPDATE),
  async (req: RequestWithAuth, res, next) => {
    try {
      const body = updateFollowUpSchema.parse(req.body);
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!lead) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
      }
      if (body.followUpStatus === "SCHEDULED") {
        const message = body.followUpMessage ?? lead.followUpMessage;
        const dueAt = body.followUpDueAt ?? lead.followUpDueAt;
        if (!message || !dueAt) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            400,
            "A scheduled follow-up needs a message and due date.",
          );
        }
      }

      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpStatus: body.followUpStatus,
          followUpDueAt: body.followUpDueAt,
          followUpMessage: body.followUpMessage,
          followUpLastError:
            body.followUpStatus === "SCHEDULED" ||
            body.followUpStatus === "RECOMMENDED"
              ? null
              : undefined,
        },
        include: {
          contact: true,
          assignee: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "LeadFollowUp",
        resourceId: updated.id,
        oldValues: {
          followUpStatus: lead.followUpStatus,
          followUpDueAt: lead.followUpDueAt,
        },
        newValues: body,
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /leads/:id/follow-up/send — send the current follow-up immediately
router.post(
  "/:id/follow-up/send",
  requireFeature("followUpRecommendations"),
  requirePermission(Permissions.LEAD_UPDATE),
  async (req: RequestWithAuth, res, next) => {
    try {
      const result = await sendLeadFollowUp(req.params.id, req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "LeadFollowUpMessage",
        resourceId: req.params.id,
        newValues: { sent: true },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /leads/:id — drag-drop status change or update fields
router.patch("/:id", requirePermission(Permissions.LEAD_UPDATE), async (req: RequestWithAuth, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.lead.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
    }

    const closingNow =
      body.status === LeadStatus.CLOSED_WON || body.status === LeadStatus.CLOSED_LOST;

    const updated = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...body,
        closedAt: closingNow ? new Date() : undefined,
        closedWonAt: body.status === LeadStatus.CLOSED_WON ? new Date() : undefined,
      },
      include: { contact: true },
    });

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Lead",
      resourceId: updated.id,
      oldValues: { status: existing.status, assigneeId: existing.assigneeId },
      newValues: body,
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
