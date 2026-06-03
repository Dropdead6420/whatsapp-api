import { Worker } from "bullmq";
import {
  prisma,
  CreditLineStatus,
  CustomerHealthTier,
  PlatformActionCode,
  PlatformActionSeverity,
  PlatformActionStatus,
  TenantType,
  WalletRiskTier,
  WhatsAppProviderKey,
  ComplianceVerdict,
  type Prisma,
} from "@nexaflow/db";
import {
  getPlatformMonitorQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type PlatformMonitorJobData,
} from "../lib/queue";

// ----------------------------------------------------------------------------
// AI Platform Monitor / Autonomous SaaS Operator (PRD-v2 §8, Sprint 2).
//
// The SuperAdmin's triage queue. The scheduled scan ingests signals from
// the other Sprint-2 engines (Wallet Risk, Compliance Firewall, Provider
// Router) and writes PlatformActionItem rows. dedupeKey lets the scan
// upsert cleanly so a condition that holds across multiple scans
// converges on a single row, not a stack of duplicates.
//
// Slice 1 (this file) implements the deterministic signal gatherers.
// Slice 2 will add an LLM "daily plan" summary on top + push alerts
// when a HIGH/URGENT item lands.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SCAN_JOB_NAME = "scan";

// Daily SuperAdmin summary push (Sprint 6 slice 4). Runs every 24h so the
// platform owner gets one morning-briefing push per day. The dispatcher
// itself decides whether to push (URGENT/HIGH items present) so the
// 24h cadence doesn't translate to a guaranteed daily noise tap.
const SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUMMARY_JOB_NAME = "summary";

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Helper that turns the gathered signal into a stable upsert. dedupeKey
// embeds the day so we get one row per condition per day; the body /
// severity / context can move from scan to scan as the underlying
// numbers change.
async function upsertItem(args: {
  code: PlatformActionCode;
  severity: PlatformActionSeverity;
  title: string;
  body: string;
  targetTenantId?: string | null;
  context?: Record<string, unknown>;
  dedupeKey: string;
}) {
  const baseData = {
    code: args.code,
    severity: args.severity,
    title: args.title,
    body: args.body,
    targetTenantId: args.targetTenantId ?? null,
    context: (args.context ?? {}) as Prisma.InputJsonValue,
  };
  return prisma.platformActionItem.upsert({
    where: { dedupeKey: args.dedupeKey },
    create: { ...baseData, dedupeKey: args.dedupeKey },
    update: {
      ...baseData,
      // Re-open if a resolved item is observed again the next day —
      // operators should see it back in the queue.
      status: PlatformActionStatus.OPEN,
      resolvedAt: null,
      resolvedByUserId: null,
      snoozedUntil: null,
    },
  });
}

// ----------------------------------------------------------------------------
// Wallet-risk signals — every CRITICAL or URGENT assessment in the last
// 24h becomes an item. severity maps directly (CRITICAL→URGENT,
// URGENT→HIGH); the body cites days-to-zero so the operator can act
// without clicking into the wallet page first.
// ----------------------------------------------------------------------------

