import { prisma } from "@nexaflow/db";
import { type SecretContext } from "./secretVault.service";

// =====================================================================
// AI Cost Manager (Complete Planning PDF §2.10 / Phase 4 "AI cost
// manager ... profit dashboard"). Aggregates the existing AiUsage ledger
// into a spend summary, scoped via the hub's context: PLATFORM sees all
// tenants, PARTNER / CUSTOMER see their own tenant. Pure summarisation is
// split out for unit testing; the DB layer just fetches the window.
// =====================================================================

export interface AiUsageEvent {
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  costInCents: number;
  createdAt: Date;
}

export interface AiUsageBucket {
  key: string;
  events: number;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageDayBucket {
  date: string; // YYYY-MM-DD (UTC)
  events: number;
  costCents: number;
}

export interface AiUsageSummary {
  sinceDays: number;
  totalEvents: number;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: AiUsageBucket[];
  byFeature: AiUsageBucket[];
  byDay: AiUsageDayBucket[];
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure aggregation of usage events into a spend summary. `byModel` /
 * `byFeature` are sorted by cost (desc); `byDay` is chronological.
 */
export function summarizeAiUsage(
  events: AiUsageEvent[],
  sinceDays: number,
): AiUsageSummary {
  const models = new Map<string, AiUsageBucket>();
  const features = new Map<string, AiUsageBucket>();
  const days = new Map<string, AiUsageDayBucket>();

  let totalCostCents = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const e of events) {
    totalCostCents += e.costInCents;
    totalInputTokens += e.inputTokens;
    totalOutputTokens += e.outputTokens;

    const m = models.get(e.model) ?? {
      key: e.model,
      events: 0,
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    m.events += 1;
    m.costCents += e.costInCents;
    m.inputTokens += e.inputTokens;
    m.outputTokens += e.outputTokens;
    models.set(e.model, m);

    const f = features.get(e.feature) ?? {
      key: e.feature,
      events: 0,
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    f.events += 1;
    f.costCents += e.costInCents;
    f.inputTokens += e.inputTokens;
    f.outputTokens += e.outputTokens;
    features.set(e.feature, f);

    const dk = dayKey(e.createdAt);
    const d = days.get(dk) ?? { date: dk, events: 0, costCents: 0 };
    d.events += 1;
    d.costCents += e.costInCents;
    days.set(dk, d);
  }

  const byCost = (a: AiUsageBucket, b: AiUsageBucket) =>
    b.costCents - a.costCents || b.events - a.events;

  return {
    sinceDays,
    totalEvents: events.length,
    totalCostCents,
    totalInputTokens,
    totalOutputTokens,
    byModel: [...models.values()].sort(byCost),
    byFeature: [...features.values()].sort(byCost),
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Fetch the AiUsage window for the caller's scope and summarise it. */
export async function getAiUsageSummary(
  ctx: SecretContext,
  sinceDays = 30,
): Promise<AiUsageSummary> {
  const days = Math.min(Math.max(Math.trunc(sinceDays) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await prisma.aiUsage.findMany({
    where: {
      // PLATFORM (SuperAdmin) → all tenants; PARTNER / CUSTOMER → own tenant.
      ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
      createdAt: { gte: since },
    },
    select: {
      model: true,
      feature: true,
      inputTokens: true,
      outputTokens: true,
      costInCents: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return summarizeAiUsage(events, days);
}
