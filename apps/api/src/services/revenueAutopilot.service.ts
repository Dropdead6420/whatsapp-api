// ============================================================================
// Revenue Autopilot (PRD-v2 §8)
//
// Partner-facing upsell / expansion recommender. The PRD calls for an
// engine that "recommends upgrades, pricing changes, add-ons, AI credit
// promotion, and partner campaigns." This service produces a short,
// actionable list scored from data the platform already has:
//
//   - CustomerHealthScore (Sprint 3) — tier + 30d metrics
//   - Wallet (balance, autoRechargeEnabled) — willingness to spend
//   - Tenant plan tier (contactLimit, agentLimit, aiCreditsPerMonth)
//     vs current usage from the analytics surface — usage-vs-quota
//   - Contact / message volumes — adoption depth
//
// Output: a deterministic baseline list, optionally polished by an LLM
// that prioritizes / re-words. Same generate-then-approve discipline as
// the proposal/demo/win-back tools (ADR-030/033/035): the recommendation
// is a suggestion, not an action. The partner clicks through to do
// each thing themselves.
// ============================================================================

import { prisma, CustomerHealthTier } from "@nexaflow/db";

export type RevenueActionKind =
  | "upgrade_plan" // tenant near or past plan quotas
  | "ai_credits_boost" // strong AI usage, low credits config
  | "wallet_recharge" // low balance + healthy tenant
  | "outreach_at_risk" // CustomerHealth AT_RISK, recoverable
  | "expansion_addon" // VIP-shaped tenant, room for paid add-on
  | "enable_auto_recharge"; // habitual top-up, no auto-recharge

export interface RevenueRecommendation {
  tenantId: string;
  tenantName: string;
  action: RevenueActionKind;
  /** Human title — partner sees this on the row. */
  title: string;
  /** One-line "why" — pulled from the underlying numbers. */
  rationale: string;
  /** 0-100; partners triage top-3 by this. */
  priority: number;
}

export interface RevenueAutopilotSummary {
  partnerTenantId: string;
  generatedAt: Date;
  totalScanned: number;
  recommendations: RevenueRecommendation[];
  headline: string;
  source: "ai" | "fallback";
}

interface TenantSignal {
  id: string;
  name: string;
  contactLimit: number;
  campaignLimit: number;
  aiCreditsPerMonth: number;
  contactCount: number;
  campaignCount: number;
  balanceCredits: number | null;
  autoRechargeEnabled: boolean;
  healthTier: CustomerHealthTier | null;
  healthScore: number | null;
  recommendation: string | null;
}

const MAX_TENANTS_PER_SCAN = 50;
const HEADLINE_MAX_LEN = 220;

