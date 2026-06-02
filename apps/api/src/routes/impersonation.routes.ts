// ============================================================================
// Impersonation routes (slice 2)
//
// SUPER_ADMIN starts an impersonation session by hitting /start with
// the target tenantId (and optionally a specific user id). The server
// validates via assertCanStartImpersonation, mints an access token
// signed for the *target user* but carrying the actor in the JWT
// claims, and writes an IMPERSONATE audit log.
//
// /exit is purely an audit signal — the client is expected to drop
// the impersonation token and resume with the original SUPER_ADMIN
// token. We don't keep server-side session state (no DB blacklist /
// allowlist), so the JWT's short TTL is the only revocation surface.
//
// Both routes are SUPER_ADMIN-only and explicitly forbidden when
// already impersonating (the dangerousActionGuard already blocks
// /start; /exit allows it since the *whole point* is to leave a
// session).
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "@nexaflow/shared";
import { authService } from "../services/auth.service";
import { assertCanStartImpersonation } from "../services/impersonation.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth);

const startSchema = z.object({
  targetTenantId: z.string().min(1),
  /** Optional — defaults to the BUSINESS_ADMIN owner of the tenant. */
  targetUserId: z.string().min(1).optional(),
  /** Free-text justification for the audit log. */
  reason: z.string().trim().min(1).max(280).optional(),
});

router.post(
  "/start",
  requireRole(UserRole.SUPER_ADMIN),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = startSchema.parse(req.body);

      // Resolve the target user — explicit if provided, otherwise the
      // first active BUSINESS_ADMIN of the tenant (deterministic
      // ordering for repeatable behavior).
      let target = body.targetUserId
        ? await prisma.user.findFirst({
            where: {
              id: body.targetUserId,
              tenantId: body.targetTenantId,
              status: "ACTIVE",
            },
            select: { id: true, email: true, name: true, role: true },
          })
        : await prisma.user.findFirst({
            where: {
              tenantId: body.targetTenantId,
              role: "BUSINESS_ADMIN",
              status: "ACTIVE",
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, email: true, name: true, role: true },
          });

      if (!target) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          body.targetUserId
            ? "Target user not found in this tenant."
            : "No active BUSINESS_ADMIN in this tenant — pass targetUserId explicitly.",
        );
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: body.targetTenantId },
        select: { id: true, name: true, status: true },
      });
      if (!tenant) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
      }
      if (tenant.status !== "ACTIVE") {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          `Cannot impersonate into a ${tenant.status} tenant.`,
        );
      }
      const targetRole = target.role as UserRole;

      // Pure-helper validation: actor must be SUPER_ADMIN, target
      // can't be SUPER_ADMIN, can't impersonate self.
      assertCanStartImpersonation({
        actorRole: req.userRole,
        actorUserId: req.userId,
        targetUserId: target.id,
        targetRole,
      });

      const accessToken = authService.generateImpersonationToken({
        actorUserId: req.userId!,
        actorRole: req.userRole!,
        targetUserId: target.id,
        targetRole,
        targetTenantId: tenant.id,
      });

      const meta = extractRequestMeta(req);
      await logAudit({
        tenantId: tenant.id,
        userId: req.userId!,
        action: "IMPERSONATE",
        resource: "user",
        resourceId: target.id,
        newValues: {
          phase: "start",
          targetEmail: target.email,
          targetRole: target.role,
          tenantId: tenant.id,
          reason: body.reason ?? null,
        },
        ...meta,
      });

      res.json({
        success: true,
        data: {
          accessToken,
          expiresInSeconds: authService.accessTokenTtl,
          target: {
            id: target.id,
            name: target.name,
            email: target.email,
            role: target.role,
          },
          tenant: { id: tenant.id, name: tenant.name },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/exit",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      // /exit is callable *only* from inside an impersonation session
      // — otherwise there's nothing to exit. We don't gate on role
      // here because the role on the token is the *target's* role at
      // this point, not the actor's. The actorUserId presence is the
      // truth-of-being-an-impersonation-session signal.
      if (!req.impersonating || !req.actorUserId) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Not currently impersonating.",
        );
      }

      const meta = extractRequestMeta(req);
      await logAudit({
        // tenantId here is the *target's* tenant — that's where the
        // session was active, which is what an admin auditor would
        // filter by.
        tenantId: req.tenantId ?? "",
        userId: req.actorUserId,
        action: "IMPERSONATE",
        resource: "user",
        resourceId: req.userId,
        newValues: {
          phase: "exit",
          // Capture both sides so the timeline is reconstructable.
          actorUserId: req.actorUserId,
          targetUserId: req.userId,
          tenantId: req.tenantId,
        },
        ...meta,
      });

      res.json({ success: true, data: { exited: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
