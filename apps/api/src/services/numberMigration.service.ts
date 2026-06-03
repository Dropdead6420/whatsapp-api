// ============================================================================
// WhatsApp number migration state machine (Claude FINAL §10, slice 1)
//
// Pure transition rules + helpers for the migrate-a-number-in flow.
// The Meta API calls (eligibility check, OTP request/verify, old-BSP
// release, webhook re-subscribe, template re-sync) and the routes land
// in subsequent slices; this slice nails the state graph so those can't
// drive a migration into an impossible state.
//
// Happy path:
//   PENDING_ELIGIBILITY → ELIGIBLE → OTP_REQUESTED → OTP_VERIFIED
//                       → MIGRATING → COMPLETED
//
// Off-ramps:
//   PENDING_ELIGIBILITY → NOT_ELIGIBLE        (Meta refused)
//   <any non-terminal>  → FAILED | CANCELLED
//
// Terminal: NOT_ELIGIBLE, COMPLETED, FAILED, CANCELLED.
//
// OTP resend (OTP_REQUESTED → OTP_REQUESTED) is intentionally NOT a
// transition — a resend re-stamps otpRequestedAt on the same state and
// is handled by the route, not the state machine (self-transitions stay
// out of the graph so duplicate events are detectable).
// ============================================================================

import {
  prisma,
  prismaRead,
  type NumberMigration,
  type NumberMigrationStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export const NUMBER_MIGRATION_TERMINAL_STATUSES: readonly NumberMigrationStatus[] = [
  "NOT_ELIGIBLE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export const NUMBER_MIGRATION_LIVE_STATUSES: readonly NumberMigrationStatus[] = [
  "PENDING_ELIGIBILITY",
  "ELIGIBLE",
  "OTP_REQUESTED",
  "OTP_VERIFIED",
  "MIGRATING",
];

// FAILED + CANCELLED are reachable from every non-terminal state, so
// they're appended programmatically rather than repeated in each list.
const FORWARD: Record<NumberMigrationStatus, ReadonlyArray<NumberMigrationStatus>> = {
  PENDING_ELIGIBILITY: ["ELIGIBLE", "NOT_ELIGIBLE"],
  ELIGIBLE: ["OTP_REQUESTED"],
  OTP_REQUESTED: ["OTP_VERIFIED"],
  OTP_VERIFIED: ["MIGRATING"],
  MIGRATING: ["COMPLETED"],
  NOT_ELIGIBLE: [],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** True iff status is terminal (no further transitions). */
export function isTerminal(status: NumberMigrationStatus): boolean {
  return NUMBER_MIGRATION_TERMINAL_STATUSES.includes(status);
}

/**
 * Returns the set of statuses reachable from `from`. Non-terminal
 * states can always go to FAILED / CANCELLED in addition to their
 * forward step(s). Pure — exported for tests.
 */
export function allowedNextStatuses(
  from: NumberMigrationStatus,
): NumberMigrationStatus[] {
  if (isTerminal(from)) return [];
  // NOT_ELIGIBLE is a Meta verdict from PENDING_ELIGIBILITY only — it's
  // already in FORWARD for that state; the universal off-ramps are the
  // operator/gateway failures.
  return [...FORWARD[from], "FAILED", "CANCELLED"];
}

/** True iff `from → to` is a legal transition. Self-loops are false. */
export function canTransition(
  from: NumberMigrationStatus,
  to: NumberMigrationStatus,
): boolean {
  if (from === to) return false;
  return allowedNextStatuses(from).includes(to);
}

export function assertCanTransition(
  from: NumberMigrationStatus,
  to: NumberMigrationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot transition number migration ${from} → ${to}.`,
    );
  }
}

/**
 * The operator-facing "what happens next" label for a given state.
 * Drives the migration status UI's primary action button. Pure.
 */
export function nextActionLabel(status: NumberMigrationStatus): string | null {
  switch (status) {
    case "PENDING_ELIGIBILITY":
      return "Checking eligibility with Meta…";
    case "ELIGIBLE":
      return "Request verification code";
    case "OTP_REQUESTED":
      return "Enter the verification code";
    case "OTP_VERIFIED":
      return "Start migration";
    case "MIGRATING":
      return "Migrating — release, webhook, templates…";
    default:
      return null; // terminal states have no next action
  }
}

/**
 * Maps a status to the timestamp column the DB layer should stamp when
 * the migration *enters* it. Pure — keeps the route + service from
 * drifting on which column tracks which step. Returns null for states
 * that don't have a dedicated stamp (PENDING_ELIGIBILITY is the
 * createdAt baseline; CANCELLED/FAILED use statusReason + updatedAt).
 */
export function timestampFieldForStatus(
  status: NumberMigrationStatus,
): string | null {
  switch (status) {
    case "ELIGIBLE":
    case "NOT_ELIGIBLE":
      return "eligibilityCheckedAt";
    case "OTP_REQUESTED":
      return "otpRequestedAt";
    case "OTP_VERIFIED":
      return "otpVerifiedAt";
    case "COMPLETED":
      return "completedAt";
    default:
      return null;
  }
}

/** Statuses an operator may still cancel from. Pure. */
export function isCancellable(status: NumberMigrationStatus): boolean {
  return !isTerminal(status);
}

export interface NumberMigrationListFilters {
  tenantId?: string;
  status?: NumberMigrationStatus;
  page?: number;
  limit?: number;
}

export interface NumberMigrationListResult {
  items: Array<NumberMigration & { tenant: { id: string; name: string } }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function listNumberMigrations(
  filters: NumberMigrationListFilters = {},
): Promise<NumberMigrationListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where = {
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const [items, total] = await Promise.all([
    prismaRead.numberMigration.findMany({
      where,
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prismaRead.numberMigration.count({ where }),
  ]);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function createNumberMigration(args: {
  tenantId: string;
  phoneNumber: string;
  targetWabaId?: string | null;
  createdByUserId?: string | null;
}): Promise<NumberMigration & { tenant: { id: string; name: string } }> {
  const tenant = await prismaRead.tenant.findUnique({
    where: { id: args.tenantId },
    select: { id: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }

  const active = await prismaRead.numberMigration.findFirst({
    where: {
      tenantId: args.tenantId,
      status: { in: [...NUMBER_MIGRATION_LIVE_STATUSES] },
    },
    select: { id: true, phoneNumber: true, status: true },
  });
  if (active) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Tenant already has an active migration for ${active.phoneNumber} (${active.status}).`,
    );
  }

  return prisma.numberMigration.create({
    data: {
      tenantId: args.tenantId,
      phoneNumber: args.phoneNumber,
      targetWabaId: args.targetWabaId?.trim() || null,
      createdByUserId: args.createdByUserId ?? null,
    },
    include: { tenant: { select: { id: true, name: true } } },
  });
}

