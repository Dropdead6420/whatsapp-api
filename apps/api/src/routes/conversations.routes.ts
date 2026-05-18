import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  MessageDirection,
  MessageStatus,
  Permissions,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { sendWhatsAppText } from "../services/whatsapp.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { assertCanSend, recordSend } from "../services/sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "../services/billing.service";
import { emitWebhookEvent } from "../services/webhook.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  assignedToMe: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  label: z.string().trim().min(1).max(40).optional(),
  slaBreached: z.coerce.boolean().optional(),
});

const replySchema = z.object({
  body: z.string().min(1).max(4096),
});

async function getTenantWabaConfig(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp Business API is not configured for this tenant.",
    );
  }
  return {
    phoneNumberId: tenant.wabaPhoneNumber,
    accessToken: tenant.wabaAccessToken,
  };
}

router.get(
  "/",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const where: Record<string, unknown> = { tenantId: req.tenantId };
      if (q.assignedToMe) where.agentId = req.userId;
      if (typeof q.isActive === "boolean") where.isActive = q.isActive;
      if (q.label) where.labels = { has: q.label };
      if (q.slaBreached === true) where.slaBreachedAt = { not: null };
      if (q.slaBreached === false) where.slaBreachedAt = null;

      const [total, items] = await prisma.$transaction([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { lastMessageAt: "desc" },
          include: {
            contact: true,
            agent: { select: { id: true, name: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        }),
      ]);

      res.json({
        success: true,
        data: items,
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / q.limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: {
          contact: true,
          agent: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: "asc" }, take: 200 },
        },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      res.json({ success: true, data: convo });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Internal notes (sub-resource of conversation)
// ----------------------------------------------------------------------------

const noteSchema = z.object({ body: z.string().min(1).max(2000) });

router.get(
  "/:id/notes",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      const notes = await prisma.conversationNote.findMany({
        where: { conversationId: convo.id, tenantId: req.tenantId },
        orderBy: { createdAt: "desc" },
      });
      const authorIds = [...new Set(notes.map((n) => n.authorId))];
      const authors = await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      });
      const authorMap = new Map(authors.map((a) => [a.id, a.name]));
      res.json({
        success: true,
        data: notes.map((n) => ({ ...n, authorName: authorMap.get(n.authorId) ?? "Unknown" })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/notes",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { body } = noteSchema.parse(req.body);
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      const note = await prisma.conversationNote.create({
        data: {
          tenantId: req.tenantId!,
          conversationId: convo.id,
          authorId: req.userId!,
          body,
        },
      });
      res.status(201).json({ success: true, data: note });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id/notes/:noteId",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const note = await prisma.conversationNote.findFirst({
        where: {
          id: req.params.noteId,
          conversationId: req.params.id,
          tenantId: req.tenantId,
        },
      });
      if (!note) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Note not found.");
      }
      await prisma.conversationNote.delete({ where: { id: note.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/assign",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ agentId: z.string().cuid().nullable() }).parse(req.body);
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      const updated = await prisma.conversation.update({
        where: { id: convo.id },
        data: { agentId: body.agentId },
      });
      if (body.agentId && body.agentId !== convo.agentId) {
        void emitWebhookEvent(req.tenantId!, "CONVERSATION_ASSIGNED", {
          conversationId: updated.id,
          agentId: body.agentId,
          previousAgentId: convo.agentId,
        });
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// Conversation labels (V2 §3.3.5: Urgent, Follow-up, Closed, …)
// --------------------------------------------------------------------------

const labelSchema = z.object({
  label: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i, "Label may only contain letters, digits, -, _"),
});

router.post(
  "/:id/labels",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { label } = labelSchema.parse(req.body);
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      if (convo.labels.includes(label)) {
        res.json({ success: true, data: convo });
        return;
      }
      const updated = await prisma.conversation.update({
        where: { id: convo.id },
        data: { labels: [...convo.labels, label] },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id/labels/:label",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const label = req.params.label.trim();
      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!convo) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      const next = convo.labels.filter((l) => l !== label);
      const updated = await prisma.conversation.update({
        where: { id: convo.id },
        data: { labels: next },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/reply",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = replySchema.parse(req.body);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: { contact: true },
      });
      if (!conversation) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }
      if (conversation.contact.optedOut) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "This contact has opted out of WhatsApp messages.",
        );
      }

      await assertCanAffordMessage(req.tenantId!);
      await assertCanSend(req.tenantId!);
      const config = await getTenantWabaConfig(req.tenantId!);
      const metaMessageId = await sendWhatsAppText({
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        to: conversation.contact.phoneNumber.replace(/^\+/, ""),
        body: body.body,
      });
      await recordSend(req.tenantId!);
      await debitMessage(req.tenantId!, metaMessageId, {
        actorUserId: req.userId,
        reason: "Inbox reply",
      });

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: body.body,
          metaMessageId,
        },
      });

      // Compute first-response duration once, on the conversation's first
      // outbound after an inbound. Once stamped we never overwrite it.
      const now = new Date();
      const firstResponseSeconds =
        conversation.firstResponseSeconds === null && conversation.lastInboundAt
          ? Math.max(
              0,
              Math.round(
                (now.getTime() - conversation.lastInboundAt.getTime()) / 1000,
              ),
            )
          : undefined;

      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          agentId: conversation.agentId ?? req.userId,
          lastMessageAt: now,
          lastOutboundAt: now,
          // Replying clears any SLA breach for this inbound cycle.
          slaBreachedAt: null,
          ...(firstResponseSeconds !== undefined ? { firstResponseSeconds } : {}),
        },
        include: {
          contact: true,
          agent: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Message",
        resourceId: message.id,
        newValues: { conversationId: conversation.id, direction: "OUTBOUND" },
        ...extractRequestMeta(req),
      });

      void emitWebhookEvent(req.tenantId!, "MESSAGE_SENT", {
        conversationId: conversation.id,
        messageId: message.id,
        contactId: conversation.contactId,
        content: body.body,
        agentId: req.userId,
      });

      res.json({
        success: true,
        data: { conversation: updated, message, metaMessageId },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
