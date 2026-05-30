// ============================================================================
// AI Retention Engine (PRD-v2 §7, Sprint 4 slice 1)
//
// Customer-facing contact retention scoring. The scan rates each contact's
// engagement decay from cheap Contact-row signals — last-interaction
// recency, opt-out, lifecycle stage, and AI lead score — with NO per-contact
// message fan-out, so it scales to large contact books with one findMany.
//
// Tier is derived deterministically from recency + opt-out. The score is a
// 0-100 composite (higher = healthier retention). Each daily row carries a
// per-signal `factors` breakdown plus a deterministic recommendation; slice 2
// layers LLM win-back copy and auto-enroll-into-drip on top.
// ============================================================================

import {
  prisma,
  Prisma,
  RetentionTier,
  LifecycleStage,
} from "@nexaflow/db";

type FactorKey = "recency" | "lifecycle" | "intent";

interface RetentionFactor {
  score: number; // 0-1
  weight: number; // 0-1
  contribution: number; // 0-100
  detail: string;
}

export interface ContactRetentionRow {
  contactId: string;
  name: string;
  phoneNumber: string;
  tier: RetentionTier;
  score: number;
  daysSinceInteraction: number;
  optedOut: boolean;
  lifecycleStage: LifecycleStage;
  recommendation: string;
  assessedAt: Date;
  factors: Record<FactorKey, RetentionFactor>;
}

export interface RetentionSummary {
  tenantId: string;
  generatedAt: Date;
  totals: Record<RetentionTier, number>;
  totalScored: number;
  rows: ContactRetentionRow[];
}

const WEIGHTS: Record<FactorKey, number> = {
  recency: 0.6,
  lifecycle: 0.25,
  intent: 0.15,
};

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TENANTS_PER_SCAN = 25;
const CONTACTS_PER_TENANT = 2000;
const DAY_MS = 86_400_000;

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

/** Recency → 0-1 health. Step decay so the curve is explainable to users. */
function recencyScore(days: number): number {
  if (days <= 7) return 1;
  if (days <= 14) return 0.85;
  if (days <= 30) return 0.6;
  if (days <= 60) return 0.35;
  if (days <= 90) return 0.18;
  return 0.05;
}

function lifecycleScore(stage: LifecycleStage): number {
  switch (stage) {
    case LifecycleStage.VIP:
      return 1;
    case LifecycleStage.REPEAT_CUSTOMER:
      return 0.9;
    case LifecycleStage.CUSTOMER:
      return 0.75;
    case LifecycleStage.PROSPECT:
      return 0.55;
    case LifecycleStage.LEAD:
      return 0.4;
    case LifecycleStage.CHURNED:
      return 0.1;
    default:
      return 0.4;
  }
}

/**
 * Deterministic tier. Opt-out is terminal (LOST) regardless of recency;
 * otherwise recency windows drive the tier so it stays explainable.
 */
function tierFor(args: { optedOut: boolean; days: number }): RetentionTier {
  if (args.optedOut) return RetentionTier.LOST;
  if (args.days <= 14) return RetentionTier.ACTIVE;
  if (args.days <= 30) return RetentionTier.COOLING;
  if (args.days <= 90) return RetentionTier.DORMANT;
  return RetentionTier.LOST;
}

function recommendationFor(args: {
  tier: RetentionTier;
  days: number;
  name: string;
  lifecycleStage: LifecycleStage;
}): string {
  switch (args.tier) {
    case RetentionTier.ACTIVE:
      return "Engaged recently — no action needed. Keep nurturing.";
    case RetentionTier.COOLING:
      return `Slipping (${args.days}d quiet). Send a light check-in or value tip before they cool further.`;
    case RetentionTier.DORMANT:
      return `Dormant (${args.days}d quiet). Launch a win-back offer or re-introduction message.`;
    case RetentionTier.LOST:
      return args.lifecycleStage === LifecycleStage.CHURNED
        ? "Marked churned. Move to a low-frequency reactivation list only."
        : `No engagement in ${args.days}d. One final win-back, then suppress to protect deliverability.`;
    default:
      return "Monitor engagement.";
  }
}

interface ContactRow {
  id: string;
  name: string;
  phoneNumber: string;
  optedOut: boolean;
  lifecycleStage: LifecycleStage;
  aiScore: number | null;
  lastInteractionAt: Date | null;
  createdAt: Date;
}

