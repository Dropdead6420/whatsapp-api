// ============================================================================
// PaymentOrder service (Claude FINAL §4, slice 1)
//
// Pure helpers for the customer self-recharge flow. The DB layer
// (createPaymentOrder + applyWebhookEvent) lands in subsequent slices
// alongside the actual Razorpay/Stripe wiring; this slice just
// stabilizes the contracts:
//
//   - canTransitionStatus(from, to)  — state-machine rules
//   - sanitizeRechargeAmount(...)    — bounds check on smallest-unit amount
//   - sanitizeIdempotencyKey(...)    — key shape + length validation
//
// Lifecycle:
//   CREATED → PENDING → SUCCEEDED       (happy path)
//   CREATED → PENDING → FAILED          (signature mismatch / gateway no)
//   CREATED → PENDING → EXPIRED         (reconciliation sweep)
//   CREATED → CANCELLED                 (operator-cancel before checkout)
//   SUCCEEDED / FAILED / EXPIRED / CANCELLED are terminal.
//
// Why a state machine rather than free-form updates:
//   - SUCCEEDED → FAILED would unbook a real credit on the customer's
//     wallet (Razorpay can't claw back), so we hard-stop terminal
//     transitions.
//   - PENDING → CREATED would let a re-checkout reset the order; the
//     correct path is "create a new order with a fresh idempotency
//     key".
// ============================================================================

import type { PaymentOrderStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/** Bounds for amount sanitization. Currency-agnostic — caller is
 *  responsible for unit conversion (paise vs cents) before invoking. */
const MIN_AMOUNT_UNITS = 100; // ₹1 / $1 smallest unit floor
const MAX_AMOUNT_UNITS = 10_000_000; // ₹1,00,000 / $1,00,000 ceiling

const TERMINAL_STATUSES: readonly PaymentOrderStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
];

/**
 * Allowed forward transitions. Anything not in this map is rejected
 * by `canTransitionStatus`. Self-transitions (X → X) are forbidden so
 * duplicate webhooks can be detected at the route layer rather than
 * silently no-op'd.
 */
const ALLOWED_TRANSITIONS: Record<
  PaymentOrderStatus,
  ReadonlyArray<PaymentOrderStatus>
> = {
  CREATED: ["PENDING", "FAILED", "CANCELLED", "EXPIRED"],
  PENDING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/**
 * Returns true when the requested transition is legal. Pure — no DB.
 */
export function canTransitionStatus(
  from: PaymentOrderStatus,
  to: PaymentOrderStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Throws ApiError(BAD_REQUEST) when the transition isn't allowed.
 * Used by the webhook handler to refuse SUCCEEDED → anything (would
 * undo a real customer credit) and to keep self-loops out of audit.
 */
export function assertCanTransitionStatus(
  from: PaymentOrderStatus,
  to: PaymentOrderStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot transition PaymentOrder ${from} → ${to}.`,
    );
  }
}

/** True iff status is one of the four terminal states. */
export function isTerminalStatus(status: PaymentOrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Sanitizes a recharge amount. The caller is expected to have already
 * converted to the smallest currency unit (paise for INR, cents for
 * USD). Returns the validated integer or throws.
 */
export function sanitizeRechargeAmount(
  raw: unknown,
): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Amount must be a number.");
  }
  if (!Number.isInteger(num)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Amount must be an integer (smallest currency unit — paise / cents).",
    );
  }
  if (num < MIN_AMOUNT_UNITS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Amount must be at least ${MIN_AMOUNT_UNITS} (smallest unit).`,
    );
  }
  if (num > MAX_AMOUNT_UNITS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Amount cannot exceed ${MAX_AMOUNT_UNITS} (smallest unit).`,
    );
  }
  return num;
}

/**
 * Validates the client-supplied idempotency key. Required (no
 * server-generated fallback) so a network retry on the client always
 * lands on the same row.
 */
export function sanitizeIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key is required.",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length < 8) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key must be at least 8 characters.",
    );
  }
  if (trimmed.length > 80) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key must be 80 characters or fewer.",
    );
  }
  // Keep the surface narrow — letters, digits, dash, underscore. No
  // path-style characters; the key flows into DB indexes + audit logs.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key may only contain letters, digits, '-' and '_'.",
    );
  }
  return trimmed;
}
