import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  cancelEnrollment,
  createDripSequence,
  createDripSequenceSchema,
  enrollContact,
  getDripSequence,
  listDripSequences,
  listEnrollments,
  updateDripSequence,
  updateDripSequenceSchema,
} from "../services/dripSequence.service";

const router = Router();

router.use(
  requireAuth,
  requireTenantScope,
  requirePermission(Permissions.DRIP_SEQUENCE_MANAGE),
);

// ----------------------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------------------

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const data = await listDripSequences(req.tenantId!);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createDripSequenceSchema.parse(req.body);
      const sequence = await createDripSequence(req.tenantId!, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "DripSequence",
        resourceId: sequence.id,
        newValues: { name: sequence.name, trigger: sequence.trigger },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: sequence });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const data = await getDripSequence(req.tenantId!, req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateDripSequenceSchema.parse(req.body);
      const updated = await updateDripSequence(
        req.tenantId!,
        req.params.id,
        body,
      );
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "DripSequence",
        resourceId: updated.id,
        newValues: {
          ...(body.status !== undefined && { status: body.status }),
          ...(body.name !== undefined && { name: body.name }),
          ...(body.trigger !== undefined && { trigger: body.trigger }),
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// Enrollments
// ----------------------------------------------------------------------------

const enrollSchema = z.object({
  contactId: z.string().cuid(),
});

router.post(
  "/:id/enrollments",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = enrollSchema.parse(req.body);
      const enrollment = await enrollContact({
        tenantId: req.tenantId!,
        sequenceId: req.params.id,
        contactId: body.contactId,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "DripEnrollment",
        resourceId: enrollment.id,
        newValues: { sequenceId: req.params.id, contactId: body.contactId },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: enrollment });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id/enrollments",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const data = await listEnrollments({
        tenantId: req.tenantId!,
        sequenceId: req.params.id,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/enrollments/:enrollmentId",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const updated = await cancelEnrollment({
        tenantId: req.tenantId!,
        enrollmentId: req.params.enrollmentId,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "DripEnrollment",
        resourceId: updated.id,
        newValues: { status: "CANCELLED" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