function bestActionFor(sig: TenantSignal): RevenueRecommendation | null {
  // Order matters: first matching rule wins. Rules ordered by signal
  // strength (clearer ask = higher priority).

  // 1. At-risk tenant — outreach to save them BEFORE upselling.
  //    Goes first because expanding into a churning customer is
  //    upside-down: we can't expand a relationship we're losing.
  if (sig.healthTier === CustomerHealthTier.AT_RISK) {
    return {
      tenantId: sig.id,
      tenantName: sig.name,
      action: "outreach_at_risk",
      title: `Save ${sig.name} before they churn`,
      rationale:
        sig.recommendation?.slice(0, 200) ||
        `Health score ${sig.healthScore ?? "?"}/100. Reach out before they slip further.`,
      priority: 85,
    };
  }

  // 2. Near or past a hard plan quota — concrete upgrade ask.
  const contactPct = sig.contactLimit > 0 ? sig.contactCount / sig.contactLimit : 0;
  const campaignPct =
    sig.campaignLimit > 0 ? sig.campaignCount / sig.campaignLimit : 0;
  const tightestPct = Math.max(contactPct, campaignPct);
  if (tightestPct >= 0.85) {
    const which =
      contactPct >= campaignPct
        ? `contacts (${sig.contactCount}/${sig.contactLimit})`
        : `campaigns (${sig.campaignCount}/${sig.campaignLimit})`;
    return {
      tenantId: sig.id,
      tenantName: sig.name,
      action: "upgrade_plan",
      title: `${sig.name}: pitch a plan upgrade`,
      rationale: `${(tightestPct * 100).toFixed(0)}% of ${which} used. The next campaign or import will hit a hard wall.`,
      priority: Math.round(60 + tightestPct * 25),
    };
  }

  // 3. Low balance + healthy tenant: recharge call.
  //    Skip if auto-recharge is already on — wallet is self-managing.
  if (
    !sig.autoRechargeEnabled &&
    sig.balanceCredits != null &&
    sig.balanceCredits < 500 &&
    (sig.healthTier === CustomerHealthTier.THRIVING ||
      sig.healthTier === CustomerHealthTier.HEALTHY)
  ) {
    return {
      tenantId: sig.id,
      tenantName: sig.name,
      action: "wallet_recharge",
      title: `${sig.name}: prompt a wallet recharge`,
      rationale: `Balance is ${sig.balanceCredits} credits — they're active but a campaign push will fail. Suggest a top-up.`,
      priority: 70,
    };
  }

  // 4. Habitual top-up pattern, no auto-recharge: pitch auto-recharge.
  //    Lower priority — partner has time, this is convenience upsell.
  if (
    !sig.autoRechargeEnabled &&
    sig.balanceCredits != null &&
    sig.balanceCredits >= 500 &&
    sig.healthTier === CustomerHealthTier.THRIVING
  ) {
    return {
      tenantId: sig.id,
      tenantName: sig.name,
      action: "enable_auto_recharge",
      title: `${sig.name}: enable auto-recharge`,
      rationale:
        "Thriving tenant managing wallet manually — turning on auto-recharge prevents a future deliverability gap.",
      priority: 45,
    };
  }

  // 5. VIP/THRIVING and not at quota: expansion opportunity (premium
  //    add-on or AI credits boost).
  if (sig.healthTier === CustomerHealthTier.THRIVING) {
    return {
      tenantId: sig.id,
      tenantName: sig.name,
      action: "expansion_addon",
      title: `${sig.name}: pitch an add-on`,
      rationale: `Health ${sig.healthScore}/100 with room on plan. Pitch knowledge-base, AI agents, or analytics add-on.`,
      priority: 55,
    };
  }

  // No clear signal — nothing actionable yet.
  return null;
}

async function collectSignals(partnerTenantId: string): Promise<TenantSignal[]> {
  const tenants = await prisma.tenant.findMany({
    where: {
      parentTenantId: partnerTenantId,
      type: "BUSINESS",
      status: { not: "DELETED" },
    },
    select: {
      id: true,
      name: true,
      contactLimit: true,
      campaignLimit: true,
      aiCreditsPerMonth: true,
      wallet: {
        select: { balanceCredits: true, autoRechargeEnabled: true },
      },
    },
    take: MAX_TENANTS_PER_SCAN,
    orderBy: { createdAt: "desc" },
  });
  if (tenants.length === 0) return [];

  const ids = tenants.map((t) => t.id);
  // Pull the latest health row per tenant (one row per UTC day; latest
  // assessedAt wins). Group by tenantId after sorting newest-first.
  const healthRows = await prisma.customerHealthScore.findMany({
    where: { tenantId: { in: ids } },
    orderBy: { assessedAt: "desc" },
    select: {
      tenantId: true,
      tier: true,
      score: true,
      recommendation: true,
    },
    take: ids.length * 2, // bounded buffer
  });
  const latestHealth = new Map<
    string,
    { tier: CustomerHealthTier; score: number; recommendation: string | null }
  >();
  for (const row of healthRows) {
    if (latestHealth.has(row.tenantId)) continue;
    latestHealth.set(row.tenantId, {
      tier: row.tier,
      score: row.score,
      recommendation: row.recommendation,
    });
  }

  // One groupBy each for contacts + campaigns gives O(1) lookup per tenant.
  const contactGroups = await prisma.contact.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: ids } },
    _count: { _all: true },
  });
  const contactMap = new Map(contactGroups.map((g) => [g.tenantId, g._count._all]));
  const campaignGroups = await prisma.campaign.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: ids } },
    _count: { _all: true },
  });
  const campaignMap = new Map(
    campaignGroups.map((g) => [g.tenantId, g._count._all]),
  );

  return tenants.map<TenantSignal>((t) => {
    const h = latestHealth.get(t.id);
    return {
      id: t.id,
      name: t.name,
      contactLimit: t.contactLimit,
      campaignLimit: t.campaignLimit,
      aiCreditsPerMonth: t.aiCreditsPerMonth,
      contactCount: contactMap.get(t.id) ?? 0,
      campaignCount: campaignMap.get(t.id) ?? 0,
      balanceCredits: t.wallet?.balanceCredits ?? null,
      autoRechargeEnabled: t.wallet?.autoRechargeEnabled ?? false,
      healthTier: h?.tier ?? null,
      healthScore: h?.score ?? null,
      recommendation: h?.recommendation ?? null,
    };
  });
}