async function gatherWalletRiskSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await prisma.walletRiskAssessment.findMany({
    where: {
      assessedAt: { gte: since },
      riskTier: { in: [WalletRiskTier.CRITICAL, WalletRiskTier.URGENT] },
    },
    select: {
      id: true,
      tenantId: true,
      riskTier: true,
      daysToZero: true,
      balanceCredits: true,
      recommendedActionCode: true,
      tenant: { select: { name: true } },
    },
    orderBy: { assessedAt: "desc" },
    take: 500,
  });

  // De-dup by tenant: keep the freshest assessment per tenant (the
  // findMany is already ordered desc).
  const byTenant = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, row);
  }

  let written = 0;
  const today = dayKey(now);
  for (const row of byTenant.values()) {
    const isCritical = row.riskTier === WalletRiskTier.CRITICAL;
    const code = isCritical
      ? PlatformActionCode.WALLET_RISK_CRITICAL
      : PlatformActionCode.WALLET_RISK_URGENT;
    const severity = isCritical
      ? PlatformActionSeverity.URGENT
      : PlatformActionSeverity.HIGH;
    const days =
      row.daysToZero != null && Number.isFinite(row.daysToZero)
        ? row.daysToZero < 1
          ? "less than a day"
          : `~${Math.round(row.daysToZero)} days`
        : "balance below threshold";
    await upsertItem({
      code,
      severity,
      title: `${row.tenant.name}: wallet ${row.riskTier}`,
      body: `${days} of runway left. Suggested action: ${row.recommendedActionCode}.`,
      targetTenantId: row.tenantId,
      context: {
        assessmentId: row.id,
        riskTier: row.riskTier,
        daysToZero: row.daysToZero,
        balanceCredits: row.balanceCredits,
        recommendedActionCode: row.recommendedActionCode,
      },
      dedupeKey: `${code}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Compliance signals — tenants with ≥3 BLOCK verdicts in the last 24h get
// a single COMPLIANCE_BLOCK_SPIKE item rather than one per check. The
// context carries the most-recent block IDs so the operator can click
// through.
// ----------------------------------------------------------------------------

const BLOCK_SPIKE_THRESHOLD = 3;

async function gatherComplianceSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const grouped = await prisma.complianceCheck.groupBy({
    by: ["tenantId"],
    _count: { _all: true },
    where: {
      createdAt: { gte: since },
      verdict: ComplianceVerdict.BLOCK,
    },
    having: { tenantId: { _count: { gte: BLOCK_SPIKE_THRESHOLD } } },
    orderBy: { _count: { tenantId: "desc" } },
    take: 200,
  });
  if (grouped.length === 0) return 0;

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: grouped.map((g) => g.tenantId) } },
    select: { id: true, name: true },
  });
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  let written = 0;
  const today = dayKey(now);
  for (const row of grouped) {
    const recent = await prisma.complianceCheck.findMany({
      where: {
        tenantId: row.tenantId,
        verdict: ComplianceVerdict.BLOCK,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, scope: true, score: true },
    });

    await upsertItem({
      code: PlatformActionCode.COMPLIANCE_BLOCK_SPIKE,
      severity:
        row._count._all >= 10
          ? PlatformActionSeverity.URGENT
          : PlatformActionSeverity.HIGH,
      title: `${tenantName.get(row.tenantId) ?? "Tenant"}: ${row._count._all} compliance blocks`,
      body: `Compliance Firewall blocked ${row._count._all} outbound items in the last 24h. Investigate content quality / forbidden phrases.`,
      targetTenantId: row.tenantId,
      context: {
        blockCount24h: row._count._all,
        recentCheckIds: recent.map((r) => r.id),
        recentScopes: recent.map((r) => r.scope),
      },
      dedupeKey: `${PlatformActionCode.COMPLIANCE_BLOCK_SPIKE}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Customer churn risk signals (Sprint 6 slice 8). The CustomerHealthScore
// engine (Sprint 3) writes a daily score + tier per tenant; the AI Partner
// Assistant already pushes to the owning partner when a tenant flips into
// AT_RISK or CHURNING. The SuperAdmin queue, however, was blind to this —
// a platform-wide wave of churning customers wouldn't surface anywhere.
//
// This gatherer reads today's CustomerHealthScore rows once and writes a
// PlatformActionItem for each tenant currently in AT_RISK or CHURNING.
// Same severity-tier mapping as the partner push: CHURNING is URGENT,
// AT_RISK is HIGH. Already-resolved items re-open on the next scan if
// the tenant is still bad — exactly the existing PlatformActionItem
// pattern.
// ----------------------------------------------------------------------------

export interface ChurnRiskClassification {
  severity: PlatformActionSeverity | null;
}

/**
 * Pure tier → severity mapping — exported for tests.
 *
 *   CHURNING    → URGENT (already at the bottom of the score band)
 *   AT_RISK     → HIGH   (still recoverable, but slipping)
 *   HEALTHY     → null   (no item)
 *   THRIVING    → null   (no item)
 */
export function classifyChurnRisk(tier: CustomerHealthTier): ChurnRiskClassification {
  if (tier === CustomerHealthTier.CHURNING) {
    return { severity: PlatformActionSeverity.URGENT };
  }
  if (tier === CustomerHealthTier.AT_RISK) {
    return { severity: PlatformActionSeverity.HIGH };
  }
  return { severity: null };
}

async function gatherChurnRiskSignals(now: Date): Promise<number> {
  const today = dayKey(now);
  const rows = await prisma.customerHealthScore.findMany({
    where: {
      dayKey: today,
      tier: { in: [CustomerHealthTier.AT_RISK, CustomerHealthTier.CHURNING] },
    },
    select: {
      tenantId: true,
      score: true,
      tier: true,
      recommendation: true,
      assessedAt: true,
      tenant: { select: { name: true, parentTenantId: true } },
    },
    orderBy: { score: "asc" },
    take: 200,
  });
  if (rows.length === 0) return 0;

  let written = 0;
  for (const row of rows) {
    const classification = classifyChurnRisk(row.tier);
    if (!classification.severity) continue;
    const recommendation = row.recommendation?.trim();
    await upsertItem({
      code: PlatformActionCode.CHURN_RISK,
      severity: classification.severity,
      title: `${row.tenant.name}: ${row.tier} (score ${row.score})`,
      body: recommendation
        ? recommendation
        : `${row.tenant.name} is in ${row.tier} (health score ${row.score}). ` +
          (row.tier === CustomerHealthTier.CHURNING
            ? "Open the partner's customer dashboard to plan a rescue play."
            : "Pre-emptive outreach can usually pull AT_RISK tenants back."),
      targetTenantId: row.tenantId,
      context: {
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        partnerTenantId: row.tenant.parentTenantId,
        tier: row.tier,
        score: row.score,
      },
      dedupeKey: `${PlatformActionCode.CHURN_RISK}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Onboarding-stalled signals (Sprint 6 slice 9). The onboarding.service
// already computes 4 deterministic steps per tenant from existing tables
// (WhatsApp connected, contacts imported, agent created, message sent).
// A new BUSINESS tenant that's been around for a week+ without completing
// any of those steps is stuck — the operator (or the owning partner)
// should reach out before the tenant churns.
//
// We deliberately bound the window to 7-30 days. Younger than 7 days
// is too early to call "stalled" — first-week effort spikes are common.
// Older than 30 days flows to the CustomerHealthScore engine (CHURN_RISK
// already surfaces these), so we don't want to duplicate the noise.
// ----------------------------------------------------------------------------

const ONBOARDING_STALL_MIN_AGE_DAYS = 7;
const ONBOARDING_STALL_MAX_AGE_DAYS = 30;
const ONBOARDING_HIGH_TIER_AGE_DAYS = 14;

export interface OnboardingStallClassification {
  severity: PlatformActionSeverity | null;
}

/**
 * Pure classifier — exported for tests.
 *
 *   age < 7 days                                  → null (too early)
 *   age >= 30 days                                → null (CHURN_RISK owns this)
 *   completedSteps == totalSteps                  → null (not stalled)
 *   age 14-30 days AND completedSteps <= 2        → HIGH (worrying)
 *   age 7-14 days AND completedSteps <= 1         → MEDIUM (still recoverable)
 *   else                                          → null (acceptable progress)
 */
export function classifyOnboardingStall(args: {
  accountAgeDays: number;
  completedSteps: number;
  totalSteps: number;
}): OnboardingStallClassification {
  if (args.accountAgeDays < ONBOARDING_STALL_MIN_AGE_DAYS) {
    return { severity: null };
  }
  if (args.accountAgeDays >= ONBOARDING_STALL_MAX_AGE_DAYS) {
    return { severity: null };
  }
  if (args.completedSteps >= args.totalSteps) {
    return { severity: null };
  }
  if (
    args.accountAgeDays >= ONBOARDING_HIGH_TIER_AGE_DAYS &&
    args.completedSteps <= 2
  ) {
    return { severity: PlatformActionSeverity.HIGH };
  }
  if (
    args.accountAgeDays >= ONBOARDING_STALL_MIN_AGE_DAYS &&
    args.completedSteps <= 1
  ) {
    return { severity: PlatformActionSeverity.MEDIUM };
  }
  return { severity: null };
}

async function gatherOnboardingStalledSignals(now: Date): Promise<number> {
  const maxAge = new Date(
    now.getTime() - ONBOARDING_STALL_MAX_AGE_DAYS * 86_400_000,
  );
  const minAge = new Date(
    now.getTime() - ONBOARDING_STALL_MIN_AGE_DAYS * 86_400_000,
  );
  const tenants = await prisma.tenant.findMany({
    where: {
      type: TenantType.BUSINESS,
      status: "ACTIVE",
      createdAt: { gte: maxAge, lt: minAge },
    },
    select: { id: true, name: true, parentTenantId: true, createdAt: true },
    take: 200,
  });
  if (tenants.length === 0) return 0;

  // Reuse the existing onboarding signal source — never duplicate the
  // step-completion logic so the queue and the in-app onboarding page
  // can't drift. Lazy import keeps platformMonitor's circular-edge
  // surface minimal.
  const { getOnboardingStatus } = await import("./onboarding.service");
  let written = 0;
  const today = dayKey(now);
  for (const tenant of tenants) {
    const accountAgeDays = Math.floor(
      (now.getTime() - tenant.createdAt.getTime()) / 86_400_000,
    );
    let status;
    try {
      status = await getOnboardingStatus(tenant.id);
    } catch (err) {
      console.warn(
        `[platform-monitor] onboarding status failed for ${tenant.id}:`,
        (err as Error).message,
      );
      continue;
    }
    const classification = classifyOnboardingStall({
      accountAgeDays,
      completedSteps: status.completedSteps,
      totalSteps: status.totalSteps,
    });
    if (!classification.severity) continue;

    const remainingSteps = status.steps.filter((s) => !s.done).map((s) => s.key);
    await upsertItem({
      code: PlatformActionCode.ONBOARDING_STALLED,
      severity: classification.severity,
      title: `${tenant.name}: stalled at ${status.completedSteps}/${status.totalSteps} steps`,
      body:
        `${tenant.name} signed up ${accountAgeDays} day${accountAgeDays === 1 ? "" : "s"} ago ` +
        `but has only completed ${status.completedSteps} of ${status.totalSteps} onboarding steps. ` +
        `Next blockers: ${remainingSteps.slice(0, 2).join(", ") || "(none surfaced)"}. ` +
        "Reach out before they churn.",
      targetTenantId: tenant.id,
      context: {
        tenantId: tenant.id,
        tenantName: tenant.name,
        partnerTenantId: tenant.parentTenantId,
        accountAgeDays,
        completedSteps: status.completedSteps,
        totalSteps: status.totalSteps,
        remainingSteps,
      },
      dedupeKey: `${PlatformActionCode.ONBOARDING_STALLED}:${tenant.id}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// AI usage spike signals (Sprint 6 slice 2). A tenant whose 24h AI spend
// is multiples of their own 7-day rolling daily average raises an
// AI_USAGE_SPIKE PlatformActionItem. Alert-only: unlike webhook auto-
// disable, we do NOT auto-throttle AI here — a "spike" might be an
// intentional campaign push, auto-throttling would silently break Flows
// / AI Agents / autopilot, and the wallet already has its own circuit
// breaker (assertCanAffordAi). Operator decides.
//
// Signal is unit-independent so tenants without an aiCreditsPerMonth
// budget configured still get monitored, and new tenants with no
// baseline naturally skip (no 7-day average).
// ----------------------------------------------------------------------------

const AI_SPIKE_MIN_24H_CENTS = 500; // absolute floor — don't escalate $1 "spikes"
const AI_SPIKE_HIGH_MULTIPLIER = 3;
const AI_SPIKE_URGENT_MULTIPLIER = 5;

export interface AiSpikeClassification {
  severity: PlatformActionSeverity | null;
  multiplier: number;
}

/**
 * Pure classifier for a tenant's 24h AI spend vs its own 7-day daily
 * average — exported for tests.
 *
 *   spend24hCents < $5 floor            → null (too small to act on)
 *   sevenDayAvgCents <= 0 (new tenant)  → null (no baseline)
 *   24h >= 5x baseline                  → URGENT
 *   24h >= 3x baseline                  → HIGH
 *   else                                → null
 */
export function classifyAiUsageSpike(args: {
  spend24hCents: number;
  sevenDayAvgCents: number;
}): AiSpikeClassification {
  if (args.spend24hCents < AI_SPIKE_MIN_24H_CENTS) {
    return { severity: null, multiplier: 0 };
  }
  if (args.sevenDayAvgCents <= 0) {
    return { severity: null, multiplier: 0 };
  }
  const multiplier = args.spend24hCents / args.sevenDayAvgCents;
  if (multiplier >= AI_SPIKE_URGENT_MULTIPLIER) {
    return { severity: PlatformActionSeverity.URGENT, multiplier };
  }
  if (multiplier >= AI_SPIKE_HIGH_MULTIPLIER) {
    return { severity: PlatformActionSeverity.HIGH, multiplier };
  }
  return { severity: null, multiplier };
}

async function gatherAiUsageSpikeSignals(now: Date): Promise<number> {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 24h sums and 7d sums per tenant, in two grouped queries. The 7d
  // window deliberately overlaps the 24h window — the average is over
  // the longer span (cents/7), so a sustained high day is the spike
  // even if it's pulling its own baseline up.
  const [spend24h, spend7d] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["tenantId"],
      where: { createdAt: { gte: since24h } },
      _sum: { costInCents: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["tenantId"],
      where: { createdAt: { gte: since7d } },
      _sum: { costInCents: true },
    }),
  ]);

  const sevenDayMap = new Map<string, number>();
  for (const row of spend7d) {
    sevenDayMap.set(row.tenantId, row._sum.costInCents ?? 0);
  }

  const candidates: Array<{
    tenantId: string;
    spend24hCents: number;
    sevenDayAvgCents: number;
    classification: AiSpikeClassification;
  }> = [];
  for (const row of spend24h) {
    const spend24hCents = row._sum.costInCents ?? 0;
    const totalSevenDayCents = sevenDayMap.get(row.tenantId) ?? 0;
    const sevenDayAvgCents = totalSevenDayCents / 7;
    const classification = classifyAiUsageSpike({
      spend24hCents,
      sevenDayAvgCents,
    });
    if (classification.severity) {
      candidates.push({
        tenantId: row.tenantId,
        spend24hCents,
        sevenDayAvgCents,
        classification,
      });
    }
  }
  if (candidates.length === 0) return 0;

  // One name lookup for the candidates so the action title is readable
  // without a join on every refresh.
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: candidates.map((c) => c.tenantId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(tenants.map((t) => [t.id, t.name]));

  let written = 0;
  const today = dayKey(now);
  for (const c of candidates) {
    const tenantName = nameMap.get(c.tenantId) ?? c.tenantId;
    const usd = (c.spend24hCents / 100).toFixed(2);
    const baselineUsd = (c.sevenDayAvgCents / 100).toFixed(2);
    await upsertItem({
      code: PlatformActionCode.AI_USAGE_SPIKE,
      severity: c.classification.severity!,
      title: `${tenantName}: AI spend ${c.classification.multiplier.toFixed(1)}× baseline`,
      body:
        `${tenantName} spent $${usd} on AI in the last 24h vs $${baselineUsd}/day rolling average. ` +
        "Verify the burn is intentional (campaign, bulk action) or contact the tenant.",
      targetTenantId: c.tenantId,
      context: {
        tenantId: c.tenantId,
        tenantName,
        spend24hCents: c.spend24hCents,
        sevenDayAvgCents: Math.round(c.sevenDayAvgCents),
        multiplier: c.classification.multiplier,
      },
      dedupeKey: `${PlatformActionCode.AI_USAGE_SPIKE}:${c.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Webhook failure signals — a tenant whose outbound webhook is failing
// at high rate in the last 24h shows up as WEBHOOK_FAILURE_SPIKE. The
// auto-heal action (slice 1 reliability slice): a catastrophic 95%+
// failure rate on ≥20 events flips Webhook.isActive=false so the
// dispatcher stops hammering a clearly-dead endpoint. The Webhook row
// stays — operator/tenant can re-enable manually after fixing the
// upstream issue.
// ----------------------------------------------------------------------------

const WEBHOOK_MIN_VOLUME = 10;
const WEBHOOK_HIGH_RATE = 0.5;
const WEBHOOK_URGENT_RATE = 0.8;
const WEBHOOK_AUTO_DISABLE_RATE = 0.95;
const WEBHOOK_AUTO_DISABLE_MIN_VOLUME = 20;

export interface WebhookClassification {
  severity: PlatformActionSeverity | null;
  shouldAutoDisable: boolean;
  rate: number;
}

/**
 * Pure classifier for a webhook's 24h reliability — exported for tests.
 *
 *   total < 10                                  → null (too small to judge)
 *   95%+ failures AND total >= 20               → URGENT + auto-disable
 *   80%+ failures                               → URGENT
 *   50%+ failures                               → HIGH
 *   else                                        → null
 */
export function classifyWebhookHealth(args: {
  total: number;
  failures: number;
}): WebhookClassification {
  if (args.total < WEBHOOK_MIN_VOLUME) {
    return { severity: null, shouldAutoDisable: false, rate: 0 };
  }
  const rate = args.failures / args.total;
  if (
    rate >= WEBHOOK_AUTO_DISABLE_RATE &&
    args.total >= WEBHOOK_AUTO_DISABLE_MIN_VOLUME
  ) {
    return {
      severity: PlatformActionSeverity.URGENT,
      shouldAutoDisable: true,
      rate,
    };
  }
  if (rate >= WEBHOOK_URGENT_RATE) {
    return { severity: PlatformActionSeverity.URGENT, shouldAutoDisable: false, rate };
  }
  if (rate >= WEBHOOK_HIGH_RATE) {
    return { severity: PlatformActionSeverity.HIGH, shouldAutoDisable: false, rate };
  }
  return { severity: null, shouldAutoDisable: false, rate };
}

async function gatherWebhookFailureSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // WebhookLog has no tenantId column; group by webhookId, then resolve
  // tenant + active state in one Webhook query keyed by the same ids.
  const totals = await prisma.webhookLog.groupBy({
    by: ["webhookId"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  if (totals.length === 0) return 0;

  const failures = await prisma.webhookLog.groupBy({
    by: ["webhookId"],
    where: {
      createdAt: { gte: since },
      OR: [
        { statusCode: { gte: 400 } },
        { statusCode: null }, // dispatcher never got a response
        { error: { not: null } },
      ],
    },
    _count: { _all: true },
  });
  const failureMap = new Map<string, number>();
  for (const f of failures) failureMap.set(f.webhookId, f._count._all);

  const candidates: Array<{
    webhookId: string;
    total: number;
    failures: number;
    classification: WebhookClassification;
  }> = [];
  for (const row of totals) {
    const total = row._count._all;
    const fails = failureMap.get(row.webhookId) ?? 0;
    const classification = classifyWebhookHealth({ total, failures: fails });
    if (classification.severity) {
      candidates.push({ webhookId: row.webhookId, total, failures: fails, classification });
    }
  }
  if (candidates.length === 0) return 0;

  // Resolve tenant + active state for every candidate in one round trip.
  const webhooks = await prisma.webhook.findMany({
    where: { id: { in: candidates.map((c) => c.webhookId) } },
    select: { id: true, tenantId: true, url: true, isActive: true },
  });
  const webhookMap = new Map(webhooks.map((w) => [w.id, w]));

  let written = 0;
  const today = dayKey(now);
  for (const c of candidates) {
    const webhook = webhookMap.get(c.webhookId);
    // Skip orphaned logs whose webhook row is gone.
    if (!webhook) continue;

    // Auto-heal: flip isActive=false on catastrophic failure rate.
    // Only act once — if it's already disabled, skip the write so we
    // don't churn updatedAt every scan.
    let autoDisabled = false;
    if (c.classification.shouldAutoDisable && webhook.isActive) {
      try {
        await prisma.webhook.update({
          where: { id: webhook.id },
          data: { isActive: false },
        });
        autoDisabled = true;
      } catch (err) {
        console.warn(
          `[platform-monitor] auto-disable failed for webhook ${webhook.id}:`,
          (err as Error).message,
        );
      }
    }

    await upsertItem({
      code: PlatformActionCode.WEBHOOK_FAILURE_SPIKE,
      severity: c.classification.severity!,
      title: `Webhook failing: ${(c.classification.rate * 100).toFixed(0)}% errors`,
      body: autoDisabled
        ? `Auto-disabled ${webhook.url} after ${c.failures}/${c.total} failed deliveries in 24h. Re-enable manually after fixing the endpoint.`
        : `${c.failures}/${c.total} deliveries failed in 24h for ${webhook.url}. Investigate the endpoint.`,
      targetTenantId: webhook.tenantId,
      context: {
        webhookId: webhook.id,
        webhookUrl: webhook.url,
        failureRate: c.classification.rate,
        failures: c.failures,
        total: c.total,
        autoDisabled,
      },
      dedupeKey: `${PlatformActionCode.WEBHOOK_FAILURE_SPIKE}:${webhook.id}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Provider Router signals — a provider with <90% success and ≥20 samples
// in the last 24h shows up as PROVIDER_HEALTH_DEGRADED. Cross-tenant; the
// item targets the platform, not a specific tenant.
// ----------------------------------------------------------------------------

const PROVIDER_DEGRADED_THRESHOLD = 0.9;
const PROVIDER_MIN_VOLUME = 20;

async function gatherProviderHealthSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const samples = await prisma.providerHealthSample.findMany({
    where: { createdAt: { gte: since } },
    select: { providerKey: true, success: true },
    take: 200_000,
  });
  if (samples.length === 0) return 0;

  const buckets = new Map<
    WhatsAppProviderKey,
    { total: number; success: number }
  >();
  for (const s of samples) {
    let bucket = buckets.get(s.providerKey);
    if (!bucket) {
      bucket = { total: 0, success: 0 };
      buckets.set(s.providerKey, bucket);
    }
    bucket.total += 1;
    if (s.success) bucket.success += 1;
  }

  let written = 0;
  const today = dayKey(now);
  for (const [providerKey, b] of buckets.entries()) {
    if (b.total < PROVIDER_MIN_VOLUME) continue;
    const rate = b.success / b.total;
    if (rate >= PROVIDER_DEGRADED_THRESHOLD) continue;

    const severity =
      rate < 0.7
        ? PlatformActionSeverity.URGENT
        : rate < 0.85
          ? PlatformActionSeverity.HIGH
          : PlatformActionSeverity.MEDIUM;

    await upsertItem({
      code: PlatformActionCode.PROVIDER_HEALTH_DEGRADED,
      severity,
      title: `${providerKey}: success rate ${(rate * 100).toFixed(1)}%`,
      body: `${b.success}/${b.total} sends succeeded in the last 24h. Consider switching the route or alerting the BSP.`,
      // Platform-level, not tenant-scoped.
      targetTenantId: null,
      context: {
        providerKey,
        successRate: rate,
        successCount: b.success,
        totalSends: b.total,
      },
      dedupeKey: `${PlatformActionCode.PROVIDER_HEALTH_DEGRADED}:${providerKey}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Overdue credit-line signals (Claude FINAL §5 "overdue suspension" worker).
//
// CreditLine carries a dueDate but nothing acts on it — the schema
// comment flags this as a future worker. We do NOT auto-suspend: cutting
// off an enterprise customer's send capability is high-blast-radius and
// belongs to a human decision (same alert-not-auto-throttle discipline as
// the AI usage spike monitor). Instead each overdue ACTIVE line becomes a
// PlatformActionItem so the SuperAdmin can suspend from the credit-line
// panel after reviewing.
//
// Severity escalates with how far past due the line is:
//   < 7 days   → MEDIUM (gentle nudge; payment may be in flight)
//   7–30 days  → HIGH   (chase the customer)
//   > 30 days  → URGENT (write-off / suspend territory)
// ----------------------------------------------------------------------------

export interface CreditLineOverdueClassification {
  severity: PlatformActionSeverity | null;
}

/**
 * Pure days-overdue → severity mapping — exported for tests.
 * A non-positive daysOverdue (line not yet due) returns null so the
 * caller skips it.
 */
export function classifyCreditLineOverdue(
  daysOverdue: number,
): CreditLineOverdueClassification {
  if (!Number.isFinite(daysOverdue) || daysOverdue <= 0) {
    return { severity: null };
  }
  if (daysOverdue > 30) return { severity: PlatformActionSeverity.URGENT };
  if (daysOverdue >= 7) return { severity: PlatformActionSeverity.HIGH };
  return { severity: PlatformActionSeverity.MEDIUM };
}

/**
 * Whole days between dueDate and now (floor). Negative when the line
 * isn't due yet. Pure — exported for tests.
 */
export function daysOverdue(dueDate: Date, now: Date): number {
  const ms = now.getTime() - dueDate.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function gatherCreditLineOverdueSignals(now: Date): Promise<number> {
  const rows = await prisma.creditLine.findMany({
    where: {
      status: CreditLineStatus.ACTIVE,
      dueDate: { not: null, lt: now },
    },
    select: {
      id: true,
      tenantId: true,
      limitCredits: true,
      dueDate: true,
      tenant: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  let written = 0;
  const today = dayKey(now);
  for (const row of rows) {
    if (!row.dueDate) continue;
    const overdue = daysOverdue(row.dueDate, now);
    const { severity } = classifyCreditLineOverdue(overdue);
    if (!severity) continue;

    await upsertItem({
      code: PlatformActionCode.CREDIT_LINE_OVERDUE,
      severity,
      title: `${row.tenant.name}: credit line ${overdue}d overdue`,
      body:
        `Postpaid credit line (${row.limitCredits.toLocaleString("en-IN")} credit limit) ` +
        `passed its due date ${overdue} day${overdue === 1 ? "" : "s"} ago. ` +
        `Review and suspend from the tenant's credit-line panel if payment isn't forthcoming.`,
      targetTenantId: row.tenantId,
      context: {
        creditLineId: row.id,
        limitCredits: row.limitCredits,
        dueDate: row.dueDate,
        daysOverdue: overdue,
      },
      dedupeKey: `${PlatformActionCode.CREDIT_LINE_OVERDUE}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Orchestration
// ----------------------------------------------------------------------------

export interface ScanResult {
  walletItems: number;
  complianceItems: number;
  providerItems: number;
  webhookItems: number;
  aiUsageItems: number;
  churnRiskItems: number;
  onboardingStalledItems: number;
  creditLineOverdueItems: number;
  total: number;
}

export async function runDailyScan(): Promise<ScanResult> {
  const now = new Date();
  // Per-gatherer try/catch so a flaky signal source can't kill the rest
  // of the scan. Failures land in logs; the missing signals just don't
  // appear in this scan's output.
  let walletItems = 0;
  let complianceItems = 0;
  let providerItems = 0;
  let webhookItems = 0;
  let aiUsageItems = 0;
  let churnRiskItems = 0;
  let onboardingStalledItems = 0;
  let creditLineOverdueItems = 0;
  try {
    walletItems = await gatherWalletRiskSignals(now);
  } catch (err) {
    console.warn("[platform-monitor] wallet scan failed:", (err as Error).message);
  }
  try {
    complianceItems = await gatherComplianceSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] compliance scan failed:",
      (err as Error).message,
    );
  }
  try {
    providerItems = await gatherProviderHealthSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] provider scan failed:",
      (err as Error).message,
    );
  }
  try {
    webhookItems = await gatherWebhookFailureSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] webhook scan failed:",
      (err as Error).message,
    );
  }
  try {
    aiUsageItems = await gatherAiUsageSpikeSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] ai usage scan failed:",
      (err as Error).message,
    );
  }
  try {
    churnRiskItems = await gatherChurnRiskSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] churn risk scan failed:",
      (err as Error).message,
    );
  }
  try {
    onboardingStalledItems = await gatherOnboardingStalledSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] onboarding stall scan failed:",
      (err as Error).message,
    );
  }
  try {
    creditLineOverdueItems = await gatherCreditLineOverdueSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] credit-line overdue scan failed:",
      (err as Error).message,
    );
  }
  return {
    walletItems,
    complianceItems,
    providerItems,
    webhookItems,
    aiUsageItems,
    churnRiskItems,
    onboardingStalledItems,
    creditLineOverdueItems,
    total:
      walletItems +
      complianceItems +
      providerItems +
      webhookItems +
      aiUsageItems +
      churnRiskItems +
      onboardingStalledItems +
      creditLineOverdueItems,
  };
}

