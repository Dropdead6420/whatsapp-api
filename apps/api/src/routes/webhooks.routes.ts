import crypto from "node:crypto";
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
import { logAudit, extractRequestMeta } from "../services/audit.service";
import { requireFeature } from "../services/features.service";

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("webhooks"));

const EVENT_VALUES = [
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "LEAD_CREATED",
  "CONTACT_TAGGED",
  "CAMPAIGN_COMPLETED",
  "CONVERSATION_ASSIGNED",
  "APPOINTMENT_BOOKED",
] as const;

const createSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(EVENT_VALUES)).min(1).max(EVENT_VALUES.length),
  isActive: z.boolean().default(true),
});

const updateSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.enum(EVENT_VALUES)).min(1).max(EVENT_VALUES.length).optional(),
  isActive: z.boolean().optional(),
});

router.get(
  "/",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const items = await prisma.webhook.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: "desc" },
      });
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/events", (_req, res) => {
  res.json({ success: true, data: EVENT_VALUES });
});

router.post(
  "/",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const secret = crypto.randomBytes(24).toString("hex");
      const created = await prisma.webhook.create({
        data: {
          tenantId: req.tenantId!,
          url: body.url,
          events: body.events,
          isActive: body.isActive,
          secret,
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Webhook",
        resourceId: created.id,
        newValues: { url: created.url, events: created.events },
        ...extractRequestMeta(req),
      });
      // Return the secret ONCE on create; PATCH/list won't expose it.
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const existing = await prisma.webhook.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Webhook not found.");
      }
      const updated = await prisma.webhook.update({
        where: { id: existing.id },
        data: body,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.webhook.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Webhook not found.");
      }
      await prisma.webhook.delete({ where: { id: existing.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id/logs",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.webhook.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Webhook not found.");
      }
      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: existing.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json({ success: true, data: logs });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
