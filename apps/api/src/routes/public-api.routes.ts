import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, LeadStatus } from "@nexaflow/shared";
import {
  requireApiKey,
  RequestWithApiKey,
} from "../middleware/apiKeyAuth";
import { emitWebhookEvent } from "../services/webhook.service";
import { dispatchFlowTriggers } from "../services/flow/flowTrigger.service";

const router = Router();

router.use(requireApiKey);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, "Phone number must be E.164 (e.g. +919876543210)");

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const contactListSchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(80).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  optedOut: z.coerce.boolean().optional(),
});

const lifecycleStages = [
  "LEAD",
  "PROSPECT",
  "CUSTOMER",
  "REPEAT_CUSTOMER",
  "VIP",
  "CHURNED",
] as const;

const contactCreateSchema = z.object({
  phoneNumber: phoneSchema,
  name: z.string().trim().min(1).max(120),
  email: z.string().email().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  customFields: z.record(z.unknown()).optional(),
});

const contactUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
  optedOut: z.boolean().optional(),
  lifecycleStage: z.enum(lifecycleStages).optional(),
});

const leadListSchema = paginationSchema.extend({
  status: z.nativeEnum(LeadStatus).optional(),
  contactId: z.string().cuid().optional(),
});

const leadCreateSchema = z.object({
  contactId: z.string().cuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  value: z.number().nonnegative().optional(),
  probability: z.number().min(0).max(1).optional(),
});

const leadUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  value: z.number().nonnegative().nullable().optional(),
  probability: z.number().min(0).max(1).nullable().optional(),
});

const conversationListSchema = paginationSchema.extend({
  contactId: z.string().cuid().optional(),
  active: z.coerce.boolean().optional(),
});

function pagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

router.get(
  "/status",
  (req: RequestWithApiKey, res: Response, _next: NextFunction) => {
    res.json({
      success: true,
      data: {
        ok: true,
        tenantId: req.tenantId,
        apiKeyId: req.apiKeyId,
        apiKeyName: req.apiKeyName,
        timestamp: new Date().toISOString(),
      },
    });
  },
);

router.get(
  "/contacts",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const q = contactListSchema.parse(req.query);
      const where: Record<string, unknown> = { tenantId: req.tenantId! };
      if (q.search) {
        where.OR = [
          { name: { contains: q.search, mode: "insensitive" } },
          { phoneNumber: { contains: q.search } },
          { email: { contains: q.search, mode: "insensitive" } },
        ];
      }
      if (q.tag) where.tags = { has: q.tag };
      if (typeof q.optedOut === "boolean") where.optedOut = q.optedOut;

      const [total, items] = await prisma.$transaction([
        prisma.contact.count({ where }),
        prisma.contact.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      res.json({
        success: true,
        data: items,
        pagination: pagination(q.page, q.limit, total),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/contacts",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const body = contactCreateSchema.parse(req.body);
      const existing = await prisma.contact.findUnique({
        where: {
          tenantId_phoneNumber: {
            tenantId: req.tenantId!,
            phoneNumber: body.phoneNumber,
          },
        },
      });
      if (existing) {
        throw new ApiError(
          ErrorCodes.CONFLICT,
          409,
          "Contact with this phone number already exists.",
        );
      }

      const contact = await prisma.contact.create({
        data: {
          tenantId: req.tenantId!,
          phoneNumber: body.phoneNumber,
          name: body.name,
          email: body.email,
          tags: body.tags,
          customFields: body.customFields ? JSON.stringify(body.customFields) : null,
        },
      });

      res.status(201).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/contacts/:id",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
        include: {
          leads: { orderBy: { createdAt: "desc" }, take: 10 },
          conversations: { orderBy: { lastMessageAt: "desc" }, take: 5 },
        },
      });
      if (!contact) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }
      res.json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/contacts/:id",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const body = contactUpdateSchema.parse(req.body);
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }

      const contact = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          email: body.email,
          tags: body.tags,
          customFields:
            body.customFields === undefined
              ? undefined
              : body.customFields === null
                ? null
                : JSON.stringify(body.customFields),
          optedOut: body.optedOut,
          optedOutAt:
            body.optedOut === true
              ? new Date()
              : body.optedOut === false
                ? null
                : undefined,
          lifecycleStage: body.lifecycleStage,
        },
      });

      res.json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/leads",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const q = leadListSchema.parse(req.query);
      const where = {
        tenantId: req.tenantId!,
        status: q.status,
        contactId: q.contactId,
      };
      const [total, items] = await prisma.$transaction([
        prisma.lead.count({ where }),
        prisma.lead.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { updatedAt: "desc" },
          include: { contact: true, assignee: { select: { id: true, name: true } } },
        }),
      ]);

      res.json({
        success: true,
        data: items,
        pagination: pagination(q.page, q.limit, total),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/leads",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const body = leadCreateSchema.parse(req.body);
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, tenantId: req.tenantId! },
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
          probability: body.probability,
          status: LeadStatus.NEW,
        },
        include: { contact: true },
      });

      void emitWebhookEvent(req.tenantId!, "LEAD_CREATED", {
        leadId: lead.id,
        contactId: lead.contactId,
        title: lead.title,
        value: lead.value,
        source: "public_api",
      });
      void dispatchFlowTriggers({
        tenantId: req.tenantId!,
        trigger: "lead_created",
        contactId: lead.contactId,
        initialVars: {
          leadId: lead.id,
          leadTitle: lead.title,
          source: "public_api",
        },
      });

      res.status(201).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/leads/:id",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
        include: { contact: true, assignee: { select: { id: true, name: true } } },
      });
      if (!lead) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
      }
      res.json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/leads/:id",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const body = leadUpdateSchema.parse(req.body);
      const existing = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
      }

      const closingNow =
        body.status === LeadStatus.CLOSED_WON || body.status === LeadStatus.CLOSED_LOST;
      const lead = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          title: body.title,
          description: body.description,
          status: body.status,
          value: body.value,
          probability: body.probability,
          closedAt: closingNow ? new Date() : undefined,
          closedWonAt: body.status === LeadStatus.CLOSED_WON ? new Date() : undefined,
        },
        include: { contact: true, assignee: { select: { id: true, name: true } } },
      });

      res.json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/conversations",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const q = conversationListSchema.parse(req.query);
      const where = {
        tenantId: req.tenantId!,
        contactId: q.contactId,
        isActive: q.active,
      };
      const [total, items] = await prisma.$transaction([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
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
        pagination: pagination(q.page, q.limit, total),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/conversations/:id/messages",
  async (req: RequestWithApiKey, res: Response, next: NextFunction) => {
    try {
      const q = paginationSchema.parse(req.query);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
        select: { id: true },
      });
      if (!conversation) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
      }

      const [total, items] = await prisma.$transaction([
        prisma.message.count({ where: { conversationId: conversation.id } }),
        prisma.message.findMany({
          where: { conversationId: conversation.id },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      res.json({
        success: true,
        data: items,
        pagination: pagination(q.page, q.limit, total),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
