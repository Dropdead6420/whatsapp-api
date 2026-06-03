import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  WalletTransactionDirection,
  WalletTransactionType,
  WalletType,
} from "@nexaflow/shared";
import {
  getQueueConnection,
  getWalletReconciliationQueue,
  trackWorker,
  type WalletReconciliationJobData,
} from "../lib/queue";
import { adjustWallet } from "./wallet.service";

// T-021: wallet auto-recharge.
//
// Wallets with autoRechargeEnabled=true AND a valid payment-method
// token get topped up automatically when they hit the low-balance
// threshold. We run on an HOURLY scheduler, dedupe by
// `lastAutoRechargeAt` (cooldown), and call into a per-provider
// "charge" implementation.
//
// We DON'T have Razorpay/Stripe API keys wired in this slice — the
// provider implementations are stubs that return a "provider not
// configured" failure. The infrastructure is ready; flipping on
// real charges requires:
//   1. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (or Stripe)
//   2. Implement chargeViaRazorpay() / chargeViaStripe() below
//   3. Tenants configure paymentMethodToken via a (TODO) settings page
//
// Stamping lastAutoRechargeAt happens regardless of success/failure
// so a stuck provider call doesn't loop-charge a card.

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SCAN_JOB_NAME = "wallet-auto-recharge-scan";
const COOLDOWN_HOURS = Number(
  process.env.AUTO_RECHARGE_COOLDOWN_HOURS ?? 6,
);
const MIN_RECHARGE_CREDITS = 100;
const MAX_RECHARGE_CREDITS = 1_000_000;

export interface ChargeOk {
  ok: true;
  providerChargeId: string;
  amountCredits: number;
}
export interface ChargeFail {
  ok: false;
  reason: string;
}
export type ChargeResult = ChargeOk | ChargeFail;

interface ChargeCandidate {
  walletId: string;
  tenantId: string;
  amountCredits: number;
  provider: string;
  paymentMethodToken: string;
}

/**
 * Per-provider charge implementations. Real integrations land here.
 * For now both return "not configured" so the operator sees the right
 * audit trail and isn't surprised by a silent no-op.
 */
async function chargeViaRazorpay(
  _c: ChargeCandidate,
): Promise<ChargeResult> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return {
      ok: false,
      reason:
        "Razorpay not configured (set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET).",
    };
  }
  // TODO: real Razorpay subscription charge / order create.
  // Tracking issue: T-021b (live payments integration).
  return {
    ok: false,
    reason: "Razorpay integration is a stub — T-021b is not yet shipped.",
  };
}

async function chargeViaStripe(
  _c: ChargeCandidate,
): Promise<ChargeResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      ok: false,
      reason: "Stripe not configured (set STRIPE_SECRET_KEY).",
    };
  }
  // TODO: real Stripe PaymentIntent create + capture.
  return {
    ok: false,
    reason: "Stripe integration is a stub — T-021b is not yet shipped.",
  };
}

function dispatchCharge(
  c: ChargeCandidate,
): Promise<ChargeResult> {
  const provider = c.provider.toLowerCase();
  if (provider === "razorpay") return chargeViaRazorpay(c);
  if (provider === "stripe") return chargeViaStripe(c);
  return Promise.resolve({
    ok: false,
    reason: `Unsupported payment provider: ${c.provider}`,
  });
}

export interface AutoRechargeAttempt {
  walletId: string;
  tenantId: string;
  result: ChargeResult;
}

export interface AutoRechargeScanSummary {
  scanned: number;
  attempted: number;
  succeeded: number;
  failed: number;
  attempts: AutoRechargeAttempt[];
}

/**
 * Run the scan: find eligible wallets, charge them, credit on success,
 * record the attempt either way.
 */
