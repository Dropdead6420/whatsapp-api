// ============================================================================
// FollowUpTask service (PRD-v2 §7 — agent-authored reminders)
//
// Operators (agents, team leads, business admins) drop tasks on
// themselves or each other while reading a conversation. The model is
// intentionally simple: title + dueAt + status + optional contact /
// conversation context.
//
// Lifecycle:
//   PENDING → DONE       (work finished)
//   PENDING → CANCELLED  (no longer needed)
//   DONE / CANCELLED are terminal — no reopening (audit clarity).
//
// Tenant scope is enforced on every read + write. Cross-tenant
// assignment is rejected up front; we don't trust the request body's
// assigneeId without verifying it belongs to the caller's tenant.
// ============================================================================

import { prisma, prismaRead, type FollowUpTask, type FollowUpTaskStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/** Inputs the caller can change after create (everything except IDs). */
export interface FollowUpTaskPatch {
  title?: string;
  notes?: string | null;
  dueAt?: Date;
  assigneeId?: string;
}

export interface CreateFollowUpTaskInput {
  tenantId: string;
  title: string;
  dueAt: Date;
  assigneeId: string;
  createdById: string;
  notes?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
}

export interface ListFollowUpTaskFilters {
  tenantId: string;
  /** If set, return only tasks assigned to this user. */
  assigneeId?: string;
  /** If set, return only tasks in these statuses (default: PENDING). */
  statuses?: FollowUpTaskStatus[];
  /** Optional context filters. */
  contactId?: string;
  conversationId?: string;
  /**
   * If true and assigneeId is set, return *only* the caller's own
   * tasks regardless of statuses filter (used to scope AGENT-role
   * callers regardless of what they pass in the query string).
   */
  forceOwn?: boolean;
  limit?: number;
}

// ---- Pure helpers (unit-tested) ---------------------------------------------

/**
 * Returns the next legal status given the current state and the
 * requested transition. Throws ApiError(BAD_REQUEST) when the
 * transition isn't allowed.
 *
 * Allowed:
 *   PENDING → DONE
 *   PENDING → CANCELLED
 *
 * Forbidden:
 *   anything from DONE or CANCELLED (terminal states)
 *   self-transitions (PENDING → PENDING)
 */
export function nextStatus(
  current: FollowUpTaskStatus,
  desired: FollowUpTaskStatus,
): FollowUpTaskStatus {
  if (current === desired) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Task is already ${current}.`,
    );
  }
  if (current !== "PENDING") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot change status of a ${current} task; finalize state.`,
    );
  }
  if (desired !== "DONE" && desired !== "CANCELLED") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid target status ${desired}.`,
    );
  }
  return desired;
}

/**
 * Normalizes + validates the create-input title. Strips whitespace,
 * caps to 280 chars (schema limit), rejects empties.
 */
export function sanitizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Task title is required.");
  }
  return trimmed.slice(0, 280);
}

/**
 * Normalizes optional notes. Empty/whitespace becomes null. Caps at
 * 4000 chars to keep DB rows sane.
 */
export function sanitizeNotes(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 4000);
}

/**
 * Validates dueAt — must be a real Date and not absurdly far in the
 * past (>1 day back). Future is fine (that's the point of a reminder).
 */
export function sanitizeDueAt(raw: Date | string | number): Date {
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid dueAt timestamp.");
  }
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (date.getTime() < oneDayAgo) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Due date is more than a day in the past.",
    );
  }
  return date;
}

// ---- DB layer ---------------------------------------------------------------

async function assertAssigneeInTenant(args: {
  tenantId: string;
  assigneeId: string;
}) {
  // Verify the assignee belongs to the caller's tenant *and* is an
  // active user. Skips DB load when the assigneeId is the same as the
  // creator (common case).
  const user = await prismaRead.user.findFirst({
    where: { id: args.assigneeId, tenantId: args.tenantId },
    select: { id: true, status: true },
  });
  if (!user) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Assignee must belong to this tenant.",
    );
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Assignee is not an active user.",
    );
  }
}

async function assertContextInTenant(args: {
  tenantId: string;
  contactId?: string | null;
  conversationId?: string | null;
}) {
  if (args.contactId) {
    const c = await prismaRead.contact.findFirst({
      where: { id: args.contactId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!c) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "Linked contact not found in this tenant.",
      );
    }
  }
  if (args.conversationId) {
    const c = await prismaRead.conversation.findFirst({
      where: { id: args.conversationId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!c) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "Linked conversation not found in this tenant.",
      );
    }
  }
}

export async function createFollowUpTask(
  input: CreateFollowUpTaskInput,
): Promise<FollowUpTask> {
  const title = sanitizeTitle(input.title);
  const notes = sanitizeNotes(input.notes ?? null);
  const dueAt = sanitizeDueAt(input.dueAt);

  await assertAssigneeInTenant({
    tenantId: input.tenantId,
    assigneeId: input.assigneeId,
  });
  await assertContextInTenant({
    tenantId: input.tenantId,
    contactId: input.contactId,
    conversationId: input.conversationId,
  });

  return prisma.followUpTask.create({
    data: {
      tenantId: input.tenantId,
      title,
      notes,
      dueAt,
      assigneeId: input.assigneeId,
      createdById: input.createdById,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
    },
  });
}

export async function listFollowUpTasks(
  filters: ListFollowUpTaskFilters,
): Promise<FollowUpTask[]> {
  const statuses = filters.statuses && filters.statuses.length > 0
    ? filters.statuses
    : (["PENDING"] as FollowUpTaskStatus[]);

  const where: Record<string, unknown> = {
    tenantId: filters.tenantId,
    status: { in: statuses },
  };
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.contactId) where.contactId = filters.contactId;
  if (filters.conversationId) where.conversationId = filters.conversationId;

  return prismaRead.followUpTask.findMany({
    where,
    orderBy: [
      { status: "asc" }, // PENDING (0) before DONE/CANCELLED visually
      { dueAt: "asc" },
    ],
    take: Math.min(filters.limit ?? 100, 200),
  });
}

async function loadTaskInScope(args: {
  taskId: string;
  tenantId: string;
  /** If set, also pin assigneeId — used to keep AGENTs locked to their own queue. */
  assigneeId?: string;
}): Promise<FollowUpTask> {
  const task = await prisma.followUpTask.findFirst({
    where: {
      id: args.taskId,
      tenantId: args.tenantId,
      ...(args.assigneeId ? { assigneeId: args.assigneeId } : {}),
    },
  });
  if (!task) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Task not found.");
  }
  return task;
}

export async function transitionFollowUpTask(args: {
  taskId: string;
  tenantId: string;
  assigneeId?: string;
  desired: FollowUpTaskStatus;
}): Promise<FollowUpTask> {
  const existing = await loadTaskInScope({
    taskId: args.taskId,
    tenantId: args.tenantId,
    assigneeId: args.assigneeId,
  });
  const target = nextStatus(existing.status, args.desired);
  const now = new Date();
  return prisma.followUpTask.update({
    where: { id: existing.id },
    data: {
      status: target,
      completedAt: target === "DONE" ? now : existing.completedAt,
      cancelledAt: target === "CANCELLED" ? now : existing.cancelledAt,
    },
  });
}

export async function patchFollowUpTask(args: {
  taskId: string;
  tenantId: string;
  assigneeId?: string;
  patch: FollowUpTaskPatch;
}): Promise<FollowUpTask> {
  const existing = await loadTaskInScope({
    taskId: args.taskId,
    tenantId: args.tenantId,
    assigneeId: args.assigneeId,
  });
  if (existing.status !== "PENDING") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot edit a ${existing.status} task; reopen by creating a new one.`,
    );
  }

  const data: Record<string, unknown> = {};
  if (args.patch.title !== undefined) data.title = sanitizeTitle(args.patch.title);
  if (args.patch.notes !== undefined) data.notes = sanitizeNotes(args.patch.notes);
  if (args.patch.dueAt !== undefined) data.dueAt = sanitizeDueAt(args.patch.dueAt);
  if (args.patch.assigneeId !== undefined) {
    await assertAssigneeInTenant({
      tenantId: args.tenantId,
      assigneeId: args.patch.assigneeId,
    });
    data.assigneeId = args.patch.assigneeId;
  }
  if (Object.keys(data).length === 0) return existing;

  return prisma.followUpTask.update({ where: { id: existing.id }, data });
}
