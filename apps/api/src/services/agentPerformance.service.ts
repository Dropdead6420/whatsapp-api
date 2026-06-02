// ============================================================================
// Agent Performance metrics (PRD-v2 §7 — Manager performance dashboard)
//
// Pure-server aggregator over what the schema already tracks:
//   - Conversation.isActive           → open count per agent
//   - Conversation.agentId / createdAt → "handled in window"
//   - Conversation.firstResponseSeconds → avg first-response time
//   - Conversation.slaBreachedAt      → SLA breaches in window
//
// Two-layer design: `summarizeAgentRows` is pure (rows in → metrics out)
// so unit tests can pin the math without touching Prisma. The DB layer
// fetches everything in 2 groupBy + 1 user query, no N+1.
// ============================================================================

import { prismaRead } from "@nexaflow/db";

export interface AgentPerformanceRow {
  agentId: string;
  agentName: string;
  agentEmail: string;
  openConversationCount: number;
  /** Conversations created in the window where this agent was assigned. */
  handledInWindow: number;
  /** Whole seconds; null when no first-response sample in the window. */
  avgFirstResponseSeconds: number | null;
  /** Conversations whose SLA tripped in the window. */
  slaBreachedCount: number;
}

export interface AgentPerformanceSummary {
  windowDays: number;
  windowStartIso: string;
  totalActiveAgents: number;
  totalOpenConversations: number;
  totalHandledInWindow: number;
  totalSlaBreaches: number;
  rows: AgentPerformanceRow[];
}

interface AgentInput {
  id: string;
  name: string;
  email: string;
}

interface ConversationStat {
  agentId: string;
  openConversationCount: number;
  handledInWindow: number;
  firstResponseSecondsSum: number;
  firstResponseSamples: number;
  slaBreachedCount: number;
}

/**
 * Pure summarizer — exported for unit tests.
 *
 * Takes:
 *   - `agents`: the active AGENT pool to enumerate (even when the agent
 *     has zero conversations, they still appear with zeroed metrics so
 *     the dashboard reflects the full team).
 *   - `statsByAgentId`: per-agent counters precomputed from raw rows.
 *
 * Returns rows sorted by (-handledInWindow, agentName) — busiest first,
 * stable alphabetical tiebreak.
 */
export function summarizeAgentRows(
  agents: AgentInput[],
  statsByAgentId: Map<string, ConversationStat>,
): AgentPerformanceRow[] {
  const rows: AgentPerformanceRow[] = agents.map((a) => {
    const stat = statsByAgentId.get(a.id);
    const samples = stat?.firstResponseSamples ?? 0;
    const sum = stat?.firstResponseSecondsSum ?? 0;
    return {
      agentId: a.id,
      agentName: a.name,
      agentEmail: a.email,
      openConversationCount: stat?.openConversationCount ?? 0,
      handledInWindow: stat?.handledInWindow ?? 0,
      avgFirstResponseSeconds:
        samples > 0 ? Math.round(sum / samples) : null,
      slaBreachedCount: stat?.slaBreachedCount ?? 0,
    };
  });
  rows.sort((a, b) => {
    if (b.handledInWindow !== a.handledInWindow) {
      return b.handledInWindow - a.handledInWindow;
    }
    return a.agentName.localeCompare(b.agentName);
  });
  return rows;
}

/**
 * Resolves the request window. Clamps to [1, 90] days; defaults to 14.
 * Returns the JS Date marking the start of the window (now - days).
 */
export function resolveWindow(rawDays: unknown): {
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
    : 14;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { windowDays: days, windowStart: start };
}

/**
 * Loads per-agent metrics for the given tenant.
 *
 * Three DB calls (active agents + 2 conversation groupBy) — none scale
 * with the number of agents, so this is cheap to call from a dashboard
 * polling endpoint.
 */
export async function getAgentPerformance(args: {
  tenantId: string;
  sinceDays?: number;
}): Promise<AgentPerformanceSummary> {
  const { windowDays, windowStart } = resolveWindow(args.sinceDays);

  const agents = await prismaRead.user.findMany({
    where: { tenantId: args.tenantId, role: "AGENT", status: "ACTIVE" },
    select: { id: true, name: true, email: true },
  });
  const agentIds = agents.map((a) => a.id);

  if (agentIds.length === 0) {
    return {
      windowDays,
      windowStartIso: windowStart.toISOString(),
      totalActiveAgents: 0,
      totalOpenConversations: 0,
      totalHandledInWindow: 0,
      totalSlaBreaches: 0,
      rows: [],
    };
  }

  // Per-agent open conversations (unbounded by window — "open right now").
  const openGrouped = await prismaRead.conversation.groupBy({
    by: ["agentId"],
    where: {
      tenantId: args.tenantId,
      isActive: true,
      agentId: { in: agentIds },
    },
    _count: { _all: true },
  });

  // Per-agent in-window stats: count + first-response aggregate +
  // SLA-breach count. One pass through the window's conversations.
  const windowedRows = await prismaRead.conversation.findMany({
    where: {
      tenantId: args.tenantId,
      agentId: { in: agentIds },
      createdAt: { gte: windowStart },
    },
    select: {
      agentId: true,
      firstResponseSeconds: true,
      slaBreachedAt: true,
    },
  });

  const stats = new Map<string, ConversationStat>();
  function bumpFor(agentId: string): ConversationStat {
    const existing = stats.get(agentId);
    if (existing) return existing;
    const row: ConversationStat = {
      agentId,
      openConversationCount: 0,
      handledInWindow: 0,
      firstResponseSecondsSum: 0,
      firstResponseSamples: 0,
      slaBreachedCount: 0,
    };
    stats.set(agentId, row);
    return row;
  }

  for (const g of openGrouped) {
    if (!g.agentId) continue;
    bumpFor(g.agentId).openConversationCount = g._count._all;
  }

  for (const row of windowedRows) {
    if (!row.agentId) continue;
    const entry = bumpFor(row.agentId);
    entry.handledInWindow += 1;
    if (typeof row.firstResponseSeconds === "number") {
      entry.firstResponseSecondsSum += row.firstResponseSeconds;
      entry.firstResponseSamples += 1;
    }
    if (row.slaBreachedAt !== null) {
      entry.slaBreachedCount += 1;
    }
  }

  const rows = summarizeAgentRows(agents, stats);

  return {
    windowDays,
    windowStartIso: windowStart.toISOString(),
    totalActiveAgents: agents.length,
    totalOpenConversations: rows.reduce(
      (acc, r) => acc + r.openConversationCount,
      0,
    ),
    totalHandledInWindow: rows.reduce((acc, r) => acc + r.handledInWindow, 0),
    totalSlaBreaches: rows.reduce((acc, r) => acc + r.slaBreachedCount, 0),
    rows,
  };
}
