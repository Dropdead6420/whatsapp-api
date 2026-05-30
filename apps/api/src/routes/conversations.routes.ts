import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma, prismaRead } from "@nexaflow/db";
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
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";
import { emitToConversation, emitToTenant } from "../lib/realtime";
import { emitWebhookEvent } from "../services/webhook.service";
import { enforceCompliance } from "../services/compliance.service";
import { ComplianceScope } from "@nexaflow/db";

const router = Router();
router.use(requireAuth, requireTenantScope);

const listSchema = z.object({
  // page is retained for backwards compatibility; cursor takes precedence.
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Cursor-based pagination (T-102). Opaque base64 token returned in
  // `nextCursor` on the previous page.
  cursor: z.string().min(1).max(128).optional(),
  assignedToMe: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  label: z.string().trim().min(1).max(40).optional(),
  slaBreached: z.coerce.boolean().optional(),
});

interface ConversationCursor {
  lastMessageAt: string | null;
  id: string;
}

function encodeCursor(c: ConversationCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): ConversationCursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as ConversationCursor;
    if (typeof parsed.id !== "string") return null;
    if (
      parsed.lastMessageAt !== null &&
      typeof parsed.lastMessageAt !== "string"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

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
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp access token failed to decrypt.",
    );
  }
  return {
    phoneNumberId: tenant.wabaPhoneNumber,
    accessToken,
  };
}

