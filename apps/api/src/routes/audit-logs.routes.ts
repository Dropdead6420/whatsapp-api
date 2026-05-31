// Tenant-scoped audit-log view.
//
// SuperAdmin already has `/admin/audit-logs` (cross-tenant, filterable
// by tenantId). This module gives BUSINESS_ADMINs read access to their
// OWN tenant's audit trail — a standard SaaS compliance requirement:
// "who changed what setting / sent which campaign / signed in when."
//
// The critical invariant: every query is hard-pinned to the caller's
// JWT-resolved tenantId. The route never accepts a tenantId query
// parameter, and the where clause overrides any client-supplied filter
// that could leak rows from sibling tenants.

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prismaRead } from "@nexaflow/db";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";

const router = Router();

router.use(requireAuth, requireTenantScope);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Optional client-side filters; tenantId is INTENTIONALLY excluded
  // from this schema so it can't override the caller's own scope.
  action: z.string().trim().min(1).max(40).optional(),
  resource: z.string().trim().min(1).max(80).optional(),
});

/**
 * Read tenant-scoped audit rows.
 *
 * BUSINESS_ADMIN, TEAM_LEAD, and AGENT all carry a tenantId on the
 * JWT — they all see the same audit trail (their own tenant's). We
 * don't gate on role here because read access to one's own audit log
 * is the lowest-friction compliance baseline; if a future product
 * decision wants stricter (e.g. "only BUSINESS_ADMIN sees auth events")
 * the filter can be applied at the where clause without changing the
 * route surface.
 */
router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = querySchema.parse(req.query);

      // CRITICAL: tenantId from the JWT, never from query. Even if a
      // client tries `?tenantId=other_tenant`, the schema strips it
      // and this where clause pins to the caller's own scope.
      const where: Record<string, unknown> = { tenantId: req.tenantId };
      if (q.action) where.action = q.action;
      if (q.resource) where.resource = q.resource;

      const [total, items] = await prismaRead.$transaction([
        prismaRead.auditLog.count({ where }),
        prismaRead.auditLog.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          items,
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / q.limit)),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
