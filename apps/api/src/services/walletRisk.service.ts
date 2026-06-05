import { Worker } from "bullmq";
import {
  prisma,
  WalletRiskAction,
  WalletRiskTier,
  type WalletRiskAssessment,
  type WalletTransactionDirection,
} from "@nexaflow/db";
import { WalletType } from "@nexaflow/shared";
import {
  getQueueConnection,
  getWalletRiskQueue,
  QueueNames,
  trackWorker,
  type WalletRiskJobData,
} from "../lib/queue";

// ----------------------------------------------------------------------------
// AI Wallet Risk Engine (PRD-v2 §8, Sprint 2).
//
// Two-layer assessment, run on a 6h schedule per tenant + on operator
// demand:
//
//   1. Deterministic math — 14-day rolling daily burn from the
//      WalletTransaction ledger. We compute the average + the 90th
//      percentile (variance signal) and project days-to-low + days-to-zero
//      against the current balance. These three numbers drive the
//      RiskTier classifier (OK / WATCH / URGENT / CRITICAL).
//
//   2. LLM narrative (skipped on OK to keep AI spend bounded). Claude
//      receives the numbers + plan info + autoRecharge state and returns
//      one of five action codes plus a short reasoning line. Action codes
//      are an enum so the UI can render them without LLM string parsing
//      — the LLM only fills in the recommended dollar amount + the
//      reasoning sentence.
//
// Uniqueness on (tenantId, dayKey) makes the writer idempotent within a
// UTC day; repeat assessments upsert into the same row so we don't bloat
// history. Time-series reads use the (tenantId, assessedAt desc) index.
// ----------------------------------------------------------------------------

const WINDOW_DAYS = 14;
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SCAN_JOB_NAME = "scan";
const BATCH_SIZE = 25;

function dayKeyUtc(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const fraction = idx - lo;
  return sorted[lo] * (1 - fraction) + sorted[hi] * fraction;
}

/**
 * Per-day debit totals over the last WINDOW_DAYS. Returns oldest-first
 * so percentile math is straightforward.
 */
