import {
  prisma,
  CustomerHealthTier,
  WalletRiskTier,
  Prisma,
} from "@nexaflow/db";

type FactorKey = "activity" | "wallet" | "compliance" | "engagement" | "onboarding";

interface HealthFactor {
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface CustomerHealthRow {
  tenantId: string;
  tenantName: string;
  status: string;
  score: number;
  tier: CustomerHealthTier;
  recommendation: string;
  assessedAt: Date;
  factors: Record<FactorKey, HealthFactor>;
  metrics: {
    contacts: number;
    leads30d: number;
    conversations30d: number;
    messages30d: number;
    complianceReview30d: number;
    complianceBlock30d: number;
    walletRiskTier: WalletRiskTier | null;
  };
}

const WEIGHTS: Record<FactorKey, number> = {
  activity: 0.28,
  wallet: 0.22,
  compliance: 0.2,
  engagement: 0.18,
  onboarding: 0.12,
};

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
let timer: ReturnType<typeof setInterval> | null = null;

function dayKeyUtc(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function tierFromScore(score: number): CustomerHealthTier {
  if (score >= 80) return CustomerHealthTier.THRIVING;
  if (score >= 60) return CustomerHealthTier.HEALTHY;
  if (score >= 40) return CustomerHealthTier.AT_RISK;
  return CustomerHealthTier.CHURNING;
}

function factor(score: number, weight: number, detail: string): HealthFactor {
  const safeScore = clamp01(score);
  return {
    score: Number(safeScore.toFixed(2)),
    weight,
    contribution: roundScore(safeScore * weight * 100),
    detail,
  };
}

function walletScore(tier: WalletRiskTier | null): number {
  switch (tier) {
    case WalletRiskTier.OK:
      return 1;
    case WalletRiskTier.WATCH:
      return 0.72;
    case WalletRiskTier.URGENT:
      return 0.4;
    case WalletRiskTier.CRITICAL:
      return 0.15;
    default:
      return 0.75;
  }
}

function recommendationFor(args: {
  score: number;
  tier: CustomerHealthTier;
  metrics: CustomerHealthRow["metrics"];
}): string {
  if (args.tier === CustomerHealthTier.THRIVING) {
    return "Invite this customer to upgrade or expand automation usage.";
  }
  if (args.metrics.walletRiskTier === WalletRiskTier.CRITICAL) {
    return "Recharge wallet or move this customer to postpaid before campaigns stall.";
  }
  if (args.metrics.complianceBlock30d > 0) {
    return "Review blocked compliance checks and rewrite risky outbound copy.";
  }
  if (args.tier === CustomerHealthTier.CHURNING) {
    return "Schedule a rescue call and rebuild the first successful WhatsApp workflow.";
  }
  if (args.tier === CustomerHealthTier.AT_RISK) {
    return "Nudge adoption with a template, campaign, or inbox training session.";
  }
  return "Keep monitoring. This customer is stable but has room for deeper adoption.";
}

async function collectMetrics(tenantId: string) {
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 86_400_000);
  const [
    contacts,
    leads30d,
    conversations30d,
    messages30d,
    inboundMessages30d,
    outboundMessages30d,
    review30d,
    block30d,
    latestWalletRisk,
  ] = await Promise.all([
    prisma.contact.count({ where: { tenantId } }),
    prisma.lead.count({ where: { tenantId, createdAt: { gte: since30d } } }),
    prisma.conversation.count({ where: { tenantId, createdAt: { gte: since30d } } }),
    prisma.message.count({
      where: { conversation: { tenantId }, createdAt: { gte: since30d } },
    }),
    prisma.message.count({
      where: {
        conversation: { tenantId },
        createdAt: { gte: since30d },
        direction: "INBOUND",
      },
    }),
    prisma.message.count({
      where: {
        conversation: { tenantId },
        createdAt: { gte: since30d },
        direction: "OUTBOUND",
      },
    }),
    prisma.complianceCheck.count({
      where: { tenantId, createdAt: { gte: since30d }, verdict: "REVIEW" },
    }),
    prisma.complianceCheck.count({
      where: { tenantId, createdAt: { gte: since30d }, verdict: "BLOCK" },
    }),
    prisma.walletRiskAssessment.findFirst({
      where: { tenantId },
      orderBy: { assessedAt: "desc" },
      select: { riskTier: true },
    }),
  ]);

  return {
    contacts,
    leads30d,
    conversations30d,
    messages30d,
    inboundMessages30d,
    outboundMessages30d,
    complianceReview30d: review30d,
    complianceBlock30d: block30d,
    walletRiskTier: latestWalletRisk?.riskTier ?? null,
  };
}

export async function assessCustomerHealth(tenantId: string): Promise<CustomerHealthRow> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      parentTenantId: true,
    },
  });
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found.`);
  }

  const metrics = await collectMetrics(tenantId);
  const accountAgeDays = Math.max(
    1,
    Math.ceil((Date.now() - tenant.createdAt.getTime()) / 86_400_000),
  );

  const activity = factor(
    clamp01(metrics.messages30d / 500) * 0.45 +
      clamp01(metrics.contacts / 250) * 0.25 +
      clamp01(metrics.leads30d / 25) * 0.15 +
      clamp01(metrics.conversations30d / 80) * 0.15,
    WEIGHTS.activity,
    `${metrics.messages30d} messages, ${metrics.contacts} contacts, ${metrics.leads30d} leads in signal window.`,
  );

  const wallet = factor(
    walletScore(metrics.walletRiskTier),
    WEIGHTS.wallet,
    metrics.walletRiskTier
      ? `Latest wallet risk is ${metrics.walletRiskTier}.`
      : "No wallet risk assessment yet; using neutral score.",
  );

  const compliancePenalty = Math.min(
    0.85,
    metrics.complianceBlock30d * 0.22 + metrics.complianceReview30d * 0.08,
  );
  const compliance = factor(
    1 - compliancePenalty,
    WEIGHTS.compliance,
    `${metrics.complianceBlock30d} blocked and ${metrics.complianceReview30d} review compliance checks in 30 days.`,
  );

  const replyBalance =
    metrics.outboundMessages30d > 0
      ? Math.min(1, metrics.inboundMessages30d / metrics.outboundMessages30d)
      : metrics.inboundMessages30d > 0
        ? 0.8
        : 0.45;
  const engagement = factor(
    clamp01(replyBalance * 0.5 + clamp01(metrics.conversations30d / 40) * 0.5),
    WEIGHTS.engagement,
    `${metrics.inboundMessages30d} inbound vs ${metrics.outboundMessages30d} outbound messages.`,
  );

  const onboarding = factor(
    clamp01(
      (metrics.contacts > 0 ? 0.3 : 0) +
        (metrics.messages30d > 0 ? 0.35 : 0) +
        (metrics.leads30d > 0 ? 0.2 : 0) +
        (accountAgeDays > 7 ? 0.15 : 0.05),
    ),
    WEIGHTS.onboarding,
    `Account age ${accountAgeDays} day(s); ${metrics.contacts > 0 ? "contacts loaded" : "no contacts yet"}.`,
  );

  const factors = {
    activity,
    wallet,
    compliance,
    engagement,
    onboarding,
  };
  const factorsJson = factors as unknown as Prisma.InputJsonValue;
  const score = roundScore(
    Object.values(factors).reduce((sum, f) => sum + f.contribution, 0),
  );
  const tier = tierFromScore(score);
  const recommendation = recommendationFor({ score, tier, metrics });

  // Capture the previous tier BEFORE the upsert so escalation detection
  // doesn't compare against the row we're about to write.
  const previousTier = await previousTierFor(tenantId);

  const row = await prisma.customerHealthScore.upsert({
    where: { tenantId_dayKey: { tenantId, dayKey: dayKeyUtc() } },
    update: {
      assessedAt: new Date(),
      score,
      tier,
      factors: factorsJson,
      recommendation,
    },
    create: {
      tenantId,
      dayKey: dayKeyUtc(),
      score,
      tier,
      factors: factorsJson,
      recommendation,
    },
  });

  // AI Partner Assistant — slice 2 hooks. Both fire-and-forget so a
  // hiccup in the LLM or push pipeline can't taint the assessment write.
  if (tier === CustomerHealthTier.AT_RISK || tier === CustomerHealthTier.CHURNING) {
    void enrichRecommendationWithLlm({
      tenantId,
      tenantName: tenant.name,
      tier,
      score,
      factors,
      metrics,
    });
  }
  void notifyPartnerOnDowngrade({
    tenantId,
    tenantName: tenant.name,
    parentTenantId: tenant.parentTenantId ?? null,
    previousTier,
    currentTier: tier,
    score,
  });

  return {
    tenantId,
    tenantName: tenant.name,
    status: tenant.status,
    score: row.score,
    tier: row.tier,
    recommendation: row.recommendation ?? recommendation,
    assessedAt: row.assessedAt,
    factors: factors as Record<FactorKey, HealthFactor>,
    metrics,
  };
}

export async function listPartnerCustomerHealth(args: {
  partnerTenantId: string;
  refresh?: boolean;
  limit?: number;
}): Promise<CustomerHealthRow[]> {
  const tenants = await prisma.tenant.findMany({
    where: {
      parentTenantId: args.partnerTenantId,
      type: "BUSINESS",
      status: { not: "DELETED" },
    },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 25,
    select: { id: true },
  });

  const rows = await Promise.all(
    tenants.map(async (tenant) => {
      if (args.refresh) return assessCustomerHealth(tenant.id);
      const latest = await prisma.customerHealthScore.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { assessedAt: "desc" },
        include: {
          tenant: { select: { name: true, status: true } },
        },
      });
      if (!latest) return assessCustomerHealth(tenant.id);
      const metrics = await collectMetrics(tenant.id);
      return {
        tenantId: tenant.id,
        tenantName: latest.tenant.name,
        status: latest.tenant.status,
        score: latest.score,
        tier: latest.tier,
        recommendation: latest.recommendation ?? "",
        assessedAt: latest.assessedAt,
        factors: latest.factors as unknown as Record<FactorKey, HealthFactor>,
        metrics,
      };
    }),
  );

  const tierRank: Record<CustomerHealthTier, number> = {
    [CustomerHealthTier.CHURNING]: 0,
    [CustomerHealthTier.AT_RISK]: 1,
    [CustomerHealthTier.HEALTHY]: 2,
    [CustomerHealthTier.THRIVING]: 3,
  };
  return rows.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.score - b.score);
}

export async function scanCustomerHealth(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { type: "BUSINESS", status: "ACTIVE" },
    select: { id: true },
    take: BATCH_SIZE,
    orderBy: { updatedAt: "desc" },
  });
  for (const tenant of tenants) {
    try {
      await assessCustomerHealth(tenant.id);
    } catch (err) {
      console.error(`[customer-health] assessment failed for ${tenant.id}:`, err);
    }
  }
  return tenants.length;
}

export function startCustomerHealthWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void scanCustomerHealth().catch((err) => {
      console.error("[customer-health] scan failed:", err);
    });
  }, SCAN_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  void scanCustomerHealth().catch((err) => {
    console.error("[customer-health] initial scan failed:", err);
  });
}

export function stopCustomerHealthWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------------------------------------------------------------------------
// AI Partner Assistant (Sprint 3 slice 2)
//
// Three thin layers on top of the raw CustomerHealthScore signal:
//   1. previousTierFor       — look up yesterday's row so we can detect
//                              tier transitions (escalations only).
//   2. notifyPartnerOnDowngrade — push to the parent partner's devices
//                              when a child tenant slips into AT_RISK or
//                              CHURNING (mirrors walletRisk escalation).
//   3. enrichRecommendationWithLlm — for AT_RISK / CHURNING rows, ask
//                              Claude (billed to the partner) to rewrite
//                              the deterministic recommendation as a
//                              one-line action the partner can take today.
//   4. runPartnerAssistantSummary — portfolio-wide top-3 actions list,
//                              served by GET /partner/assistant/summary.
//
// All async hooks are fire-and-forget from the assessment hot path so an
// LLM/push hiccup never corrupts the deterministic score write.
// ---------------------------------------------------------------------------

const HEALTH_TIER_RANK: Record<CustomerHealthTier, number> = {
  [CustomerHealthTier.THRIVING]: 3,
  [CustomerHealthTier.HEALTHY]: 2,
  [CustomerHealthTier.AT_RISK]: 1,
  [CustomerHealthTier.CHURNING]: 0,
};

/**
 * Most recent CustomerHealthScore.tier before today's UTC day-key.
 * Returns null if this is the tenant's first-ever assessment.
 */
async function previousTierFor(tenantId: string): Promise<CustomerHealthTier | null> {
  const prior = await prisma.customerHealthScore.findFirst({
    where: { tenantId, dayKey: { lt: dayKeyUtc() } },
    orderBy: { assessedAt: "desc" },
    select: { tier: true },
  });
  return prior?.tier ?? null;
}

/**
 * Fire a push notification to the partner that owns this tenant when the
 * tier worsens into AT_RISK or CHURNING. Silent on upgrades and on
 * lateral moves (HEALTHY ↔ HEALTHY).
 */
async function notifyPartnerOnDowngrade(args: {
  tenantId: string;
  tenantName: string;
  parentTenantId: string | null;
  previousTier: CustomerHealthTier | null;
  currentTier: CustomerHealthTier;
  score: number;
}): Promise<void> {
  try {
    if (!args.parentTenantId) return;
    if (
      args.currentTier !== CustomerHealthTier.AT_RISK &&
      args.currentTier !== CustomerHealthTier.CHURNING
    ) {
      return;
    }
    // Only push on first detection or on further worsening; skip if we
    // already pushed for this tier yesterday.
    if (
      args.previousTier !== null &&
      HEALTH_TIER_RANK[args.currentTier] >= HEALTH_TIER_RANK[args.previousTier]
    ) {
      return;
    }
    const { sendToTenant } = await import("./pushNotification.service");
    const tierLabel =
      args.currentTier === CustomerHealthTier.CHURNING ? "Churning" : "At-Risk";
    await sendToTenant(args.parentTenantId, {
      title: `${tierLabel}: ${args.tenantName}`,
      body: `Health score ${args.score}/100. Open Partner dashboard to see the recommended action.`,
      data: {
        type: "CUSTOMER_HEALTH_DOWNGRADE",
        childTenantId: args.tenantId,
        tier: args.currentTier,
        score: String(args.score),
      },
    });
  } catch (err) {
    console.error("[customer-health] push fanout failed:", err);
  }
}

/**
 * For AT_RISK / CHURNING rows, ask Claude to produce a one-line action
 * the partner can take today. Billed to the partner tenant (the one that
 * owns the customer), not the child, because the partner is the audience
 * for this recommendation.
 */
async function enrichRecommendationWithLlm(args: {
  tenantId: string;
  tenantName: string;
  tier: CustomerHealthTier;
  score: number;
  factors: Record<FactorKey, HealthFactor>;
  metrics: CustomerHealthRow["metrics"];
}): Promise<void> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { parentTenantId: true },
    });
    const billTo = tenant?.parentTenantId ?? args.tenantId;

    const { runTenantLlmJson } = await import("./ai.service");
    const weakest = Object.entries(args.factors)
      .sort(([, a], [, b]) => a.score - b.score)
      .slice(0, 2)
      .map(([key, f]) => `${key}: ${f.detail}`);

    const result = await runTenantLlmJson<{ recommendation: string }>({
      tenantId: billTo,
      feature: "customer_health_recommendation",
      system:
        "You are a SaaS customer-success copilot for a WhatsApp Business platform. " +
        "Given a customer's health snapshot, write ONE concrete action the partner " +
        "should take this week. Keep it under 22 words. No fluff, no greetings. " +
        'Reply ONLY with JSON: {"recommendation":"..."}',
      prompt: JSON.stringify({
        tenantName: args.tenantName,
        tier: args.tier,
        score: args.score,
        weakestFactors: weakest,
        metrics: args.metrics,
      }),
      maxTokens: 240,
    });

    const text = result?.recommendation?.trim();
    if (!text) return;

    await prisma.customerHealthScore.update({
      where: {
        tenantId_dayKey: { tenantId: args.tenantId, dayKey: dayKeyUtc() },
      },
      data: { recommendation: text.slice(0, 500) },
    });
  } catch (err) {
    console.error("[customer-health] LLM enrichment failed:", err);
  }
}

export interface PartnerAssistantSummary {
  partnerTenantId: string;
  generatedAt: Date;
  totals: Record<CustomerHealthTier, number>;
  totalTenants: number;
  headline: string;
  actions: Array<{
    title: string;
    rationale: string;
    tenantIds: string[];
  }>;
  worstAccounts: Array<{
    tenantId: string;
    tenantName: string;
    score: number;
    tier: CustomerHealthTier;
    recommendation: string;
  }>;
}

/**
 * Portfolio-wide AI summary for a partner: aggregates their tenants by
 * tier, then asks Claude for the top-3 actions to take across the whole
 * book. Falls back to a deterministic summary if the LLM call fails.
 */
export async function runPartnerAssistantSummary(
  partnerTenantId: string,
): Promise<PartnerAssistantSummary> {
  const rows = await listPartnerCustomerHealth({
    partnerTenantId,
    refresh: false,
    limit: 100,
  });

  const totals: Record<CustomerHealthTier, number> = {
    [CustomerHealthTier.THRIVING]: 0,
    [CustomerHealthTier.HEALTHY]: 0,
    [CustomerHealthTier.AT_RISK]: 0,
    [CustomerHealthTier.CHURNING]: 0,
  };
  for (const r of rows) totals[r.tier] += 1;

  const worstAccounts = rows
    .filter(
      (r) =>
        r.tier === CustomerHealthTier.AT_RISK ||
        r.tier === CustomerHealthTier.CHURNING,
    )
    .slice(0, 8)
    .map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      score: r.score,
      tier: r.tier,
      recommendation: r.recommendation,
    }));

  // Deterministic fallback — used when the LLM call errors out or the
  // partner has zero tenants at risk.
  const fallbackHeadline =
    rows.length === 0
      ? "No active customers yet — invite businesses to start onboarding."
      : `${totals[CustomerHealthTier.CHURNING]} churning, ${totals[CustomerHealthTier.AT_RISK]} at-risk out of ${rows.length} customers.`;

  const fallback: PartnerAssistantSummary = {
    partnerTenantId,
    generatedAt: new Date(),
    totals,
    totalTenants: rows.length,
    headline: fallbackHeadline,
    actions: worstAccounts.slice(0, 3).map((acct) => ({
      title: `Rescue ${acct.tenantName}`,
      rationale: acct.recommendation || `Tier ${acct.tier} at score ${acct.score}.`,
      tenantIds: [acct.tenantId],
    })),
    worstAccounts,
  };

  if (worstAccounts.length === 0) {
    return fallback;
  }

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{
      headline: string;
      actions: Array<{ title: string; rationale: string; tenantIds: string[] }>;
    }>({
      tenantId: partnerTenantId,
      feature: "partner_assistant_summary",
      system:
        "You are an AI account manager for a WhatsApp SaaS partner. Given a roster " +
        "of the partner's customers with health scores and tiers, return JSON of shape:\n" +
        '{"headline":"one-line state under 22 words","actions":[{"title":"imperative","rationale":"why","tenantIds":["..."]}]}\n' +
        "Include up to 3 actions. Each action's tenantIds must be drawn from the input.",
      prompt: JSON.stringify({
        totals,
        totalTenants: rows.length,
        worstAccounts,
      }),
      maxTokens: 700,
    });

    if (!llm?.headline || !Array.isArray(llm.actions)) return fallback;
    const validIds = new Set(rows.map((r) => r.tenantId));
    const actions = llm.actions.slice(0, 3).map((a) => ({
      title: (a.title ?? "").slice(0, 120),
      rationale: (a.rationale ?? "").slice(0, 400),
      tenantIds: (a.tenantIds ?? []).filter((id) => validIds.has(id)).slice(0, 8),
    }));

    return {
      partnerTenantId,
      generatedAt: new Date(),
      totals,
      totalTenants: rows.length,
      headline: llm.headline.slice(0, 220),
      actions,
      worstAccounts,
    };
  } catch (err) {
    console.error("[customer-health] portfolio summary LLM failed:", err);
    return fallback;
  }
}
