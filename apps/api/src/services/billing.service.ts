import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  WalletBillingMode,
  WalletStatus,
  WalletTransactionDirection,
  WalletTransactionType,
  WalletType,
} from "@nexaflow/shared";
import { adjustWalletIdempotent, ensureWallet } from "./wallet.service";
import { resolveCost, KNOWN_CREDIT_ACTIONS } from "./creditRule.service";

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
 *   - AI call: 1 credit per call
 *     - Global override: `AI_CALL_COST_CREDITS`
 *     - Per-feature override: `AI_CALL_COST_CREDITS_CAMPAIGN_AUTOPILOT`
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

/**
 * DB-aware WhatsApp send cost: the SuperAdmin's `whatsapp.send` Credit Engine
 * rule wins, then the env override, then the default — so per-send pricing is
 * admin-controlled like AI costs. Falls back safely on any lookup error.
 * (activeCreditRules + resolveCost are defined below with the AI resolver.)
 */
export async function resolveMessageCostCredits(): Promise<number> {
  try {
    const cost = resolveCost(await activeCreditRules(), "whatsapp.send");
    if (cost != null && Number.isFinite(cost) && cost >= 0) return Math.ceil(cost);
  } catch (err) {
    console.warn("[billing] credit-rule lookup failed; using env/default message cost:", (err as Error).message);
  }
  return getMessageCostCredits();
}

function aiFeatureCostEnvKey(feature?: string): string | null {
  const suffix = feature
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return suffix ? `AI_CALL_COST_CREDITS_${suffix}` : null;
}

export function getAiCostCredits(feature?: string): number {
  const featureEnvKey = aiFeatureCostEnvKey(feature);
  const configured =
    featureEnvKey && process.env[featureEnvKey]
      ? process.env[featureEnvKey]
      : process.env.AI_CALL_COST_CREDITS;
  const raw = Number(configured ?? "1");
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 1;
}

// Maps internal AI feature keys → SuperAdmin Credit Engine catalog actions, so
// the per-action costs configured at /credit-rules actually apply to charging.
// Unmapped features fall through to the env/default cost (getAiCostCredits).
export const AI_FEATURE_ACTION: Record<string, string> = {
  gmb_review_reply: "ai.review_reply",
  gmb_post_caption: "ai.post",
  gmb_keyword_finder: "ai.keyword_ideas",
  gmb_description_optimizer: "ai.description",
  gmb_ranking_advisor: "ai.ranking_advice",
  gmb_report: "ai.report",
  gmb_image_generation: "ai.image",
};

// Short-lived cache of active credit rules so per-call cost lookups don't hit
// the DB every time. The afford-check and the debit happen seconds apart in one
// request, so a 60s TTL keeps them consistent without staleness risk.
let creditRuleCache: { at: number; rules: { action: string; cost: number; isActive: boolean }[] } | null = null;
const CREDIT_RULE_TTL_MS = 60_000;

async function activeCreditRules(): Promise<{ action: string; cost: number; isActive: boolean }[]> {
  const now = Date.now();
  if (creditRuleCache && now - creditRuleCache.at < CREDIT_RULE_TTL_MS) {
    return creditRuleCache.rules;
  }
  const rules = await prisma.creditRule.findMany({
    where: { isActive: true },
    select: { action: true, cost: true, isActive: true },
  });
  creditRuleCache = { at: now, rules };
  return rules;
}

/**
 * DB-aware AI cost resolution: the SuperAdmin's Credit Engine rule for the
 * feature's mapped action wins, then the per-feature env override, then the
 * flat default. This is what makes the admin Credit Engine actually control
 * spend instead of being cosmetic.
 */
export async function resolveAiCostCredits(feature?: string): Promise<number> {
  const action = feature ? AI_FEATURE_ACTION[feature] : undefined;
  if (action) {
    try {
      const cost = resolveCost(await activeCreditRules(), action);
      if (cost != null && Number.isFinite(cost) && cost >= 0) return Math.ceil(cost);
    } catch (err) {
      console.warn("[billing] credit-rule lookup failed; using env/default cost:", (err as Error).message);
    }
  }
  return getAiCostCredits(feature);
}

/**
 * The current per-action credit cost of each GMB AI feature, for customer-
 * facing "this costs N credits" hints. Labels come from the Credit Engine
 * catalog so admin renames flow through. When billing is disabled, costs are
 * effectively 0 (nothing is charged).
 */
export async function listGmbAiCosts(): Promise<{ feature: string; label: string; credits: number }[]> {
  const labelByAction = new Map(KNOWN_CREDIT_ACTIONS.map((a) => [a.action, a.label]));
  const charging = billingEnabled();
  const out: { feature: string; label: string; credits: number }[] = [];
  for (const [feature, action] of Object.entries(AI_FEATURE_ACTION)) {
    out.push({
      feature,
      label: labelByAction.get(action) ?? action,
      credits: charging ? await resolveAiCostCredits(feature) : 0,
    });
  }
  return out;
}

/**
 * Pre-check before a WhatsApp send. Throws 402 if the wallet can't afford it.
 * Always wallet-aware in postpaid mode: succeeds as long as creditLimit allows.
 */
export async function assertCanAffordMessage(tenantId: string): Promise<void> {
  if (!billingEnabled()) return;

  const cost = await resolveMessageCostCredits();
  const wallet = await prisma.wallet.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: WalletType.WHATSAPP_USAGE,
      },
    },
  });

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
      walletType: WalletType.WHATSAPP_USAGE,
      direction: WalletTransactionDirection.DEBIT,
      amountCredits: await resolveMessageCostCredits(),
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

  const cost = await resolveAiCostCredits(feature);
  const wallet = await prisma.wallet.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: WalletType.AI_CREDIT,
      },
    },
  });
  if (!wallet) {
    // Create a separate AI wallet row on first AI use, then fail with a
    // clear "top up AI credits" message. This keeps WhatsApp credits
    // isolated instead of silently spending them on model calls.
    await ensureWallet(tenantId, WalletType.AI_CREDIT);
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "No AI credits available. Top up the AI Credit Wallet before using AI features.",
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
      walletType: WalletType.AI_CREDIT,
      direction: WalletTransactionDirection.DEBIT,
      amountCredits: await resolveAiCostCredits(args.feature),
      reason: args.reason ?? `AI call (${args.feature ?? "generic"})`,
      referenceType: "AiUsage",
      referenceId: args.aiUsageId ?? null,
    });
  } catch (err) {
    console.error("[billing] debitAi failed:", err);
  }
}
