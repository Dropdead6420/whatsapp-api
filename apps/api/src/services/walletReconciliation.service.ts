import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getQueueConnection,
  getWalletReconciliationQueue,
  trackWorker,
  type WalletReconciliationJobData,
} from "../lib/queue";

// T-023: daily wallet reconciliation.
//
// Two questions, asked of every wallet, every day:
//   1. Does Wallet.balanceCredits equal sum(CREDIT) - sum(DEBIT) of
//      the ledger?                                  (ledger-sum check)
//   2. Does Wallet.balanceCredits equal the latest WalletTransaction's
//      balanceAfterCredits snapshot?              (last-snapshot check)
//
// If either check disagrees, something went wrong between a debit and
// the row update — a race, a partial transaction, a manual SQL fix.
// We log it to AuditLog so an operator can investigate; we do NOT
// auto-correct. Auto-correction without a human in the loop turns
// "platform tells you it has a bug" into "platform silently overwrites
// real customer money" — far worse.
//
// State storage: NONE. No new columns. The audit log IS the history;
// "current drift" is computed live.

export interface ReconcileResult {
  walletId: string;
  tenantId: string;
  declared: number;
  ledgerSum: number;
  lastSnapshot: number | null;
  driftFromLedger: number;
  driftFromSnapshot: number | null;
  hasDrift: boolean;
  txCount: number;
  reconciledAt: Date;
}

export interface ReconcileAllSummary {
  scanned: number;
  clean: number;
  drifted: number;
  /** The detailed result for any wallet with drift. Capped to keep audit log writes bounded on a large platform. */
  drifts: ReconcileResult[];
  startedAt: Date;
  finishedAt: Date;
}

const MAX_DRIFTS_PER_SCAN = 100;
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Reconcile a single wallet. Pure read-only — never mutates the wallet.
 * Returns the comparison so the caller can decide whether to alert.
 */
export async function reconcileWallet(
  walletId: string,
): Promise<ReconcileResult> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, tenantId: true, balanceCredits: true },
  });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  // Ledger sum via groupBy — pulls every transaction in one query.
  // For wallets with millions of transactions this would need to be
  // bucketed; for now we trust Postgres to handle the sum fast.
  const grouped = await prisma.walletTransaction.groupBy({
    by: ["direction"],
    where: { walletId },
    _sum: { amountCredits: true },
    _count: { _all: true },
  });

  let credits = 0;
  let debits = 0;
  let txCount = 0;
  for (const row of grouped) {
    const amt = row._sum.amountCredits ?? 0;
    txCount += row._count._all;
    if (row.direction === "CREDIT") credits = amt;
    else if (row.direction === "DEBIT") debits = amt;
  }
  const ledgerSum = credits - debits;

  // Last transaction snapshot. Indexed by [walletId, createdAt] so this
  // is a single index hit.
  const latestTx = await prisma.walletTransaction.findFirst({
    where: { walletId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterCredits: true },
  });
  const lastSnapshot = latestTx?.balanceAfterCredits ?? null;

  const driftFromLedger = wallet.balanceCredits - ledgerSum;
  const driftFromSnapshot =
    lastSnapshot !== null ? wallet.balanceCredits - lastSnapshot : null;

  return {
    walletId: wallet.id,
    tenantId: wallet.tenantId,
    declared: wallet.balanceCredits,
    ledgerSum,
    lastSnapshot,
    driftFromLedger,
    driftFromSnapshot,
    hasDrift:
      driftFromLedger !== 0 ||
      (driftFromSnapshot !== null && driftFromSnapshot !== 0),
    txCount,
    reconciledAt: new Date(),
  };
}

/**
 * Reconcile every wallet on the platform. For drift events, writes
 * an AuditLog entry with action="RECONCILIATION_DRIFT". Operators
 * can query that audit stream to see history.
 */
