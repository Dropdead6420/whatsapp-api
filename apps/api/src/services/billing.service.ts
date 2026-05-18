import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  WalletBillingMode,
  WalletStatus,
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { adjustWalletIdempotent } from "./wallet.service";

/**
 * Per-message + per-AI-call billing hooks.
 *
 * Behind a single feature flag: `WALLET_BILLING_ENABLED`.
 * When `false` (default): every helper is a no-op so existing tenants keep
 *   working without funded wallets.
 * When `true`: pre-checks reject sends that can't be afforded; debits write
 *   idempotent ledger entries via `adjustWalletIdempotent`.
 *
 * Costs are in **credits** (integers). Defaults:
 *   - WhatsApp message: 1 credit per send
 *   - AI call: 1 credit per call (overrideable per feature via opts)
 *
 * Idempotency: every debit carries `referenceType` + `referenceId`. A replay
 * (Meta retry, our own webhook re-delivery) writes no second debit thanks to
 * the unique index on `WalletTransaction(walletId, referenceType, referenceId)`.
 */

function billingEnabled(): boolean {
  return (process.env.WALLET_BILLING_ENABLED ?? "false").toLowerCase() === "true";
}

export function getMessageCostCredits(): number {
  const raw = Number(process.env.WHATSAPP_MESSAGE_COST_CREDITS ?? "1");
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 1;
}

export function getAiCostCredits(feature?: string): number {
  // Per-feature overrides land here later (e.g. autopilot costs more than copy).
  void feature;
  const raw = Number(process.env.AI_CALL_COST_CREDITS ?? "1");
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 1;
}

/**
 * Pre-check before a WhatsApp send. Throws 402 if the wallet can't afford it.
 * Always wallet-aware in postpaid mode: succeeds as long as creditLimit allows.
 */
export async function assertCanAffordMessage(tenantId: string): Promise<void> {
  if (!billingEnabled()) return;

  const cost = getMessageCostCredits();
  const wallet = await prisma.wallet.findUnique({ where: { tenantId } });

  // A tenant with no wallet row is treated as PREPAID with balance 0.
  // Default behavior after billing-enable: refuse sends until funded.
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "No wallet allocated for this tenant. Top up before sending.",
    );
  }
  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new ApiError(ErrorCodes.FORBIDDEN, 403, "Wallet is suspended.");
  }
  const projected = wallet.balanceCredits - cost;
  if (wallet.billingMode === WalletBillingMode.PREPAID && projected < 0) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "Insufficient wallet credits. Top up before sending.",
    );
  }
  if (
    wallet.billingMode === WalletBillingMode.POSTPAID &&
    projected < -wallet.creditLimit
  ) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "Wallet credit line limit reached.",
    );
  }
}

/**
 * Post-send debit. Idempotent on the provider message id.
 * Never throws if billing is disabled. When enabled, a debit failure rolls
 * forward — we don't undo the send because Meta already accepted it. The
 * ledger captures the negative balance for reconciliation.
 */
export async function debitMessage(
  tenantId: string,
  metaMessageId: string,
  opts: { reason?: string; actorUserId?: string | null } = {},
): Promise<void> {
  if (!billingEnabled()) return;
  if (!metaMessageId) return; // can't be idempotent without an id

  try {
    await adjustWalletIdempotent({
      tenantId,
      actorUserId: opts.actorUserId ?? null,
      type: WalletTransactionType.MESSAGE_DEBIT,
      direction: WalletTransactionDirection.DEBIT,
      amountCredits: getMessageCostCredits(),
      reason: opts.reason ?? "WhatsApp message sent",
      referenceType: "Message",
      referenceId: metaMessageId,
    });
  } catch (err) {
    // The message is already on the wire. Log and continue; reconciliation
    // will catch any drift.
    console.error("[billing] debitMessage failed (send already done):", err);
  }
}

/**
 * Pre-check for an AI call. Throws 402 if the wallet can't afford it.
 */
export async function assertCanAffordAi(
  tenantId: string,
  feature?: string,
): Promise<void> {
  if (!billingEnabled()) return;

  const cost = getAiCostCredits(feature);
  const wallet = await prisma.wallet.findUnique({ where: { tenantId } });
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "No wallet allocated for this tenant. Top up before using AI features.",
    );
  }
  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new ApiError(ErrorCodes.FORBIDDEN, 403, "Wallet is suspended.");
  }
  const projected = wallet.balanceCredits - cost;
  if (wallet.billingMode === WalletBillingMode.PREPAID && projected < 0) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "Insufficient wallet credits for AI call.",
    );
  }
  if (
    wallet.billingMode === WalletBillingMode.POSTPAID &&
    projected < -wallet.creditLimit
  ) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "Wallet credit line limit reached.",
    );
  }
}

/**
 * Post-call debit for AI usage. Idempotent on the AiUsage row id when supplied.
 */
export async function debitAi(
  tenantId: string,
  args: {
    aiUsageId?: string | null;
    feature?: string;
    reason?: string;
  } = {},
): Promise<void> {
  if (!billingEnabled()) return;

  try {
    await adjustWalletIdempotent({
      tenantId,
      type: WalletTransactionType.AI_DEBIT,
      direction: WalletTransactionDirection.DEBIT,
      amountCredits: getAiCostCredits(args.feature),
      reason: args.reason ?? `AI call (${args.feature ?? "generic"})`,
      referenceType: "AiUsage",
      referenceId: args.aiUsageId ?? null,
    });
  } catch (err) {
    console.error("[billing] debitAi failed:", err);
  }
}