// ----------------------------------------------------------------------------
// Reads + status mutations (SuperAdmin route uses these)
// ----------------------------------------------------------------------------

export interface ListItemsFilter {
  status?: PlatformActionStatus;
  severity?: PlatformActionSeverity;
  code?: PlatformActionCode;
  tenantId?: string;
  limit?: number;
}

const SEVERITY_RANK: Record<PlatformActionSeverity, number> = {
  [PlatformActionSeverity.URGENT]: 0,
  [PlatformActionSeverity.HIGH]: 1,
  [PlatformActionSeverity.MEDIUM]: 2,
  [PlatformActionSeverity.LOW]: 3,
};

export async function listItems(filter: ListItemsFilter = {}) {
  const rows = await prisma.platformActionItem.findMany({
    where: {
      ...(filter.status && { status: filter.status }),
      ...(filter.severity && { severity: filter.severity }),
      ...(filter.code && { code: filter.code }),
      ...(filter.tenantId && { targetTenantId: filter.tenantId }),
    },
    include: {
      targetTenant: { select: { id: true, name: true } },
    },
    take: Math.min(filter.limit ?? 500, 1000),
    orderBy: { createdAt: "desc" },
  });
  // Severity-first sort matches the wallet-risk portfolio convention.
  rows.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return rows;
}