/**
 * Score every child tenant for a revenue opportunity, return up to top-N
 * sorted by priority. Pure deterministic baseline; the LLM polish is
 * applied separately in `runRevenueAutopilot` below.
 *
 * Exported separately so tests can pin the classifier without touching
 * the LLM path.
 */
export function rankRevenueOpportunities(
  signals: TenantSignal[],
  limit = 5,
): RevenueRecommendation[] {
  const recs: RevenueRecommendation[] = [];
  for (const sig of signals) {
    const rec = bestActionFor(sig);
    if (rec) recs.push(rec);
  }
  return recs.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

export async function runRevenueAutopilot(
  partnerTenantId: string,
): Promise<RevenueAutopilotSummary> {
  const signals = await collectSignals(partnerTenantId);
  const recs = rankRevenueOpportunities(signals);

  const fallbackHeadline =
    signals.length === 0
      ? "No active customers yet — invite businesses to start growing."
      : recs.length === 0
        ? `${signals.length} customer${signals.length === 1 ? "" : "s"} — no upsell signals yet. Keep nurturing.`
        : `${recs.length} growth move${recs.length === 1 ? "" : "s"} across ${signals.length} customers. Top: ${recs[0].title}.`;

  const fallback: RevenueAutopilotSummary = {
    partnerTenantId,
    generatedAt: new Date(),
    totalScanned: signals.length,
    recommendations: recs,
    headline: fallbackHeadline.slice(0, HEADLINE_MAX_LEN),
    source: "fallback",
  };

  if (recs.length === 0) return fallback;

  // Polish with an LLM headline. Recommendation list stays deterministic
  // so the LLM can't invent moves the partner shouldn't make. Same
  // discipline as the platform-monitor summary (ADR-038).
  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{ headline?: string }>({
      tenantId: partnerTenantId,
      feature: "revenue_autopilot",
      system:
        "You write a single one-line growth headline for a WhatsApp SaaS partner " +
        "looking at the top revenue opportunities across their customer book. " +
        "Under 22 words. No fluff. Return JSON {\"headline\":\"...\"}.",
      prompt: JSON.stringify({
        totalCustomers: signals.length,
        topRecommendations: recs.slice(0, 3),
      }),
      maxTokens: 220,
      temperature: 0.4,
    });
    const headline = (llm.headline ?? "").trim();
    if (!headline) return fallback;
    return {
      ...fallback,
      headline: headline.slice(0, HEADLINE_MAX_LEN),
      source: "ai",
    };
  } catch (err) {
    console.error("[revenue-autopilot] LLM polish failed:", err);
    return fallback;
  }
}