async function dailyBurnSeries(
  tenantId: string,
  now: Date,
  walletId?: string,
): Promise<number[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const debits = await prisma.walletTransaction.findMany({
    where: {
      tenantId,
      ...(walletId ? { walletId } : {}),
      direction: "DEBIT" as WalletTransactionDirection,
      createdAt: { gte: since, lte: now },
    },
    select: { amountCredits: true, createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (const t of debits) {
    const key = t.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + Math.abs(t.amountCredits));
  }
  // Fill missing days with zero so the percentile math doesn't get fooled
  // by sparse data — a tenant that ran zero campaigns for 13 of 14 days
  // has a real low average even if the math denominator is the full window.
  const series: number[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    series.push(buckets.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  return series;
}

interface DeterministicResult {
  balanceCredits: number;
  lowBalanceThreshold: number;
  dailyBurnAvg: number;
  dailyBurnP90: number;
  daysToLowBalance: number | null;
  daysToZero: number | null;
  tier: WalletRiskTier;
}

/**
 * Classify the tier from the math alone. The thresholds:
 *
 *   CRITICAL — balance ≤ threshold OR daysToZero ≤ 3
 *   URGENT   — daysToZero ≤ 7 OR daysToLow ≤ 3
 *   WATCH    — daysToZero ≤ 30 OR daysToLow ≤ 14
 *   OK       — everything else
 *
 * Zero-burn tenants are clamped to OK regardless of balance; that's a
 * dormant account, not a risk.
 */
function classifyTier(input: {
  balance: number;
  lowBalanceThreshold: number;
  daysToLow: number | null;
  daysToZero: number | null;
  dailyBurnAvg: number;
}): WalletRiskTier {
  if (input.dailyBurnAvg <= 0) return WalletRiskTier.OK;
  if (
    input.balance <= input.lowBalanceThreshold ||
    (input.daysToZero !== null && input.daysToZero <= 3)
  ) {
    return WalletRiskTier.CRITICAL;
  }
  if (
    (input.daysToZero !== null && input.daysToZero <= 7) ||
    (input.daysToLow !== null && input.daysToLow <= 3)
  ) {
    return WalletRiskTier.URGENT;
  }
  if (
    (input.daysToZero !== null && input.daysToZero <= 30) ||
    (input.daysToLow !== null && input.daysToLow <= 14)
  ) {
    return WalletRiskTier.WATCH;
  }
  return WalletRiskTier.OK;
}

async function computeDeterministic(args: {
  tenantId: string;
  walletId?: string;
  balanceCredits: number;
  lowBalanceThreshold: number;
}): Promise<DeterministicResult> {
  const now = new Date();
  const series = await dailyBurnSeries(args.tenantId, now, args.walletId);
  const totalBurn = series.reduce((sum, v) => sum + v, 0);
  const dailyBurnAvg = totalBurn / WINDOW_DAYS;
  const sortedAsc = [...series].sort((a, b) => a - b);
  const dailyBurnP90 = percentile(sortedAsc, 0.9);

  const daysToZero =
    dailyBurnAvg > 0
      ? Math.max(0, args.balanceCredits) / dailyBurnAvg
      : null;
  const headroom = Math.max(
    0,
    args.balanceCredits - args.lowBalanceThreshold,
  );
  const daysToLowBalance =
    dailyBurnAvg > 0 ? headroom / dailyBurnAvg : null;

  const tier = classifyTier({
    balance: args.balanceCredits,
    lowBalanceThreshold: args.lowBalanceThreshold,
    daysToLow: daysToLowBalance,
    daysToZero,
    dailyBurnAvg,
  });

  return {
    balanceCredits: args.balanceCredits,
    lowBalanceThreshold: args.lowBalanceThreshold,
    dailyBurnAvg,
    dailyBurnP90,
    daysToLowBalance,
    daysToZero,
    tier,
  };
}

// ----------------------------------------------------------------------------
// LLM narrative (skipped on OK)
// ----------------------------------------------------------------------------

interface LlmOutput {
  recommendedActionCode: string;
  recommendedAmountCredits?: number | null;
  reasoning: string;
}

const VALID_ACTION_CODES: WalletRiskAction[] = [
  WalletRiskAction.RECHARGE,
  WalletRiskAction.ENABLE_AUTO_RECHARGE,
  WalletRiskAction.THROTTLE_CAMPAIGNS,
  WalletRiskAction.SWITCH_TO_POSTPAID,
];

async function runLlmNarrative(args: {
  tenantId: string;
  tenantName: string;
  deterministic: DeterministicResult;
  autoRechargeEnabled: boolean;
  billingMode: string;
}): Promise<{
  action: WalletRiskAction;
  amount: number | null;
  reasoning: string;
} | null> {
  // Lazy import to avoid a circular edge with ai.service.
  let runTenantLlmJson: (typeof import("./ai.service"))["runTenantLlmJson"];
  try {
    ({ runTenantLlmJson } = await import("./ai.service"));
  } catch {
    return null;
  }

  const d = args.deterministic;
  const prompt = [
    "You are NexaFlow's Wallet Risk advisor.",
    `Tenant: ${args.tenantName}`,
    `Billing mode: ${args.billingMode}`,
    `Auto-recharge enabled: ${args.autoRechargeEnabled}`,
    "WhatsApp volume is governed by wallet/rates and Meta/provider limits, not plan message quotas.",
    "",
    "Wallet snapshot:",
    `  balance_credits: ${d.balanceCredits}`,
    `  low_balance_threshold: ${d.lowBalanceThreshold}`,
    `  daily_burn_avg (14d): ${d.dailyBurnAvg.toFixed(2)}`,
    `  daily_burn_p90 (14d): ${d.dailyBurnP90.toFixed(2)}`,
    `  days_to_low_balance: ${d.daysToLowBalance?.toFixed(1) ?? "n/a"}`,
    `  days_to_zero: ${d.daysToZero?.toFixed(1) ?? "n/a"}`,
    `  classified_tier: ${d.tier}`,
    "",
    "Recommend ONE action code from this strict list:",
    "  RECHARGE — top up the wallet now.",
    "  ENABLE_AUTO_RECHARGE — they don't have it on, but should.",
    "  THROTTLE_CAMPAIGNS — burn is unsustainably high vs balance.",
    "  SWITCH_TO_POSTPAID — they're a stable high-volume tenant.",
    "",
    "If you recommend RECHARGE or ENABLE_AUTO_RECHARGE, suggest an amount",
    "(integer credits) sized to cover 30 days of avg burn rounded up to",
    "the nearest 1000.",
    "",
    "Return strict JSON:",
    '{"recommendedActionCode":"RECHARGE|...","recommendedAmountCredits":1234,"reasoning":"one short sentence"}',
  ].join("\n");

  let parsed: LlmOutput;
  try {
    parsed = await runTenantLlmJson<LlmOutput>({
      tenantId: args.tenantId,
      feature: "wallet_risk_assessment",
      system:
        "You are NexaFlow's Wallet Risk advisor. You output strict JSON. You only recommend actions from the supplied list and never invent metric values; you only reason from the snapshot we give you.",
      prompt,
      maxTokens: 400,
      temperature: 0.2,
    });
  } catch (err) {
    console.warn(
      `[wallet-risk] LLM narrative failed (tenant=${args.tenantId}):`,
      (err as Error).message,
    );
    return null;
  }

  const upper = (parsed.recommendedActionCode ?? "").toUpperCase();
  const action = (VALID_ACTION_CODES as string[]).includes(upper)
    ? (upper as WalletRiskAction)
    : WalletRiskAction.RECHARGE;

  const amt =
    parsed.recommendedAmountCredits != null &&
    Number.isFinite(Number(parsed.recommendedAmountCredits))
      ? Math.max(0, Math.round(Number(parsed.recommendedAmountCredits)))
      : null;

  return {
    action,
    amount: amt,
    reasoning: (parsed.reasoning ?? "").slice(0, 600),
  };
}

// ----------------------------------------------------------------------------
// Public entrypoint
// ----------------------------------------------------------------------------

// Tier severity ordering for escalation detection.
const TIER_RANK: Record<WalletRiskTier, number> = {
  [WalletRiskTier.OK]: 0,
  [WalletRiskTier.WATCH]: 1,
  [WalletRiskTier.URGENT]: 2,
  [WalletRiskTier.CRITICAL]: 3,
};

async function lastTierFor(tenantId: string): Promise<WalletRiskTier | null> {
  const previous = await prisma.walletRiskAssessment.findFirst({
    where: { tenantId },
    orderBy: { assessedAt: "desc" },
    select: { riskTier: true },
  });
  return previous?.riskTier ?? null;
}

/**
 * Fan out a push notification to every device in the tenant when the tier
 * escalates (OK→WATCH, WATCH→URGENT, anything→CRITICAL). De-escalations
 * are silent so we don't ping operators with good news in the middle of
 * the night. Best-effort: failures are logged and never abort the
 * assessment write.
 */
async function notifyOnEscalation(args: {
  tenantId: string;
  previousTier: WalletRiskTier | null;
  current: WalletRiskAssessment;
}): Promise<void> {
  const prev = args.previousTier ?? WalletRiskTier.OK;
  if (TIER_RANK[args.current.riskTier] <= TIER_RANK[prev]) return;

  // Lazy import — pushNotification.service depends on prisma + audit + envs;
  // keep the wallet-risk service unaware of those concerns until escalation
  // actually fires.
  let sendToTenant: typeof import("./pushNotification.service")["sendToTenant"];
  try {
    ({ sendToTenant } = await import("./pushNotification.service"));
  } catch {
    return;
  }

  const days = args.current.daysToZero;
  const runwayCopy =
    days != null && Number.isFinite(days)
      ? days < 1
        ? "less than a day of runway left"
        : `~${Math.round(days)} days of runway left`
      : "wallet balance below threshold";
  try {
    await sendToTenant(args.tenantId, {
      title: `Wallet at risk: ${args.current.riskTier}`,
      body: `${runwayCopy}. Open Wallet Risk to act.`,
      data: {
        type: "wallet_risk",
        tier: args.current.riskTier,
        assessmentId: args.current.id,
      },
    });
  } catch (err) {
    console.warn(
      `[wallet-risk] escalation push failed (tenant=${args.tenantId}):`,
      (err as Error).message,
    );
  }
}

export async function assessTenantWalletRisk(
  tenantId: string,
): Promise<WalletRiskAssessment | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      wallets: {
        where: { type: WalletType.WHATSAPP_USAGE },
        take: 1,
      },
    },
  });
  const wallet = tenant?.wallets[0];
  if (!tenant || !wallet) return null;

  const deterministic = await computeDeterministic({
    tenantId: tenant.id,
    walletId: wallet.id,
    balanceCredits: wallet.balanceCredits,
    lowBalanceThreshold: wallet.lowBalanceThreshold,
  });

  let llm: Awaited<ReturnType<typeof runLlmNarrative>> | null = null;
  if (deterministic.tier !== WalletRiskTier.OK) {
    llm = await runLlmNarrative({
      tenantId: tenant.id,
      tenantName: tenant.name,
      deterministic,
      autoRechargeEnabled: wallet.autoRechargeEnabled,
      billingMode: String(wallet.billingMode),
    });
  }

  const dayKey = dayKeyUtc();
  const data = {
    tenantId: tenant.id,
    walletId: wallet.id,
    dayKey,
    balanceCredits: deterministic.balanceCredits,
    lowBalanceThreshold: deterministic.lowBalanceThreshold,
    dailyBurnAvg: deterministic.dailyBurnAvg,
    dailyBurnP90: deterministic.dailyBurnP90,
    daysToLowBalance: deterministic.daysToLowBalance,
    daysToZero: deterministic.daysToZero,
    riskTier: deterministic.tier,
    recommendedActionCode: llm?.action ?? WalletRiskAction.NONE,
    recommendedAmountCredits: llm?.amount ?? null,
    reasoning: llm?.reasoning ?? null,
    llmUsed: !!llm,
  };

  // Capture the previous tier BEFORE the upsert so escalation detection
  // doesn't compare against the row we're about to write.
  const previousTier = await lastTierFor(tenant.id);

  const assessment = await prisma.walletRiskAssessment.upsert({
    where: { tenantId_dayKey: { tenantId: tenant.id, dayKey } },
    create: data,
    update: { ...data, assessedAt: new Date() },
  });

  // Best-effort escalation alert. Never aborts the assessment write.
  void notifyOnEscalation({
    tenantId: tenant.id,
    previousTier,
    current: assessment,
  });

  return assessment;
}