/** Pure scoring — exported for unit tests. */
export function scoreContact(contact: ContactRow, now = new Date()): {
  tier: RetentionTier;
  score: number;
  daysSinceInteraction: number;
  factors: Record<FactorKey, RetentionFactor>;
  recommendation: string;
} {
  const reference = contact.lastInteractionAt ?? contact.createdAt;
  const daysSinceInteraction = Math.max(
    0,
    Math.floor((now.getTime() - reference.getTime()) / DAY_MS),
  );

  const rec = recencyScore(daysSinceInteraction);
  const life = lifecycleScore(contact.lifecycleStage);
  const intent = clamp01(contact.aiScore ?? 0.4);

  const factors: Record<FactorKey, RetentionFactor> = {
    recency: {
      score: Number(rec.toFixed(2)),
      weight: WEIGHTS.recency,
      contribution: roundScore(rec * WEIGHTS.recency * 100),
      detail: contact.lastInteractionAt
        ? `Last interaction ${daysSinceInteraction}d ago.`
        : `No interaction yet; ${daysSinceInteraction}d since added.`,
    },
    lifecycle: {
      score: Number(life.toFixed(2)),
      weight: WEIGHTS.lifecycle,
      contribution: roundScore(life * WEIGHTS.lifecycle * 100),
      detail: `Lifecycle stage ${contact.lifecycleStage}.`,
    },
    intent: {
      score: Number(intent.toFixed(2)),
      weight: WEIGHTS.intent,
      contribution: roundScore(intent * WEIGHTS.intent * 100),
      detail:
        contact.aiScore != null
          ? `AI lead score ${Math.round(contact.aiScore * 100)}/100.`
          : "No AI lead score yet; neutral.",
    },
  };

  // Opt-out forces the floor regardless of other signals.
  const rawScore = contact.optedOut
    ? 0
    : roundScore(Object.values(factors).reduce((s, f) => s + f.contribution, 0));
  const tier = tierFor({ optedOut: contact.optedOut, days: daysSinceInteraction });
  const recommendation = recommendationFor({
    tier,
    days: daysSinceInteraction,
    name: contact.name,
    lifecycleStage: contact.lifecycleStage,
  });

  return { tier, score: rawScore, daysSinceInteraction, factors, recommendation };
}

/**
 * Score every contact for one tenant and upsert today's row. Returns the
 * rows sorted worst-first (LOST/DORMANT before ACTIVE) for the UI.
 */
export async function assessTenantRetention(
  tenantId: string,
  opts: { limit?: number; persist?: boolean } = {},
): Promise<RetentionSummary> {
  const persist = opts.persist ?? true;
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    orderBy: { lastInteractionAt: { sort: "asc", nulls: "first" } },
    take: Math.min(opts.limit ?? CONTACTS_PER_TENANT, CONTACTS_PER_TENANT),
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      optedOut: true,
      lifecycleStage: true,
      aiScore: true,
      lastInteractionAt: true,
      createdAt: true,
    },
  });

  const now = new Date();
  const dayKey = dayKeyUtc(now);
  const totals: Record<RetentionTier, number> = {
    [RetentionTier.ACTIVE]: 0,
    [RetentionTier.COOLING]: 0,
    [RetentionTier.DORMANT]: 0,
    [RetentionTier.LOST]: 0,
  };
  const rows: ContactRetentionRow[] = [];

  for (const contact of contacts) {
    const scored = scoreContact(contact, now);
    totals[scored.tier] += 1;
    rows.push({
      contactId: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      tier: scored.tier,
      score: scored.score,
      daysSinceInteraction: scored.daysSinceInteraction,
      optedOut: contact.optedOut,
      lifecycleStage: contact.lifecycleStage,
      recommendation: scored.recommendation,
      assessedAt: now,
      factors: scored.factors,
    });

    if (persist) {
      const factorsJson = scored.factors as unknown as Prisma.InputJsonValue;
      try {
        await prisma.contactRetentionScore.upsert({
          where: {
            tenantId_contactId_dayKey: { tenantId, contactId: contact.id, dayKey },
          },
          update: {
            assessedAt: now,
            score: scored.score,
            tier: scored.tier,
            daysSinceInteraction: scored.daysSinceInteraction,
            factors: factorsJson,
            recommendation: scored.recommendation,
          },
          create: {
            tenantId,
            contactId: contact.id,
            dayKey,
            score: scored.score,
            tier: scored.tier,
            daysSinceInteraction: scored.daysSinceInteraction,
            factors: factorsJson,
            recommendation: scored.recommendation,
          },
        });
      } catch (err) {
        console.error(
          `[retention] upsert failed for contact ${contact.id}:`,
          err,
        );
      }
    }
  }

  const tierRank: Record<RetentionTier, number> = {
    [RetentionTier.LOST]: 0,
    [RetentionTier.DORMANT]: 1,
    [RetentionTier.COOLING]: 2,
    [RetentionTier.ACTIVE]: 3,
  };
  rows.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.score - b.score);

  return { tenantId, generatedAt: now, totals, totalScored: rows.length, rows };
}