export async function updateItemStatus(args: {
  itemId: string;
  status: PlatformActionStatus;
  userId: string;
  snoozedUntil?: Date | null;
}) {
  const data: Record<string, unknown> = {
    status: args.status,
  };
  if (args.status === PlatformActionStatus.RESOLVED) {
    data.resolvedAt = new Date();
    data.resolvedByUserId = args.userId;
  } else if (args.status === PlatformActionStatus.OPEN) {
    data.resolvedAt = null;
    data.resolvedByUserId = null;
    data.snoozedUntil = null;
  } else if (args.status === PlatformActionStatus.SNOOZED) {
    data.snoozedUntil = args.snoozedUntil ?? null;
  }
  return prisma.platformActionItem.update({
    where: { id: args.itemId },
    data,
    include: { targetTenant: { select: { id: true, name: true } } },
  });
}

// ----------------------------------------------------------------------------
// Worker
// ----------------------------------------------------------------------------

let platformMonitorWorker: Worker<PlatformMonitorJobData> | null = null;

export async function startPlatformMonitorWorker(): Promise<void> {
  if (platformMonitorWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[platform-monitor] database unavailable; worker not started.",
    );
    return;
  }
  const q = getPlatformMonitorQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
    await q.removeJobScheduler(SUMMARY_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SUMMARY_JOB_NAME,
      { every: SUMMARY_INTERVAL_MS },
      { name: SUMMARY_JOB_NAME, data: { kind: "summary" } },
    );
  } catch (err) {
    console.warn(
      "[platform-monitor] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }
  platformMonitorWorker = new Worker<PlatformMonitorJobData>(
    QueueNames.PLATFORM_MONITOR,
    async (job) => {
      if (job.name === SCAN_JOB_NAME) return runDailyScan();
      if (job.name === SUMMARY_JOB_NAME) return runScheduledPlatformSummary();
      return { skipped: true };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  platformMonitorWorker.on("failed", (job, err) => {
    console.error(
      `[platform-monitor] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });
  trackWorker(platformMonitorWorker);
}

export function stopPlatformMonitorWorker(): void {
  if (!platformMonitorWorker) return;
  void platformMonitorWorker.close();
  platformMonitorWorker = null;
}

// ----------------------------------------------------------------------------
// SuperAdmin LLM summary (Sprint 6 slice 3). Generate-then-approve top-3
// cross-code action plan over the current OPEN PlatformActionItem queue.
// Deterministic totals + worst-items list run unconditionally; the LLM
// reasons over that to prioritize. Falls back to a deterministic
// "rescue-the-URGENT items first" list when the model is unavailable.
//
// Billed to a caller-supplied tenant (typically the SuperAdmin's own
// tenant — the user's JWT-resolved tenantId). The wallet's existing
// assertCanAffordAi gates spend exactly like every other LLM caller.
// ----------------------------------------------------------------------------

export interface PlatformMonitorSummaryItem {
  id: string;
  code: PlatformActionCode;
  severity: PlatformActionSeverity;
  title: string;
  body: string;
  targetTenantId: string | null;
  createdAt: Date;
}

export interface PlatformMonitorSummary {
  generatedAt: Date;
  totals: Record<PlatformActionSeverity, number>;
  totalOpen: number;
  byCode: Record<string, number>;
  headline: string;
  actions: Array<{
    title: string;
    rationale: string;
    itemIds: string[];
  }>;
  worstItems: PlatformMonitorSummaryItem[];
  source: "ai" | "fallback";
}

const SUMMARY_SEVERITY_RANK: Record<PlatformActionSeverity, number> = {
  [PlatformActionSeverity.URGENT]: 0,
  [PlatformActionSeverity.HIGH]: 1,
  [PlatformActionSeverity.MEDIUM]: 2,
  [PlatformActionSeverity.LOW]: 3,
};

export async function runPlatformMonitorSummary(args: {
  billToTenantId: string;
}): Promise<PlatformMonitorSummary> {
  const open = await prisma.platformActionItem.findMany({
    where: { status: PlatformActionStatus.OPEN },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: 30,
    select: {
      id: true,
      code: true,
      severity: true,
      title: true,
      body: true,
      targetTenantId: true,
      createdAt: true,
    },
  });

  const totals: Record<PlatformActionSeverity, number> = {
    [PlatformActionSeverity.URGENT]: 0,
    [PlatformActionSeverity.HIGH]: 0,
    [PlatformActionSeverity.MEDIUM]: 0,
    [PlatformActionSeverity.LOW]: 0,
  };
  const byCode: Record<string, number> = {};
  for (const item of open) {
    totals[item.severity] += 1;
    byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  }

  // Worst-by-severity first, then most recent.
  const sorted = [...open].sort(
    (a, b) =>
      SUMMARY_SEVERITY_RANK[a.severity] - SUMMARY_SEVERITY_RANK[b.severity] ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const worstItems = sorted.slice(0, 10);

  // Deterministic fallback — used when the LLM call errors / returns
  // empty, or when there's literally nothing open to summarize.
  const fallbackHeadline =
    open.length === 0
      ? "No open platform action items — queue is clean."
      : `${totals[PlatformActionSeverity.URGENT]} urgent, ${totals[PlatformActionSeverity.HIGH]} high across ${open.length} open items.`;

  const fallback: PlatformMonitorSummary = {
    generatedAt: new Date(),
    totals,
    totalOpen: open.length,
    byCode,
    headline: fallbackHeadline,
    actions: worstItems.slice(0, 3).map((item) => ({
      title: `Triage: ${item.title}`,
      rationale: `${item.severity} · ${item.code}`,
      itemIds: [item.id],
    })),
    worstItems,
    source: "fallback",
  };

  if (open.length === 0) return fallback;

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{
      headline?: string;
      actions?: Array<{ title?: string; rationale?: string; itemIds?: string[] }>;
    }>({
      tenantId: args.billToTenantId,
      feature: "platform_monitor_summary",
      system:
        "You are an AI ops copilot for a SaaS platform operator looking at the " +
        "current open triage queue. Return JSON of shape:\n" +
        '{"headline":"one-line state under 22 words","actions":[{"title":"imperative","rationale":"why","itemIds":["..."]}]}\n' +
        "Up to 3 actions. Group related items when sensible (e.g. multiple " +
        "WEBHOOK_FAILURE_SPIKE for the same tenant). Each action's itemIds " +
        "must be drawn from the input. Prefer URGENT > HIGH > MEDIUM.",
      prompt: JSON.stringify({
        totals,
        totalOpen: open.length,
        byCode,
        worstItems: worstItems.map((i) => ({
          id: i.id,
          code: i.code,
          severity: i.severity,
          title: i.title,
          body: i.body,
          targetTenantId: i.targetTenantId,
        })),
      }),
      maxTokens: 700,
      temperature: 0.3,
    });

    const validIds = new Set(open.map((i) => i.id));
    const actions = Array.isArray(llm.actions)
      ? llm.actions.slice(0, 3).map((a) => ({
          title: (a.title ?? "").trim().slice(0, 120),
          rationale: (a.rationale ?? "").trim().slice(0, 400),
          itemIds: Array.isArray(a.itemIds)
            ? a.itemIds.filter((id) => validIds.has(id)).slice(0, 8)
            : [],
        }))
      : [];

    const headline = (llm.headline ?? "").trim().slice(0, 220);
    if (!headline && actions.length === 0) return fallback;

    return {
      generatedAt: new Date(),
      totals,
      totalOpen: open.length,
      byCode,
      headline: headline || fallbackHeadline,
      actions: actions.length > 0 ? actions : fallback.actions,
      worstItems,
      source: "ai",
    };
  } catch (err) {
    console.error("[platform-monitor] summary LLM failed:", err);
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// Scheduled SuperAdmin summary push (Sprint 6 slice 4). Runs every 24h via
// the BullMQ scheduler. Picks the oldest active DIRECT tenant as the
// platform root (that's where SuperAdmins live + where the LLM bill
// belongs), runs runPlatformMonitorSummary, and fans out a push to the
// tenant's registered devices ONLY when the queue actually has an
// URGENT or HIGH item open. The "only when worth pushing" gate means
// a clean morning doesn't translate into a daily notification ping.
//
// All failures are caught + logged — a missing DIRECT tenant, an LLM
// outage, or a misconfigured FCM service account each just skip the
// push; the next 24h tick tries again.
// ----------------------------------------------------------------------------

export interface ScheduledSummaryResult {
  pushed: boolean;
  reason?: string;
  platformTenantId?: string;
  urgentCount?: number;
  highCount?: number;
}

/**
 * Look up the platform's own root tenant. Exported for tests + the
 * runner to use a single deterministic source.
 *
 * Rule: oldest active DIRECT tenant. Stable across reboots, doesn't
 * accidentally pick a SuperAdmin-impersonated partner, and works
 * even on platforms with multiple DIRECT tenants (test envs).
 */
export async function findPlatformTenantId(): Promise<string | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { type: TenantType.DIRECT, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

export async function runScheduledPlatformSummary(): Promise<ScheduledSummaryResult> {
  const platformTenantId = await findPlatformTenantId();
  if (!platformTenantId) {
    return { pushed: false, reason: "No active DIRECT tenant found." };
  }

  let summary: PlatformMonitorSummary;
  try {
    summary = await runPlatformMonitorSummary({ billToTenantId: platformTenantId });
  } catch (err) {
    console.error("[platform-monitor] scheduled summary build failed:", err);
    return {
      pushed: false,
      reason: "Summary build threw",
      platformTenantId,
    };
  }

  const urgentCount = summary.totals[PlatformActionSeverity.URGENT] ?? 0;
  const highCount = summary.totals[PlatformActionSeverity.HIGH] ?? 0;

  // No URGENT/HIGH = nothing worth waking a phone for. Keeps the daily
  // cadence from turning into noise on healthy days.
  if (urgentCount === 0 && highCount === 0) {
    return {
      pushed: false,
      reason: "No URGENT or HIGH items open; push skipped.",
      platformTenantId,
      urgentCount,
      highCount,
    };
  }

  try {
    const { sendToTenant } = await import("./pushNotification.service");
    const headlineSnippet = summary.headline.slice(0, 140);
    await sendToTenant(platformTenantId, {
      title: `Daily ops summary: ${urgentCount} urgent · ${highCount} high`,
      body: headlineSnippet,
      data: {
        type: "PLATFORM_MONITOR_SUMMARY",
        urgentCount: String(urgentCount),
        highCount: String(highCount),
        totalOpen: String(summary.totalOpen),
        source: summary.source,
      },
    });
    return {
      pushed: true,
      platformTenantId,
      urgentCount,
      highCount,
    };
  } catch (err) {
    console.error("[platform-monitor] scheduled summary push failed:", err);
    return {
      pushed: false,
      reason: "Push dispatch threw",
      platformTenantId,
      urgentCount,
      highCount,
    };
  }
}

// ----------------------------------------------------------------------------
// Last-run inspection + manual trigger (Sprint 6 slice 5). The scheduler
// runs every 24h, but an operator setting up FCM for the first time, or
// returning from a quiet stretch, needs to verify the pipeline is alive
// without waiting a day. We use BullMQ's own completed-jobs storage as
// the source of truth for "when did the last summary run, and what
// happened" — no new schema, no audit-log abuse.
// ----------------------------------------------------------------------------

export interface LastSummaryRun {
  ranAt: Date;
  result: ScheduledSummaryResult;
  jobId: string | null;
}

/**
 * Most recent completed `summary` job from the BullMQ queue. Reads up to
 * the last 50 completed jobs and picks the freshest `summary` by
 * `finishedOn`. Returns null when the worker has never produced one
 * (fresh install, just-cleared queue, etc).
 */
export async function getLastSummaryRun(): Promise<LastSummaryRun | null> {
  try {
    const q = getPlatformMonitorQueue();
    const completed = await q.getJobs(["completed"], 0, 50);
    let best: { finishedOn: number; job: (typeof completed)[number] } | null =
      null;
    for (const job of completed) {
      if (job.name !== SUMMARY_JOB_NAME) continue;
      const finishedOn = job.finishedOn ?? 0;
      if (!finishedOn) continue;
      if (!best || finishedOn > best.finishedOn) {
        best = { finishedOn, job };
      }
    }
    if (!best) return null;
    return {
      ranAt: new Date(best.finishedOn),
      result: best.job.returnvalue as ScheduledSummaryResult,
      jobId: best.job.id ?? null,
    };
  } catch (err) {
    console.warn(
      "[platform-monitor] last-run inspection failed:",
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Enqueue a one-off summary job. The worker picks it up and runs
 * `runScheduledPlatformSummary`, so the result lands in completed jobs
 * just like the scheduled tick. Returns the job id immediately —
 * caller polls `getLastSummaryRun` to see the result.
 *
 * Idempotency window: same operator click within 5 seconds collapses to
 * one job via a time-bucketed jobId. Prevents accidental double-tap from
 * burning two LLM calls.
 */
export async function triggerSummaryNow(): Promise<{ jobId: string | null }> {
  const q = getPlatformMonitorQueue();
  const bucket = Math.floor(Date.now() / 5000);
  const job = await q.add(
    SUMMARY_JOB_NAME,
    { kind: "summary" } as PlatformMonitorJobData,
    { jobId: `summary-manual-${bucket}` },
  );
  return { jobId: job.id ?? null };
}
