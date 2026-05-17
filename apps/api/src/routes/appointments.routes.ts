import { Router, Request, Response, NextFunction } from "express";
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
import { emitWebhookEvent } from "../services/webhook.service";
import { requireFeature } from "../services/features.service";

// ============================================================================
// PUBLIC booking router — mounted at /public/booking (no auth)
// ============================================================================

export const publicBookingRouter = Router();

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, "Phone number must be E.164 (e.g. +919876543210)");

const publicBookingSchema = z.object({
  serviceId: z.string().cuid(),
  scheduledAt: z.string().datetime(),
  name: z.string().min(1).max(120),
  phoneNumber: phoneSchema,
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});

// GET /public/booking/:tenantId — returns tenant info + active services
publicBookingRouter.get(
  "/:tenantId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.params.tenantId;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          status: true,
          logoUrl: true,
          brandColors: true,
        },
      });
      if (!tenant || tenant.status !== "ACTIVE") {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "This booking page is not available.",
        );
      }
      const services = await prisma.service.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          durationMinutes: true,
          priceInPaisa: true,
        },
      });
      res.json({ success: true, data: { tenant, services } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /public/booking/:tenantId — create a booking, no auth
publicBookingRouter.post(
  "/:tenantId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.params.tenantId;
      const body = publicBookingSchema.parse(req.body);

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, status: true },
      });
      if (!tenant || tenant.status !== "ACTIVE") {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "This booking page is not available.",
        );
      }

      const service = await prisma.service.findFirst({
        where: { id: body.serviceId, tenantId, isActive: true },
      });
      if (!service) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "Service not found or not available.",
        );
      }

      const scheduledAt = new Date(body.scheduledAt);
      if (scheduledAt.getTime() < Date.now() - 60_000) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Cannot book in the past.",
        );
      }
      if (scheduledAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Booking too far in the future (max 1 year).",
        );
      }

      // Upsert contact by phone — capture name/email even on existing contacts.
      const contact = await prisma.contact.upsert({
        where: {
          tenantId_phoneNumber: { tenantId, phoneNumber: body.phoneNumber },
        },
        update: {
          // Only fill in missing fields; never overwrite existing data.
          email: body.email ?? undefined,
          lastInteractionAt: new Date(),
        },
        create: {
          tenantId,
          phoneNumber: body.phoneNumber,
          name: body.name,
          email: body.email,
          tags: ["booking"],
          lastInteractionAt: new Date(),
        },
      });

      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          contactId: contact.id,
          serviceId: service.id,
          scheduledAt,
          durationMinutes: service.durationMinutes,
          status: "PENDING",
          notes: body.notes,
          source: "PUBLIC_FORM",
        },
      });

      void emitWebhookEvent(tenantId, "APPOINTMENT_BOOKED", {
        appointmentId: appointment.id,
        contactId: contact.id,
        serviceId: service.id,
        serviceName: service.name,
        scheduledAt: appointment.scheduledAt.toISOString(),
        source: "PUBLIC_FORM",
      });

      res.status(201).json({
        success: true,
        data: {
          id: appointment.id,
          scheduledAt: appointment.scheduledAt,
          status: appointment.status,
          serviceName: service.name,
          message:
            "Booking received. You'll get a WhatsApp confirmation once the business confirms.",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// AUTHENTICATED router — mounted at /api/v1/appointments
// ============================================================================

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("appointments"));

const listQuerySchema = z.object({
  status: z
    .enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z.object({
  contactId: z.string().cuid(),
  serviceId: z.string().cuid(),
  scheduledAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  status: z
    .enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"])
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.get(
  "/",
  requirePermission(Permissions.CONTACT_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const where: Record<string, unknown> = { tenantId: req.tenantId };
      if (q.status) where.status = q.status;
      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) range.gte = new Date(q.from);
        if (q.to) range.lte = new Date(q.to);
        where.scheduledAt = range;
      }

      const [total, items] = await prisma.$transaction([
        prisma.appointment.count({ where }),
        prisma.appointment.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { scheduledAt: "asc" },
          include: {
            contact: { select: { id: true, name: true, phoneNumber: true } },
            service: { select: { id: true, name: true, priceInPaisa: true } },
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

router.post(
  "/",
  requirePermission(Permissions.CONTACT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const [contact, service] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: body.contactId, tenantId: req.tenantId },
        }),
        prisma.service.findFirst({
          where: { id: body.serviceId, tenantId: req.tenantId, isActive: true },
        }),
      ]);
      if (!contact) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }
      if (!service) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Service not found.");
      }

      const created = await prisma.appointment.create({
        data: {
          tenantId: req.tenantId!,
          contactId: contact.id,
          serviceId: service.id,
          scheduledAt: new Date(body.scheduledAt),
          durationMinutes: service.durationMinutes,
          notes: body.notes,
          status: "CONFIRMED", // admin-created appointments default to confirmed
          source: "ADMIN",
        },
        include: {
          contact: { select: { id: true, name: true, phoneNumber: true } },
          service: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Appointment",
        resourceId: created.id,
        newValues: { scheduledAt: created.scheduledAt, serviceId: service.id },
        ...extractRequestMeta(req),
      });

      void emitWebhookEvent(req.tenantId!, "APPOINTMENT_BOOKED", {
        appointmentId: created.id,
        contactId: created.contactId,
        serviceId: service.id,
        serviceName: service.name,
        scheduledAt: created.scheduledAt.toISOString(),
        source: "ADMIN",
      });

      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  requirePermission(Permissions.CONTACT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const existing = await prisma.appointment.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Appointment not found.");
      }

      const data: Record<string, unknown> = { ...body };
      if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt);
      if (body.status === "CANCELLED" && existing.status !== "CANCELLED") {
        data.cancelledAt = new Date();
      }
      if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
        data.completedAt = new Date();
      }
      if (body.status === "CONFIRMED" && existing.status === "PENDING") {
        data.confirmationSentAt = null; // worker will send confirmation
      }

      const updated = await prisma.appointment.update({
        where: { id: existing.id },
        data,
        include: {
          contact: { select: { id: true, name: true, phoneNumber: true } },
          service: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Appointment",
        resourceId: updated.id,
        oldValues: { status: existing.status, scheduledAt: existing.scheduledAt },
        newValues: body,
        ...extractRequestMeta(req),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