/**
 * Customer-facing read. With refresh=true it recomputes (and persists)
 * today's scores; otherwise it serves the latest persisted rows and only
 * recomputes if nothing has been scored yet.
 */
export async function listRetention(args: {
  tenantId: string;
  refresh?: boolean;
  tier?: RetentionTier;
  limit?: number;
}): Promise<RetentionSummary> {
  if (args.refresh) {
    const summary = await assessTenantRetention(args.tenantId, {
      limit: args.limit,
    });
    return filterSummary(summary, args.tier, args.limit);
  }

  const latest = await prisma.contactRetentionScore.findFirst({
    where: { tenantId: args.tenantId },
    orderBy: { assessedAt: "desc" },
    select: { dayKey: true },
  });
  if (!latest) {
    const summary = await assessTenantRetention(args.tenantId, {
      limit: args.limit,
    });
    return filterSummary(summary, args.tier, args.limit);
  }

  const stored = await prisma.contactRetentionScore.findMany({
    where: {
      tenantId: args.tenantId,
      dayKey: latest.dayKey,
      ...(args.tier ? { tier: args.tier } : {}),
    },
    orderBy: [{ score: "asc" }],
    take: args.limit ?? 200,
    include: {
      contact: {
        select: {
          name: true,
          phoneNumber: true,
          optedOut: true,
          lifecycleStage: true,
        },
      },
    },
  });

  // Totals come from the full day's set, independent of the tier filter.
  const grouped = await prisma.contactRetentionScore.groupBy({
    by: ["tier"],
    where: { tenantId: args.tenantId, dayKey: latest.dayKey },
    _count: { _all: true },
  });
  const totals: Record<RetentionTier, number> = {
    [RetentionTier.ACTIVE]: 0,
    [RetentionTier.COOLING]: 0,
    [RetentionTier.DORMANT]: 0,
    [RetentionTier.LOST]: 0,
  };
  for (const g of grouped) totals[g.tier] = g._count._all;

  const rows: ContactRetentionRow[] = stored.map((s) => ({
    contactId: s.contactId,
    name: s.contact.name,
    phoneNumber: s.contact.phoneNumber,
    tier: s.tier,
    score: s.score,
    daysSinceInteraction: s.daysSinceInteraction,
    optedOut: s.contact.optedOut,
    lifecycleStage: s.contact.lifecycleStage,
    recommendation: s.recommendation ?? "",
    assessedAt: s.assessedAt,
    factors: s.factors as unknown as Record<FactorKey, RetentionFactor>,
  }));

  return {
    tenantId: args.tenantId,
    generatedAt: stored[0]?.assessedAt ?? new Date(),
    totals,
    totalScored: Object.values(totals).reduce((a, b) => a + b, 0),
    rows,
  };
}

function filterSummary(
  summary: RetentionSummary,
  tier: RetentionTier | undefined,
  limit: number | undefined,
): RetentionSummary {
  if (!tier) {
    return limit ? { ...summary, rows: summary.rows.slice(0, limit) } : summary;
  }
  const rows = summary.rows.filter((r) => r.tier === tier);
  return {
    ...summary,
    rows: limit ? rows.slice(0, limit) : rows,
  };
}

// ----------------------------------------------------------------------------
// Scheduled scan worker — bounded fan-out across active BUSINESS tenants.
// ----------------------------------------------------------------------------

export async function scanRetention(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { type: "BUSINESS", status: "ACTIVE" },
    select: { id: true },
    take: TENANTS_PER_SCAN,
    orderBy: { updatedAt: "desc" },
  });
  let scored = 0;
  for (const tenant of tenants) {
    try {
      const summary = await assessTenantRetention(tenant.id);
      scored += summary.totalScored;
    } catch (err) {
      console.error(`[retention] scan failed for tenant ${tenant.id}:`, err);
    }
  }
  return scored;
}

export function startContactRetentionWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void scanRetention().catch((err) => {
      console.error("[retention] scan failed:", err);
    });
  }, SCAN_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  void scanRetention().catch((err) => {
    console.error("[retention] initial scan failed:", err);
  });
}

export function stopContactRetentionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
