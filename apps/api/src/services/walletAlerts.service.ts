import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import { buildLowBalanceEmail, sendEmail } from "./email.service";
import {
  getQueueConnection,
  getWalletReconciliationQueue,
  trackWorker,
  type WalletReconciliationJobData,
} from "../lib/queue";

// Low-balance email alerts. Uses an HOURLY scan (cheap, no schema
// changes) and de-duplicates against AuditLog so each tenant only
// gets one alert per 24h regardless of how many times we scan.
//
// Why no dedicated queue + worker: the reconciliation worker already
// runs every 6h on the same connection, and adding another every-hour
// scheduler for ~10 lines of code creates more moving parts than it's
// worth. We piggyback on the existing wallet-reconciliation queue
// with a different job name; the worker dispatch in this file handles
// only the `low-balance-scan` job name.

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCAN_JOB_NAME = "wallet-low-balance-scan";

export interface LowBalanceAlertResult {
  tenantId: string;
  walletId: string;
  balanceCredits: number;
  threshold: number;
  isEmpty: boolean;
  notifiedCount: number;
  skippedReason: string | null;
}

/**
 * Scan every wallet, send a low-balance email if balanceCredits <=
 * lowBalanceThreshold AND no LOW_BALANCE_ALERT audit row exists in
 * the last 24h for that tenant.
 *
 * Exported so an operator can trigger it manually from the admin UI.
 */
export async function scanLowBalanceAlerts(): Promise<{
  scanned: number;
  alerted: LowBalanceAlertResult[];
  skipped: LowBalanceAlertResult[];
}> {
  // Pull only wallets that are AT OR BELOW their threshold. Saves us
  // a Prisma roundtrip per wallet that isn't actually low.
  const lowWallets = await prisma.$queryRaw<
    Array<{
      id: string;
      tenantId: string;
      balanceCredits: number;
      lowBalanceThreshold: number;
    }>
  >`
    SELECT id, "tenantId", "balanceCredits", "lowBalanceThreshold"
    FROM "Wallet"
    WHERE "balanceCredits" <= "lowBalanceThreshold"
      AND status = 'ACTIVE'
      AND type = 'WHATSAPP_USAGE'
  `;

  const alerted: LowBalanceAlertResult[] = [];
  const skipped: LowBalanceAlertResult[] = [];
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS);

  for (const w of lowWallets) {
    const result: LowBalanceAlertResult = {
      tenantId: w.tenantId,
      walletId: w.id,
      balanceCredits: w.balanceCredits,
      threshold: w.lowBalanceThreshold,
      isEmpty: w.balanceCredits <= 0,
      notifiedCount: 0,
      skippedReason: null,
    };

    // Dedupe: any LOW_BALANCE_ALERT for this tenant in the last 24h?
    const recent = await prisma.auditLog.findFirst({
      where: {
        tenantId: w.tenantId,
        action: "LOW_BALANCE_ALERT",
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) {
      result.skippedReason = "alerted_within_24h";
      skipped.push(result);
      continue;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: w.tenantId },
      select: { name: true },
    });
    if (!tenant) {
      result.skippedReason = "tenant_missing";
      skipped.push(result);
      continue;
    }

    const admins = await prisma.user.findMany({
      where: {
        tenantId: w.tenantId,
        role: "BUSINESS_ADMIN",
        status: "ACTIVE",
      },
      select: { id: true, email: true, name: true },
      take: 5,
    });
    if (admins.length === 0) {
      result.skippedReason = "no_business_admins";
      skipped.push(result);
      continue;
    }

    let sent = 0;
    for (const a of admins) {
      try {
        await sendEmail(
          buildLowBalanceEmail({
            to: a.email,
            recipientName: a.name?.split(" ")[0] || "there",
            tenantName: tenant.name,
            balanceCredits: w.balanceCredits,
            threshold: w.lowBalanceThreshold,
            isEmpty: result.isEmpty,
          }),
        );
        sent += 1;
      } catch (err) {
        console.warn(
          `[wallet-alerts] email send failed for ${a.email}:`,
          (err as Error).message,
        );
      }
    }
    result.notifiedCount = sent;

    // Audit row stamps the dedupe window. Use the first admin as the
    // recipient-of-record so the audit table has a coherent userId
    // (avoiding the "system" placeholder used in reconciliation).
    if (sent > 0) {
      try {
        await prisma.auditLog.create({
          data: {
            tenantId: w.tenantId,
            userId: admins[0].id,
            action: "LOW_BALANCE_ALERT",
            resource: "Wallet",
            resourceId: w.id,
            newValues: JSON.stringify({
              balanceCredits: w.balanceCredits,
              threshold: w.lowBalanceThreshold,
              recipients: admins.map((a) => a.email),
            }),
          },
        });
      } catch (err) {
        console.warn(
          "[wallet-alerts] audit write failed (non-fatal):",
          (err as Error).message,
        );
      }
      alerted.push(result);
    } else {
      result.skippedReason = "all_sends_failed";
      skipped.push(result);
    }
  }

  return { scanned: lowWallets.length, alerted, skipped };
}

// ----------------------------------------------------------------------------
// Worker — piggybacks on the wallet-reconciliation queue with a distinct
// job name. Same connection, different scheduler.
// ----------------------------------------------------------------------------

let lowBalanceWorker: Worker<WalletReconciliationJobData> | null = null;

export async function startWalletAlertsWorker(): Promise<void> {
  if (lowBalanceWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[wallet-alerts] database unavailable; worker not started.",
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
      "[wallet-alerts] could not register scheduler:",
      (err as Error).message,
    );
    return;
  }

  lowBalanceWorker = new Worker<WalletReconciliationJobData>(
    "wallet-reconciliation",
    async (job) => {
      // We share the queue with reconciliation; only handle our job.
      if (job.name !== SCAN_JOB_NAME) return;
      const summary = await scanLowBalanceAlerts();
      if (summary.alerted.length > 0) {
        console.log(
          `[wallet-alerts] alerted ${summary.alerted.length} tenant(s), skipped ${summary.skipped.length}`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );
  lowBalanceWorker.on("failed", (job, err) => {
    if (job?.name !== SCAN_JOB_NAME) return; // not ours
    console.error(`[wallet-alerts] job ${job?.id} failed:`, err?.message);
  });
  trackWorker(lowBalanceWorker);
}

export function stopWalletAlertsWorker(): void {
  if (!lowBalanceWorker) return;
  void lowBalanceWorker.close();
  lowBalanceWorker = null;
}