export async function getLatestAssessment(
  tenantId: string,
): Promise<WalletRiskAssessment | null> {
  return prisma.walletRiskAssessment.findFirst({
    where: { tenantId },
    orderBy: { assessedAt: "desc" },
  });
}

async function scanAllWallets(): Promise<{ assessed: number; skipped: number }> {
  const tenants = await prisma.tenant.findMany({
    where: { wallets: { some: { type: WalletType.WHATSAPP_USAGE } } },
    select: { id: true },
    take: 1000,
  });
  let assessed = 0;
  let skipped = 0;
  for (let i = 0; i < tenants.length; i += BATCH_SIZE) {
    const slice = tenants.slice(i, i + BATCH_SIZE);
    await Promise.all(
      slice.map(async (t) => {
        try {
          const result = await assessTenantWalletRisk(t.id);
          if (result) assessed += 1;
          else skipped += 1;
        } catch (err) {
          skipped += 1;
          console.warn(
            `[wallet-risk] assess failed (tenant=${t.id}):`,
            (err as Error).message,
          );
        }
      }),
    );
  }
  return { assessed, skipped };
}

// ----------------------------------------------------------------------------
// Worker lifecycle — mirrors the lead-autoscore worker pattern.
// ----------------------------------------------------------------------------

let walletRiskWorker: Worker<WalletRiskJobData> | null = null;

export async function startWalletRiskWorker(): Promise<void> {
  if (walletRiskWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[wallet-risk] database unavailable; worker not started.",
    );
    return;
  }

  const q = getWalletRiskQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[wallet-risk] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }

  walletRiskWorker = new Worker<WalletRiskJobData>(
    QueueNames.WALLET_RISK,
    async (job) => {
      if (job.name === SCAN_JOB_NAME) {
        return scanAllWallets();
      }
      const data = job.data;
      if (data && "kind" in data && data.kind === "assess") {
        const result = await assessTenantWalletRisk(data.tenantId);
        return { assessed: result ? 1 : 0 };
      }
      return { skipped: true };
    },
    { connection: getQueueConnection(), concurrency: 2 },
  );

  walletRiskWorker.on("failed", (job, err) => {
    console.error(
      `[wallet-risk] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  trackWorker(walletRiskWorker);
}

export function stopWalletRiskWorker(): void {
  if (!walletRiskWorker) return;
  void walletRiskWorker.close();
  walletRiskWorker = null;
}
