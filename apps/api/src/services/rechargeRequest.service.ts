// ============================================================================
// RechargeRequest service (Claude FINAL §4, slice 6)
//
// Manual bank-transfer recharge. The customer files a request with
// proof; SuperAdmin reviews and approves/rejects. Approval credits
// the wallet via the same WalletTransaction ledger as Razorpay, so
// the audit history shows both kinds of credits in one timeline.
//
// State machine:
//   PENDING → APPROVED   (SuperAdmin approves; credit booked)
//   PENDING → REJECTED   (SuperAdmin rejects; no credit)
//   APPROVED and REJECTED are terminal — no re-decision.
//
// Why terminal:
//   - APPROVED → REJECTED would have to unbook a real credit on the
//     wallet ledger, and our ledger is append-only.
//   - REJECTED → APPROVED is theoretically harmless but blurs audit;
//     the operator should create a new RechargeRequest instead.
// ============================================================================

import {
  prisma,
  type RechargeRequest,
  type RechargeRequestStatus,
} from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { adjustWallet } from "./wallet.service";
import { createInvoiceForRechargeRequest } from "./invoice.service";

const ALLOWED_TRANSITIONS: Record<
  RechargeRequestStatus,
  ReadonlyArray<RechargeRequestStatus>
> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

/** True when the requested transition is legal. Pure. */
export function canTransitionStatus(
  from: RechargeRequestStatus,
  to: RechargeRequestStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertCanTransitionStatus(
  from: RechargeRequestStatus,
  to: RechargeRequestStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot transition RechargeRequest ${from} → ${to}.`,
    );
  }
}

/**
 * Sanitizes a customer-supplied URL. We don't host the proof image
 * ourselves; the customer pastes a link to their own storage / the
 * partner's portal. Hard-rejects non-http(s) schemes (no javascript:
 * or data: URLs) and caps at 1024 chars.
 */
export function sanitizeProofUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Proof URL must be a string.",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 1024) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Proof URL must be 1024 characters or fewer.",
    );
  }
  // Hard-reject anything that isn't http/https. The URL is rendered
  // as a clickable link to the SuperAdmin; we don't want
  // javascript:alert() landing on their dashboard.
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Proof URL must start with http:// or https://",
    );
  }
  return trimmed;
}

export function sanitizeReference(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 80);
}

export function sanitizeNote(
  raw: unknown,
  fieldName: string,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${fieldName} must be a string.`,
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 1024);
}

// ---- DB layer --------------------------------------------------------------

export async function createRechargeRequest(args: {
  tenantId: string;
  amount: number;
  currency?: string;
  proofUrl?: string | null;
  reference?: string | null;
  customerNote?: string | null;
  createdByUserId?: string;
}): Promise<RechargeRequest> {
  if (!Number.isInteger(args.amount) || args.amount < 100) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Amount must be an integer in the smallest currency unit (>= 100).",
    );
  }

  // Verify the wallet exists + is active. Catches typo'd tenantIds
  // before we leave an orphan RechargeRequest.
  const wallet = await prisma.wallet.findUnique({
    where: { tenantId: args.tenantId },
    select: { status: true },
  });
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Wallet not initialized for this tenant.",
    );
  }
  if (wallet.status !== "ACTIVE") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot file a recharge request for a ${wallet.status} wallet.`,
    );
  }

  return prisma.rechargeRequest.create({
    data: {
      tenantId: args.tenantId,
      amount: args.amount,
      currency: (args.currency ?? "INR").toUpperCase(),
      proofUrl: sanitizeProofUrl(args.proofUrl ?? null),
      reference: sanitizeReference(args.reference ?? null),
      customerNote: sanitizeNote(args.customerNote ?? null, "customerNote"),
      createdByUserId: args.createdByUserId ?? null,
    },
  });
}

export async function listRechargeRequests(args: {
  tenantId?: string;
  status?: RechargeRequestStatus;
  limit?: number;
}): Promise<RechargeRequest[]> {
  return prisma.rechargeRequest.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(args.limit ?? 50, 200),
  });
}

/**
 * Approve a pending request. Books a CREDIT_ALLOCATION on the
 * customer's wallet ledger and stamps the request as APPROVED.
 *
 * The credit + status update happen serially (not in a single DB
 * transaction) because adjustWallet already runs in a Serializable
 * transaction internally — wrapping a second transaction around it
 * deadlocks under load. The order is:
 *   1. Credit the wallet (adjustWallet).
 *   2. Update the request to APPROVED with ledgerTransactionId.
 *
 * Crash between (1) and (2) leaves an orphan credit on the wallet
 * and a still-PENDING request — operator can manually flip the
 * request to APPROVED. Better than the inverse (status flipped but
 * no credit) which would visibly cheat the customer.
 */
export async function approveRechargeRequest(args: {
  id: string;
  approverUserId: string;
  adminNotes?: string;
}): Promise<RechargeRequest> {
  const existing = await prisma.rechargeRequest.findUnique({
    where: { id: args.id },
  });
  if (!existing) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Recharge request not found.",
    );
  }
  assertCanTransitionStatus(existing.status, "APPROVED");

  const credit = await adjustWallet({
    tenantId: existing.tenantId,
    actorUserId: args.approverUserId,
    type: WalletTransactionType.CREDIT_ALLOCATION,
    direction: WalletTransactionDirection.CREDIT,
    amountCredits: existing.amount,
    reason: `Manual recharge request ${existing.id} approved`,
    referenceType: "recharge_request",
    referenceId: existing.id,
    metadata: {
      reference: existing.reference,
      proofUrl: existing.proofUrl,
      currency: existing.currency,
    },
  });

  const updated = await prisma.rechargeRequest.update({
    where: { id: existing.id },
    data: {
      status: "APPROVED",
      approvedByUserId: args.approverUserId,
      approvedAt: new Date(),
      ledgerTransactionId: credit.transaction.id,
      adminNotes: sanitizeNote(args.adminNotes ?? null, "adminNotes"),
    },
  });

  // Auto-issue the customer invoice. Same try/catch shape as the
  // Razorpay path — invoice failures must not block the credit.
  try {
    await createInvoiceForRechargeRequest(updated);
  } catch (err) {
    console.warn(
      "[recharge-request] invoice creation failed (credit still booked):",
      (err as Error).message,
    );
  }

  return updated;
}

export async function rejectRechargeRequest(args: {
  id: string;
  approverUserId: string;
  adminNotes?: string;
}): Promise<RechargeRequest> {
  const existing = await prisma.rechargeRequest.findUnique({
    where: { id: args.id },
  });
  if (!existing) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Recharge request not found.",
    );
  }
  assertCanTransitionStatus(existing.status, "REJECTED");

  return prisma.rechargeRequest.update({
    where: { id: existing.id },
    data: {
      status: "REJECTED",
      approvedByUserId: args.approverUserId,
      rejectedAt: new Date(),
      adminNotes: sanitizeNote(args.adminNotes ?? null, "adminNotes"),
    },
  });
}
