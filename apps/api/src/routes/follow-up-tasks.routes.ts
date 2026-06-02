// ============================================================================
// Follow-up tasks routes (PRD-v2 §7, slice 2)
//
// AGENT can only see / create / edit / complete their own tasks. They
// can't see what other agents are working on or assign work to peers.
// BUSINESS_ADMIN + TEAM_LEAD see the whole tenant queue and can route
// tasks across the team.
//
// Scope enforcement lives in this file (not the service) because the
// scope rule depends on the caller's role — the service stays
// role-agnostic and accepts an explicit assigneeId pin from the route.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  createFollowUpTask,
  listFollowUpTasks,
  patchFollowUpTask,
  transitionFollowUpTask,
} from "../services/followUpTask.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const STATUS_VALUES = ["PENDING", "DONE", "CANCELLED"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(280),
  dueAt: z
    .string()
    .datetime({ message: "dueAt must be an ISO datetime string" }),
  assigneeId: z.string().min(1).optional(),
  notes: z.string().max(4000).optional().nullable(),
  contactId: z.string().min(1).optional().nullable(),
  conversationId: z.string().min(1).optional().nullable(),
});

const listQuerySchema = z.object({
  assigneeId: z.string().min(1).optional(),
  statuses: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const valid = parts.filter((p): p is (typeof STATUS_VALUES)[number] =>
        (STATUS_VALUES as readonly string[]).includes(p),
      );
      return valid.length > 0 ? valid : undefined;
    }),
  contactId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const parsed = Number.parseInt(v, 10);
      return Number.isNaN(parsed) ? 1 : Math.min(200, Math.max(1, parsed));
    }),
});

const patchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  dueAt: z.string().datetime().optional(),
  assigneeId: z.string().min(1).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

/**
 * If the caller is an AGENT, force the assigneeId pin to their own
 * userId so they can't see / edit / write tasks for anyone else.
 * For TEAM_LEAD + BUSINESS_ADMIN, the pin is undefined (full tenant
 * scope) and the route trusts the body / query for assignee.
 */
function agentPin(req: RequestWithAuth): string | undefined {
  return req.userRole === "AGENT" ? req.userId : undefined;
}

router.post(
  "/",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const pin = agentPin(req);

      // AGENTs can only create tasks for themselves. Any other
      // assigneeId in the body is silently overridden to self.
      // BUSINESS_ADMIN / TEAM_LEAD pick freely.
      const assigneeId = pin ?? body.assigneeId ?? req.userId!;

      const task = await createFollowUpTask({
        tenantId: req.tenantId!,
        title: body.title,
        dueAt: new Date(body.dueAt),
        assigneeId,
        createdById: req.userId!,
        notes: body.notes ?? null,
        contactId: body.contactId ?? null,
        conversationId: body.conversationId ?? null,
      });

      const meta = extractRequestMeta(req);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "follow_up_task",
        resourceId: task.id,
        newValues: {
          title: task.title,
          assigneeId: task.assigneeId,
          dueAt: task.dueAt,
          contactId: task.contactId,
          conversationId: task.conversationId,
        },
        ...meta,
      });

      res.status(201).json({ success: true, data: task });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/",
  requirePermission(Permissions.CONVERSATION_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const query = listQuerySchema.parse(req.query);
      const pin = agentPin(req);

      const tasks = await listFollowUpTasks({
        tenantId: req.tenantId!,
        assigneeId: pin ?? query.assigneeId,
        statuses: query.statuses,
        contactId: query.contactId,
        conversationId: query.conversationId,
        limit: query.limit,
      });
      res.json({ success: true, data: tasks });
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
      const body = patchSchema.parse(req.body);
      const pin = agentPin(req);

      // AGENTs can't reassign their tasks to someone else.
      if (pin && body.assigneeId !== undefined && body.assigneeId !== pin) {
        throw new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          "Agents cannot reassign follow-up tasks to other users.",
        );
      }

      const task = await patchFollowUpTask({
        taskId: req.params.id,
        tenantId: req.tenantId!,
        assigneeId: pin,
        patch: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.dueAt !== undefined ? { dueAt: new Date(body.dueAt) } : {}),
          ...(body.assigneeId !== undefined
            ? { assigneeId: body.assigneeId }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      });
      res.json({ success: true, data: task });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/complete",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const task = await transitionFollowUpTask({
        taskId: req.params.id,
        tenantId: req.tenantId!,
        assigneeId: agentPin(req),
        desired: "DONE",
      });
      res.json({ success: true, data: task });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/cancel",
  requirePermission(Permissions.CONVERSATION_REPLY),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const task = await transitionFollowUpTask({
        taskId: req.params.id,
        tenantId: req.tenantId!,
        assigneeId: agentPin(req),
        desired: "CANCELLED",
      });
      res.json({ success: true, data: task });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
