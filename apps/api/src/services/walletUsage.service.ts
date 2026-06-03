// ============================================================================
// Wallet usage aggregation (Claude FINAL §4 "usage graph" + §5
// GET /customer/wallets/usage).
//
// The customer wallet view already shows balance, ledger, invoices,
// low-balance + auto-recharge settings. The one PRD-listed item left
// was the usage graph: a per-day breakdown of what's burning credits.
//
// This reads DEBIT WalletTransactions over a window and buckets them by
// UTC day + category (messaging / AI / workflow / other). The bucketing
// is a pure function so the day-rollover math + category mapping are
// unit-tested without a DB.
// ============================================================================

import { prismaRead } from "@nexaflow/db";

export type UsageCategory = "messaging" | "ai" | "workflow" | "other";

export interface UsageDayBucket {
  /** YYYY-MM-DD (UTC). */
  day: string;
  messaging: number;
  ai: number;
  workflow: number;
  other: number;
  total: number;
}

export interface WalletUsageSummary {
  windowDays: number;
  windowStartIso: string;
  totalDebited: number;
  byCategory: Record<UsageCategory, number>;
  days: UsageDayBucket[];
}

/** Minimal shape the aggregator needs from a transaction row. */
export interface UsageInputRow {
  type: string;
  direction: string;
  amountCredits: number;
  createdAt: Date;
}

/** Maps a WalletTransactionType to a usage category. Pure. */
export function categorizeTransactionType(type: string): UsageCategory {
  switch (type) {
    case "MESSAGE_DEBIT":
      return "messaging";
    case "AI_DEBIT":
      return "ai";
    case "WORKFLOW_DEBIT":
      return "workflow";
    default:
      return "other";
  }
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves the window. Clamps to [1, 90] days, default 30. Returns the
 * UTC-midnight start so a row from any hour of the start day is
 * included.
 */
export function resolveUsageWindow(rawDays: unknown): {
  windowDays: number;
  windowStart: Date;
} {
  const parsed =
    typeof rawDays === "number"
      ? rawDays
      : typeof rawDays === "string"
        ? Number.parseInt(rawDays, 10)
        : NaN;
  const days = Number.isFinite(parsed)
    ? Math.min(90, Math.max(1, Math.trunc(parsed)))
    : 30;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);
  return { windowDays: days, windowStart: start };
}

/**
 * Pure aggregator — exported for tests. Buckets DEBIT rows by UTC day +
 * category. CREDIT rows (recharges) are ignored: this is a *usage*
 * graph, not a balance graph.
 *
 * Emits one bucket per calendar day in [windowStart, now] so the chart
 * has no gaps, even on days with zero usage.
 */
export function aggregateUsageByDay(
  rows: ReadonlyArray<UsageInputRow>,
  args: { windowStart: Date; now: Date },
): WalletUsageSummary {
  // Seed every day in the window so the series is dense.
  const buckets = new Map<string, UsageDayBucket>();
  const cursor = new Date(args.windowStart);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(args.now);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    const key = utcDayKey(cursor);
    buckets.set(key, {
      day: key,
      messaging: 0,
      ai: 0,
      workflow: 0,
      other: 0,
      total: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const byCategory: Record<UsageCategory, number> = {
    messaging: 0,
    ai: 0,
    workflow: 0,
    other: 0,
  };
  let totalDebited = 0;

  for (const row of rows) {
    if (row.direction !== "DEBIT") continue;
    if (row.createdAt.getTime() < args.windowStart.getTime()) continue;
    const key = utcDayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue; // row outside the seeded range
    const category = categorizeTransactionType(row.type);
    const amt = Math.max(0, row.amountCredits);
    bucket[category] += amt;
    bucket.total += amt;
    byCategory[category] += amt;
    totalDebited += amt;
  }

  const days = [...buckets.values()].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  );

  return {
    windowDays: days.length,
    windowStartIso: args.windowStart.toISOString(),
    totalDebited,
    byCategory,
    days,
  };
}

/**
 * DB entry point for GET /customer/wallets/usage.
 */
export async function getWalletUsage(args: {
  tenantId: string;
  sinceDays?: number;
}): Promise<WalletUsageSummary> {
  const { windowDays, windowStart } = resolveUsageWindow(args.sinceDays);
  const now = new Date();

  const rows = await prismaRead.walletTransaction.findMany({
    where: {
      tenantId: args.tenantId,
      direction: "DEBIT",
      createdAt: { gte: windowStart },
    },
    select: { type: true, direction: true, amountCredits: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });

  const summary = aggregateUsageByDay(rows, { windowStart, now });
  // resolveUsageWindow already decided the day count; keep it stable
  // even if the seeded range produced the same number.
  summary.windowDays = windowDays;
  return summary;
}