export async function scanAutoRecharge(): Promise<AutoRechargeScanSummary> {
  // Eligible = ACTIVE wallet, auto-recharge enabled, has provider +
  // token + non-zero amount, balance ≤ threshold, NOT in cooldown.
  const cooldownCutoff = new Date(
    Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000,
  );
  const candidates = await prisma.wallet.findMany({
    where: {
      status: "ACTIVE",
      type: WalletType.WHATSAPP_USAGE,
      autoRechargeEnabled: true,
      autoRechargeAmountCredits: { gt: 0 },
      // Two OR clauses: never recharged before, OR last attempt was outside cooldown.
      OR: [
        { lastAutoRechargeAt: null },
        { lastAutoRechargeAt: { lt: cooldownCutoff } },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      balanceCredits: true,
      lowBalanceThreshold: true,
      autoRechargeAmountCredits: true,
      autoRechargePaymentProvider: true,
      autoRechargePaymentMethodToken: true,
    },
  });

  const summary: AutoRechargeScanSummary = {
    scanned: candidates.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    attempts: [],
  };

  for (const w of candidates) {
    // Below-threshold check happens here (not in the SQL) because
    // `lowBalanceThreshold` is a column on the same row and Prisma
    // doesn't support column-vs-column comparisons in `where`.
    if (w.balanceCredits > w.lowBalanceThreshold) continue;

    // Config sanity — refuse to charge with missing tokens.
    if (!w.autoRechargePaymentProvider || !w.autoRechargePaymentMethodToken) {
      const fail: ChargeFail = {
        ok: false,
        reason: "Missing provider or paymentMethodToken — config incomplete.",
      };
      await stampOutcome(w.id, fail);
      summary.attempts.push({ walletId: w.id, tenantId: w.tenantId, result: fail });
      summary.attempted += 1;
      summary.failed += 1;
      continue;
    }
    // Range guard (operator could have set 0 or absurd value).
    const amount = Math.min(
      MAX_RECHARGE_CREDITS,
      Math.max(MIN_RECHARGE_CREDITS, w.autoRechargeAmountCredits),
    );

    const candidate: ChargeCandidate = {
      walletId: w.id,
      tenantId: w.tenantId,
      amountCredits: amount,
      provider: w.autoRechargePaymentProvider,
      paymentMethodToken: w.autoRechargePaymentMethodToken,
    };

    summary.attempted += 1;
    const result = await dispatchCharge(candidate);
    await stampOutcome(w.id, result);
    summary.attempts.push({
      walletId: w.id,
      tenantId: w.tenantId,
      result,
    });

    if (result.ok) {
      // Credit the wallet via the standard ledger path so the
      // reconciliation worker sees the entry as a normal CREDIT.
      try {
        await adjustWallet({
          tenantId: w.tenantId,
          walletType: WalletType.WHATSAPP_USAGE,
          actorUserId: null,
          type: WalletTransactionType.AUTO_RECHARGE,
          direction: WalletTransactionDirection.CREDIT,
          amountCredits: result.amountCredits,
          reason: `Auto-recharge via ${candidate.provider} (charge ${result.providerChargeId})`,
          referenceType: "AutoRecharge",
          referenceId: result.providerChargeId,
        });
        summary.succeeded += 1;
      } catch (err) {
        console.error(
          "[auto-recharge] credit failed AFTER provider charge — manual reconciliation needed:",
          err,
        );
        // The provider charged the card but we couldn't credit. Mark
        // failed for the summary; the audit log + provider record
        // are the receipt. Reconciliation worker will surface the
        // ledger inconsistency.
        summary.failed += 1;
      }
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

async function stampOutcome(walletId: string, result: ChargeResult): Promise<void> {
  try {
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        lastAutoRechargeAt: new Date(),
        lastAutoRechargeError: result.ok ? null : result.reason.slice(0, 500),
      },
    });
  } catch (err) {
    console.warn("[auto-recharge] stamp failed:", (err as Error).message);
  }
}

// ----------------------------------------------------------------------------
// Worker — piggybacks on the wallet-reconciliation queue.
// ----------------------------------------------------------------------------

let autoRechargeWorker: Worker<WalletReconciliationJobData> | null = null;

export async function startAutoRechargeWorker(): Promise<void> {
  if (autoRechargeWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[auto-recharge] database unavailable; worker not started.");
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
      "[auto-recharge] could not register scheduler:",
      (err as Error).message,
    );
    return;
  }
  autoRechargeWorker = new Worker<WalletReconciliationJobData>(
    "wallet-reconciliation",
    async (job) => {
      if (job.name !== SCAN_JOB_NAME) return; // not ours
      const summary = await scanAutoRecharge();
      if (summary.attempted > 0) {
        console.log(
          `[auto-recharge] scan: ${summary.attempted} attempts (${summary.succeeded} ok, ${summary.failed} failed)`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );
  autoRechargeWorker.on("failed", (job, err) => {
    if (job?.name !== SCAN_JOB_NAME) return;
    console.error(`[auto-recharge] job ${job?.id} failed:`, err?.message);
  });
  trackWorker(autoRechargeWorker);
}

export function stopAutoRechargeWorker(): void {
  if (!autoRechargeWorker) return;
  void autoRechargeWorker.close();
  autoRechargeWorker = null;
}