router.get(
  "/",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const where: Record<string, unknown> = { tenantId: req.tenantId };
      if (q.assignedToMe || req.userRole === "AGENT") where.agentId = req.userId;
      if (typeof q.isActive === "boolean") where.isActive = q.isActive;
      if (q.label) where.labels = { has: q.label };
      if (q.slaBreached === true) where.slaBreachedAt = { not: null };
      if (q.slaBreached === false) where.slaBreachedAt = null;

      // Cursor pagination (T-102). The composite (lastMessageAt, id) cursor
      // tolerates ties when many conversations share the same millisecond
      // timestamp — keyset pagination stays correct.
      const useCursor = typeof q.cursor === "string";
      const cursor = useCursor ? decodeCursor(q.cursor!) : null;
      if (useCursor && !cursor) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Invalid pagination cursor.",
        );
      }
      if (cursor) {
        // (lastMessageAt, id) strictly less than the cursor. Schema default
        // for Conversation.lastMessageAt is now(), so the column is never
        // null in practice — but treat a null cursor defensively as "any
        // row strictly older than now()" so we can never return identical
        // rows across pages.
        const lastMessageAt = cursor.lastMessageAt
          ? new Date(cursor.lastMessageAt)
          : new Date();
        where.OR = [
          { lastMessageAt: { lt: lastMessageAt } },
          { lastMessageAt, id: { lt: cursor.id } },
        ];
      }

      const take = q.limit + 1; // fetch one extra to know if there's a next page
      const items = await prismaRead.conversation.findMany({
        where,
        ...(useCursor ? {} : { skip: (q.page - 1) * q.limit }),
        take,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        include: {
          contact: true,
          agent: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const hasMore = items.length > q.limit;
      const page = hasMore ? items.slice(0, q.limit) : items;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              lastMessageAt: last.lastMessageAt
                ? last.lastMessageAt.toISOString()
                : null,
              id: last.id,
            })
          : null;

      if (useCursor) {
        res.json({
          success: true,
          data: page,
          pagination: { limit: q.limit, nextCursor, hasMore },
        });
        return;
      }

      // Legacy offset response — kept for backwards compat. Count is
      // intentionally O(filtered rows); the cursor form skips it.
      const total = await prismaRead.conversation.count({ where });
      res.json({
        success: true,
        data: page,
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / q.limit)),
          nextCursor,
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
// POST /conversations/:id/messages — send a reply via WhatsApp from inside an
// existing conversation. Mirrors /whatsapp/send-text but uses the
// conversation's contact (so the mobile app can post just `{body}`) and is
// gated by CONVERSATION_REPLY so the AGENT role can actually use it from
// their phone. The realtime + webhook emission stays consistent with the
// existing send paths.
// ----------------------------------------------------------------------------

const replyTextSchema = z.object({ body: z.string().min(1).max(4096) });

router.post(
  "/:id/messages",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { body } = replyTextSchema.parse(req.body);

      const convo = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: {
          contact: {
            select: { id: true, phoneNumber: true, optedOut: true },
          },
        },
      });
      if (!convo) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "Conversation not found.",
        );
      }
      if (convo.contact.optedOut) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Contact has opted out; cannot reply.",
        );
      }

      // Compliance Firewall — heuristics-only on this hot path; the LLM
      // round-trip on every agent reply would be cost-prohibitive. Hard
      // violations still hard-block (BLOCK verdict enforced under
      // ASSISTED + AUTOPILOT modes).
      await enforceCompliance({
        tenantId: req.tenantId!,
        userId: req.userId,
        scope: ComplianceScope.REPLY,
        refId: convo.id,
        content: body,
        heuristicsOnly: true,
      });

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
      });
      if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "WhatsApp Business API is not configured for this tenant.",
        );
      }
      const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
      if (!accessToken) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "WhatsApp access token failed to decrypt.",
        );
      }

      // Gate checks before we mutate Meta state.
      await assertCanAffordMessage(req.tenantId!);
      await assertCanSend(req.tenantId!, {
        phoneNumberId: tenant.wabaPhoneNumber,
      });

      const metaMessageId = await sendWhatsAppText({
        tenantId: req.tenantId!,
        phoneNumberId: tenant.wabaPhoneNumber,
        accessToken,
        to: convo.contact.phoneNumber.replace(/^\+/, ""),
        body,
      });
      await recordSend(req.tenantId!, {
        phoneNumberId: tenant.wabaPhoneNumber,
      });
      await debitMessage(req.tenantId!, metaMessageId, {
        actorUserId: req.userId,
        reason: `Conversation reply ${convo.id}`,
      });

      const message = await prisma.message.create({
        data: {
          conversationId: convo.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: body,
          metaMessageId,
        },
      });
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { lastMessageAt: message.createdAt, isActive: true },
      });

      // Best-effort realtime broadcast so other open clients (web + future
      // socket-connected mobile) see the message appear instantly.
      try {
        emitToConversation(req.tenantId!, convo.id, "message:sent", {
          conversationId: convo.id,
          message,
        });
      } catch {
        // Realtime is best-effort; the message is already persisted.
      }

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Message",
        resourceId: message.id,
        newValues: { conversationId: convo.id, metaMessageId },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: message });
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
      const config = await getTenantWabaConfig(req.tenantId!);
      await assertCanSend(req.tenantId!, { phoneNumberId: config.phoneNumberId });
      const metaMessageId = await sendWhatsAppText({
        tenantId: req.tenantId!,
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        to: conversation.contact.phoneNumber.replace(/^\+/, ""),
        body: body.body,
      });
      await recordSend(req.tenantId!, { phoneNumberId: config.phoneNumberId });
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

      const messageEnvelope = {
        conversationId: conversation.id,
        messageId: message.id,
        contactId: conversation.contactId,
        content: body.body,
        agentId: req.userId,
        createdAt: message.createdAt.toISOString(),
      };
      emitToConversation(
        req.tenantId!,
        conversation.id,
        "message:sent",
        messageEnvelope,
      );
      emitToTenant(req.tenantId!, "conversation:updated", {
        conversationId: conversation.id,
        lastMessageAt: now.toISOString(),
        lastOutboundAt: now.toISOString(),
        agentId: updated.agentId,
      });
      void emitWebhookEvent(req.tenantId!, "MESSAGE_SENT", messageEnvelope);

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
