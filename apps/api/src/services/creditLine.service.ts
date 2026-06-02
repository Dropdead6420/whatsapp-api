// ============================================================================
// CreditLine service (Claude FINAL §4, slice 8)
//
// Postpaid limit + approver trail. Wallet.creditLimit and
// Wallet.billingMode are the operational fields the negative-balance
// check reads; this service is the contract layer that keeps them in
// sync with a CreditLine row.
//
// Lifecycle:
//   (none)  → ACTIVE                     (open a new line)
//   ACTIVE  → SUSPENDED                  (pause, e.g. payment overdue)
//   ACTIVE  → CLOSED                     (end the line — terminal)
//   SUSPENDED → ACTIVE                   (reactivate)
//   SUSPENDED → CLOSED                   (give up on the line — terminal)
//   CLOSED is terminal.
//
// Why SUSPENDED ↔ ACTIVE is allowed (unlike most other state machines
// in this codebase): suspension is a *risk control*, not a final
// decision. The customer pays the overdue invoice → SuperAdmin
// reactivates. Closing is the one-way exit; that path is the
// PRD's "credit line ends" workflow.
// ============================================================================

import {
  prisma,
  Prisma,
  WalletBillingMode,
  type CreditLine,
  type CreditLineStatus,
  type Wallet,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

const ALLOWED_TRANSITIONS: Record<
  CreditLineStatus,
  ReadonlyArray<CreditLineStatus>
> = {
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

/** True iff the requested transition is legal. Pure. */
export function canTransitionStatus(
  from: CreditLineStatus,
  to: CreditLineStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertCanTransitionStatus(
  from: CreditLineStatus,
  to: CreditLineStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot transition CreditLine ${from} → ${to}.`,
    );
  }
}

/**
 * Used credits = max(0, -balance). PREPAID wallets never carry a
 * negative balance, so used is always 0. POSTPAID wallets dip
 * negative when debits outpace credits — that magnitude is the
 * outstanding draw on the credit line.
 *
 * Pure — exported for tests.
 */
export function computeUsedCredits(balanceCredits: number): number {
  return Math.max(0, -balanceCredits);
}

/** True when the used draw exceeds 80% of the limit. Pure. */
export function isOverUtilizationThreshold(args: {
  used: number;
  limit: number;
  thresholdPct?: number;
}): boolean {
  const pct = args.thresholdPct ?? 80;
  if (args.limit <= 0) return false;
  return (args.used / args.limit) * 100 >= pct;
}

export function sanitizeLimitCredits(raw: unknown): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Credit limit must be a number.",
    );
  }
  if (!Number.isInteger(num)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Credit limit must be an integer.",
    );
  }
  if (num < 1) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Credit limit must be at least 1 credit.",
    );
  }
  if (num > 100_000_000) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Credit limit cannot exceed 100,000,000 credits.",
    );
  }
  return num;
}

export function sanitizeNotes(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 1024);
}

// ---- DB layer --------------------------------------------------------------

export interface CreditLineWithWallet extends CreditLine {
  /** Cached wallet state at read time. Useful for utilization views. */
  wallet?: Pick<Wallet, "balanceCredits" | "creditLimit" | "billingMode"> | null;
}

/**
 * Opens a new credit line for a tenant. Refuses when an ACTIVE line
 * already exists (unique partial index also enforces this at DB
 * level — defense in depth). Flips Wallet.billingMode to POSTPAID
 * and sets Wallet.creditLimit inside a transaction so an ops failure
 * mid-update can't leave the operational state out of sync.
 */
export async function openCreditLine(args: {
  tenantId: string;
  limitCredits: number;
  dueDate?: Date | null;
  approvedByUserId: string;
  notes?: string;
}): Promise<CreditLine> {
  const limitCredits = sanitizeLimitCredits(args.limitCredits);

  return prisma.$transaction(async (tx) => {
    // Guard at the app layer first so we return a clean 409 message.
    // (The partial-unique index is the last-line defense — if two
    // requests race, one gets P2002 which we surface as conflict.)
    const existingActive = await tx.creditLine.findFirst({
      where: { tenantId: args.tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (existingActive) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "Tenant already has an active credit line; close it before opening a new one.",
      );
    }

    const wallet = await tx.wallet.findUnique({
      where: { tenantId: args.tenantId },
      select: { id: true },
    });
    if (!wallet) {
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        404,
        "Wallet not initialized for this tenant.",
      );
    }

    const line = await tx.creditLine.create({
      data: {
        tenantId: args.tenantId,
        limitCredits,
        dueDate: args.dueDate ?? null,
        approvedByUserId: args.approvedByUserId,
        notes: sanitizeNotes(args.notes ?? null),
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        creditLimit: limitCredits,
        billingMode: WalletBillingMode.POSTPAID,
      },
    });

    return line;
  });
}

async function transitionInternal(args: {
  id: string;
  approverUserId: string;
  desired: CreditLineStatus;
  notes?: string;
}): Promise<CreditLine> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditLine.findUnique({
      where: { id: args.id },
    });
    if (!existing) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Credit line not found.");
    }
    assertCanTransitionStatus(existing.status, args.desired);

    const now = new Date();
    const data: Prisma.CreditLineUpdateInput = {
      status: args.desired,
      ...(args.notes !== undefined
        ? { notes: sanitizeNotes(args.notes) }
        : {}),
    };

    if (args.desired === "SUSPENDED") {
      data.suspendedAt = now;
    } else if (args.desired === "CLOSED") {
      data.closedAt = now;
    } else if (args.desired === "ACTIVE") {
      // Reactivation clears the suspendedAt stamp so the trail
      // distinguishes "is suspended right now" from "was suspended
      // once".
      data.suspendedAt = null;
    }

    const updated = await tx.creditLine.update({
      where: { id: existing.id },
      data,
    });

    // Wallet operational state needs to match. SUSPENDED + CLOSED
    // both reset Wallet to PREPAID; ACTIVE (reactivation) restores
    // the line's limit + POSTPAID.
    if (args.desired === "ACTIVE") {
      await tx.wallet.update({
        where: { tenantId: existing.tenantId },
        data: {
          creditLimit: updated.limitCredits,
          billingMode: WalletBillingMode.POSTPAID,
        },
      });
    } else {
      // SUSPENDED + CLOSED: drop the credit line on the wallet. New
      // debits will be checked against balance only (no credit
      // headroom) — that's the point of suspending.
      await tx.wallet.update({
        where: { tenantId: existing.tenantId },
        data: {
          creditLimit: 0,
          billingMode: WalletBillingMode.PREPAID,
        },
      });
    }

    return updated;
  });
}

export async function suspendCreditLine(args: {
  id: string;
  approverUserId: string;
  notes?: string;
}): Promise<CreditLine> {
  return transitionInternal({ ...args, desired: "SUSPENDED" });
}

export async function reactivateCreditLine(args: {
  id: string;
  approverUserId: string;
  notes?: string;
}): Promise<CreditLine> {
  return transitionInternal({ ...args, desired: "ACTIVE" });
}

export async function closeCreditLine(args: {
  id: string;
  approverUserId: string;
  notes?: string;
}): Promise<CreditLine> {
  return transitionInternal({ ...args, desired: "CLOSED" });
}

export async function listCreditLines(args: {
  tenantId?: string;
  status?: CreditLineStatus;
  limit?: number;
}): Promise<CreditLine[]> {
  return prisma.creditLine.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(args.limit ?? 50, 200),
  });
}