function transitionData(
  status: NumberMigrationStatus,
  reason: string | null,
): Record<string, unknown> {
  const now = new Date();
  const data: Record<string, unknown> = {
    status,
    statusReason: reason,
  };
  const stamp = timestampFieldForStatus(status);
  if (stamp) data[stamp] = now;

  // Completing the migration means the operational cutover is done. When
  // future Meta adapters provide exact timestamps they can set these
  // earlier; for manual completion we stamp any missing cutover steps.
  if (status === "COMPLETED") {
    data.releasedAt = now;
    data.webhookUpdatedAt = now;
    data.templatesSyncedAt = now;
  }
  return data;
}

export async function transitionNumberMigration(args: {
  id: string;
  toStatus: NumberMigrationStatus;
  reason?: string | null;
}): Promise<NumberMigration & { tenant: { id: string; name: string } }> {
  const current = await prisma.numberMigration.findUnique({
    where: { id: args.id },
    include: { tenant: { select: { id: true, name: true } } },
  });
  if (!current) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Number migration not found.");
  }
  assertCanTransition(current.status, args.toStatus);

  return prisma.numberMigration.update({
    where: { id: args.id },
    data: transitionData(args.toStatus, args.reason?.trim() || null),
    include: { tenant: { select: { id: true, name: true } } },
  });
}

export async function resendNumberMigrationOtp(args: {
  id: string;
  reason?: string | null;
}): Promise<NumberMigration & { tenant: { id: string; name: string } }> {
  const current = await prisma.numberMigration.findUnique({
    where: { id: args.id },
    include: { tenant: { select: { id: true, name: true } } },
  });
  if (!current) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Number migration not found.");
  }
  if (current.status !== "OTP_REQUESTED") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "OTP can only be resent after the migration is in OTP_REQUESTED.",
    );
  }
  return prisma.numberMigration.update({
    where: { id: args.id },
    data: {
      otpRequestedAt: new Date(),
      statusReason: args.reason?.trim() || current.statusReason,
    },
    include: { tenant: { select: { id: true, name: true } } },
  });
}
