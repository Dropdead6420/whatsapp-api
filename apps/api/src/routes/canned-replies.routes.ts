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

const router = Router();
router.use(requireAuth, requireTenantScope);

const shortcutSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^\/[a-z0-9_-]+$/, "Shortcut must start with / and use lowercase letters, digits, _ or -");

const createSchema = z.object({
  shortcut: shortcutSchema,
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(1024),
});

const updateSchema = z.object({
  shortcut: shortcutSchema.optional(),
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(1024).optional(),
});

router.get(
  "/",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, _res: Response, next: NextFunction) => {
    try {
      const items = await prisma.cannedReply.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { shortcut: "asc" },
      });
      _res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const dup = await prisma.cannedReply.findUnique({
        where: {
          tenantId_shortcut: {
            tenantId: req.tenantId!,
            shortcut: body.shortcut,
          },
        },
      });
      if (dup) {
        throw new ApiError(
          ErrorCodes.CONFLICT,
          409,
          `A canned reply with shortcut ${body.shortcut} already exists.`,
        );
      }
      const created = await prisma.cannedReply.create({
        data: { tenantId: req.tenantId!, ...body },
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const existing = await prisma.cannedReply.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Canned reply not found.");
      }
      const updated = await prisma.cannedReply.update({
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
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.cannedReply.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Canned reply not found.");
      }
      await prisma.cannedReply.delete({ where: { id: existing.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