export async function reconcileAllWallets(): Promise<ReconcileAllSummary> {
  const startedAt = new Date();
  const wallets = await prisma.wallet.findMany({
    select: { id: true },
  });

  let clean = 0;
  const drifts: ReconcileResult[] = [];

  for (const w of wallets) {
    try {
      const result = await reconcileWallet(w.id);
      if (result.hasDrift) {
        if (drifts.length < MAX_DRIFTS_PER_SCAN) drifts.push(result);
        // Write an audit row even past MAX_DRIFTS — we want every drift
        // on record. The drifts[] cap is just for the in-memory return
        // value so a 50,000-wallet platform doesn't OOM the worker.
        try {
          await prisma.auditLog.create({
            data: {
              tenantId: result.tenantId,
              // System-actor user: we don't have a "system" user id, so
              // we use the first SUPER_ADMIN as the actor — the platform
              // operator is the "responsible party" for reconciliation.
              // Fall back to skipping the userId if none exists (test/
              // bare DBs); we rely on the resource pointer to identify.
              userId: (await firstSuperAdminId()) ?? "system",
              action: "RECONCILIATION_DRIFT",
              resource: "Wallet",
              resourceId: result.walletId,
              newValues: JSON.stringify({
                declared: result.declared,
                ledgerSum: result.ledgerSum,
                lastSnapshot: result.lastSnapshot,
                driftFromLedger: result.driftFromLedger,
                driftFromSnapshot: result.driftFromSnapshot,
                txCount: result.txCount,
              }),
            },
          });
        } catch (err) {
          // Audit write failed — don't poison the whole scan over
          // one bad row. Log + continue.
          console.error(
            `[wallet-reconciliation] audit write failed for wallet ${result.walletId}:`,
            (err as Error).message,
          );
        }
      } else {
        clean += 1;
      }
    } catch (err) {
      console.error(
        `[wallet-reconciliation] wallet ${w.id} failed:`,
        (err as Error).message,
      );
    }
  }

  const finishedAt = new Date();
  return {
    scanned: wallets.length,
    clean,
    drifted: drifts.length,
    drifts,
    startedAt,
    finishedAt,
  };
}

// Memoized in-process. Refreshed only when null, so creating a new
// SUPER_ADMIN after start-up doesn't invalidate the cache — but for
// this use case (audit-log actor) we don't care which super-admin we
// blame; we just need a non-null userId.
let cachedSuperAdminId: string | null = null;
async function firstSuperAdminId(): Promise<string | null> {
  if (cachedSuperAdminId) return cachedSuperAdminId;
  const u = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  cachedSuperAdminId = u?.id ?? null;
  return cachedSuperAdminId;
}

// ----------------------------------------------------------------------------
// BullMQ worker
// ----------------------------------------------------------------------------

const SCAN_JOB_NAME = "wallet-reconciliation-scan";
let walletReconciliationWorker: Worker<WalletReconciliationJobData> | null =
  null;

export async function startWalletReconciliationWorker(): Promise<void> {
  if (walletReconciliationWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[wallet-reconciliation] database unavailable; worker not started.",
    );
    return;
  }

  const q = getWalletReconciliationQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[wallet-reconciliation] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }

  walletReconciliationWorker = new Worker<WalletReconciliationJobData>(
    "wallet-reconciliation",
    async () => {
      const summary = await reconcileAllWallets();
      if (summary.drifted > 0) {
        console.warn(
          `[wallet-reconciliation] scan flagged drift on ${summary.drifted} of ${summary.scanned} wallets (clean=${summary.clean})`,
        );
      } else {
        console.log(
          `[wallet-reconciliation] scan clean — ${summary.scanned} wallet${summary.scanned === 1 ? "" : "s"} reconciled`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  walletReconciliationWorker.on("failed", (job, err) => {
    console.error(
      `[wallet-reconciliation] job ${job?.id} failed:`,
      err?.message,
    );
  });
  walletReconciliationWorker.on("error", (err) => {
    console.error("[wallet-reconciliation] worker error:", err.message);
  });

  trackWorker(walletReconciliationWorker);
}

export function stopWalletReconciliationWorker(): void {
  if (!walletReconciliationWorker) return;
  void walletReconciliationWorker.close();
  walletReconciliationWorker = null;
}
