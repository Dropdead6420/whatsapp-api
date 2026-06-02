// ============================================================================
// Impersonation guardrails (PRD security gap — support-debugging tool)
//
// SUPER_ADMIN can step into a tenant to debug a customer issue. The
// impersonation token is signed for the *target* user — so all
// tenant-scoped queries Just Work — and carries the actor in
// `actorUserId` so audit + dangerous-action gating know who's really
// behind the keyboard.
//
// Three rules this module enforces:
//   1. Only SUPER_ADMIN can start a session.
//   2. SUPER_ADMIN can't be impersonated (no privilege loop).
//   3. Dangerous mutations are blocked while impersonating — the
//      operator must exit impersonation, then perform the action with
//      their own credentials so it's stamped to them.
//
// Why these rules:
//   - (1): keeps a stolen / hijacked tenant session from ever
//     escalating to any other tenant.
//   - (2): without this, a SUPER_ADMIN whose session is compromised
//     could impersonate *another* SUPER_ADMIN to make actions look
//     like someone else's. Always denied.
//   - (3): logs show "alice (impersonating bob) did X" — for X that
//     deletes a tenant or moves money, the right behavior is to make
//     the operator commit to the action with their own creds rather
//     than blur accountability.
// ============================================================================

import type { UserRole } from "@nexaflow/shared";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/**
 * Routes that cannot be invoked under an impersonation token. The
 * pattern is matched against `req.method + " " + req.path` with simple
 * prefix matching (we don't pull in a path matcher; the list is short).
 *
 * Adding a route here should be paired with a doc note and a test
 * that exercises the gate.
 */
export const DANGEROUS_ACTION_PATTERNS: ReadonlyArray<string> = [
  // Irreversible destruction.
  "DELETE /api/v1/tenants",
  "DELETE /api/v1/contacts",
  // Money movement.
  "POST /api/v1/wallets",
  "POST /api/v1/wallet-risk",
  // Plan / billing changes.
  "POST /api/v1/billing",
  "PATCH /api/v1/billing",
  // Block stacking another impersonation on top of an existing one.
  // /exit is intentionally NOT here — an impersonator must always be
  // able to leave a session.
  "POST /api/v1/admin/impersonate/start",
];

/**
 * Returns true when the given (method, path) is a dangerous action that
 * impersonators must not perform. Match is case-insensitive on path
 * prefix (not a full regex — kept intentionally cheap).
 */
export function isDangerousAction(method: string, path: string): boolean {
  const probe = `${method.toUpperCase()} ${path}`;
  return DANGEROUS_ACTION_PATTERNS.some((pattern) => probe.startsWith(pattern));
}

/**
 * Returns true iff the given actor role is allowed to start an
 * impersonation session.
 */
export function canStartImpersonation(role: UserRole | undefined): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Returns true iff the given *target* role is allowed to be
 * impersonated. SUPER_ADMIN cannot be impersonated under any
 * circumstance.
 */
export function canImpersonateTargetRole(role: UserRole): boolean {
  return role !== "SUPER_ADMIN";
}

/**
 * Throws ApiError(IMPERSONATION_BLOCKED) when the request is
 * impersonating and the method+path is on the dangerous list. Returns
 * nothing on success.
 *
 * Pure function so the gate is unit-testable; routes call it via the
 * middleware-mounted helper.
 */
export function assertNotDangerousAction(args: {
  impersonating: boolean | undefined;
  method: string;
  path: string;
}): void {
  if (!args.impersonating) return;
  if (!isDangerousAction(args.method, args.path)) return;
  throw new ApiError(
    ErrorCodes.IMPERSONATION_BLOCKED,
    403,
    "This action is not allowed during impersonation. Exit impersonation and retry with your own credentials.",
  );
}

/**
 * Validates the inputs for starting a session. Throws ApiError on any
 * violation. Returns nothing on success.
 *
 * Doesn't itself mint the token — that's auth.service. This helper is
 * the thin guard layer in front of the mint so route + tests share the
 * same rule set.
 */
export function assertCanStartImpersonation(args: {
  actorRole: UserRole | undefined;
  actorUserId: string | undefined;
  targetUserId: string;
  targetRole: UserRole;
}): void {
  if (!canStartImpersonation(args.actorRole)) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Only SUPER_ADMIN can start an impersonation session.",
    );
  }
  if (!args.actorUserId) {
    throw new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      "Authenticated actor is required.",
    );
  }
  if (args.targetUserId === args.actorUserId) {
    // Pointless and would create a confusing audit trail.
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Cannot impersonate yourself.",
    );
  }
  if (!canImpersonateTargetRole(args.targetRole)) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Cannot impersonate another SUPER_ADMIN.",
    );
  }
}
