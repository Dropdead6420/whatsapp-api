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
router.use(requireAuth, requireTenantScope, requireFeature("appointments"));

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  durationMinutes: z.number().int().min(5).max(60 * 24),
  priceInPaisa: z.number().int().nonnegative(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

router.get(
  "/",
  requirePermission(Permissions.CONTACT_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const items = await prisma.service.findMany({
        where: { tenantId: req.tenantId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      res.json({ success: true, data: items });
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
      const created = await prisma.service.create({
        data: { tenantId: req.tenantId!, ...body },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Service",
        resourceId: created.id,
        newValues: { name: created.name, durationMinutes: created.durationMinutes },
        ...extractRequestMeta(req),
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
      const existing = await prisma.service.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Service not found.");
      }
      const updated = await prisma.service.update({
        where: { id: existing.id },
        data: body,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Service",
        resourceId: updated.id,
        oldValues: { name: existing.name, priceInPaisa: existing.priceInPaisa },
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id",
  requirePermission(Permissions.CONTACT_DELETE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.service.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Service not found.");
      }
      const upcoming = await prisma.appointment.count({
        where: {
          serviceId: existing.id,
          status: { in: ["PENDING", "CONFIRMED"] },
          scheduledAt: { gte: new Date() },
        },
      });
      if (upcoming > 0) {
        // Soft-disable instead of hard-delete when there are upcoming bookings.
        const updated = await prisma.service.update({
          where: { id: existing.id },
          data: { isActive: false },
        });
        res.json({
          success: true,
          data: updated,
          warning: `Service has ${upcoming} upcoming appointment(s); marked inactive instead of deleted.`,
        });
        return;
      }
      await prisma.service.delete({ where: { id: existing.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
