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

import type { NumberMigrationStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

const TERMINAL: readonly NumberMigrationStatus[] = [
  "NOT_ELIGIBLE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
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
  return TERMINAL.includes(status);
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
