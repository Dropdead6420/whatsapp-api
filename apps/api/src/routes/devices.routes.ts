import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { DevicePlatform } from "@nexaflow/db";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import {
  listUserDevices,
  registerDevice,
  unregisterDevice,
} from "../services/pushNotification.service";

const router = Router();
// Tenant scope intentionally loose — a user with no current tenant (rare
// signup-but-not-confirmed state) can still register their device, the
// fanout just won't reach them until they pick one. requireAuth is the
// non-negotiable.
router.use(requireAuth, requireTenantScope);

const registerSchema = z.object({
  fcmToken: z.string().trim().min(20).max(4096),
  platform: z
    .enum([DevicePlatform.ANDROID, DevicePlatform.IOS, DevicePlatform.WEB])
    .optional(),
  label: z.string().trim().max(120).optional(),
});

router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = registerSchema.parse(req.body);
      const device = await registerDevice({
        userId: req.userId!,
        tenantId: req.tenantId ?? null,
        fcmToken: body.fcmToken,
        platform: body.platform,
        label: body.label,
      });
      res.status(201).json({
        success: true,
        data: {
          id: device.id,
          platform: device.platform,
          label: device.label,
          lastSeenAt: device.lastSeenAt,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const devices = await listUserDevices(req.userId!);
      res.json({ success: true, data: devices });
    } catch (err) {
      next(err);
    }
  },
);

const unregisterSchema = z.object({
  fcmToken: z.string().trim().min(20).max(4096),
});

router.delete(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = unregisterSchema.parse(req.body);
      await unregisterDevice({
        userId: req.userId!,
        fcmToken: body.fcmToken,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
