// ============================================================================
// AI Agent Routing (PRD-v2 §7)
//
// PRD §7: "AI can route conversations to best agent based on skill,
// language, load, customer value, and urgency."
//
// This is a *suggestion* engine — it never auto-applies an assignee.
// The operator (BUSINESS_ADMIN / TEAM_LEAD) reviews the recommendation
// and clicks "assign" on the existing /conversations/:id/assignee
// PATCH, the same as a manual assignment. Same generate-then-approve
// discipline as ADR-030 / 033 / 035 / 038 / etc.
//
// Ranking signals available today:
//   - Load: count of OPEN conversations currently assigned to the agent
//   - Tenure: User.createdAt (oldest first as tiebreaker — seniority)
//
// Signals PRD lists but we don't yet model:
//   - Skill / language: no User columns for these (out of scope for
//     this slice; would need schema + tagging UI before being useful)
//   - Customer value: CustomerHealthScore exists at the tenant level,
//     not on the conversation; not used here
//   - Urgency: conversation labels / sentiment could feed this, but
//     interpreting "urgency" without false positives takes its own slice
//
// So this slice ranks by load + tenure (deterministic) and uses the LLM
// purely to polish the human-readable rationale. The ranking itself is
// pure, unit-tested, and never invents an agent the model wasn't given.
// ============================================================================

import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

interface AgentCandidate {
  userId: string;
  name: string;
  email: string;
  openConversationCount: number;
  /** ms since user.createdAt — higher means more senior. */
  tenureMs: number;
}

export interface AgentRouteSuggestion {
  agentId: string;
  agentName: string;
  agentEmail: string;
  /** Snapshot the operator can sanity-check. */
  openConversationCount: number;
  reasoning: string;
  source: "ai" | "fallback";
}

/**
 * Pure ranker — exported for unit tests. Returns the best candidate or
 * null when the pool is empty.
 *
 * Rules:
 *   1. Lowest openConversationCount wins (least loaded).
 *   2. Tie → most senior (highest tenureMs).
 *   3. Tie → lowest userId (stable order across runs).
 */
export function rankBestAgent(
  candidates: AgentCandidate[],
): AgentCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.openConversationCount !== b.openConversationCount) {
      return a.openConversationCount - b.openConversationCount;
    }
    if (a.tenureMs !== b.tenureMs) {
      // Higher tenure = older user = wins the tie.
      return b.tenureMs - a.tenureMs;
    }
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return sorted[0];
}

function fallbackReasoning(best: AgentCandidate, total: number): string {
  if (total === 1) {
    return `${best.name} is the only active agent on the team.`;
  }
  return (
    `${best.name} has the lightest load (${best.openConversationCount} open conversation` +
    `${best.openConversationCount === 1 ? "" : "s"}) of ${total} active agents.`
  );
}

async function collectCandidates(tenantId: string): Promise<AgentCandidate[]> {
  // Tenant-scoped agent pool. AGENT role + ACTIVE only; skips suspended
  // / pending users so the suggestion is always actionable.
  const agents = await prisma.user.findMany({
    where: { tenantId, role: "AGENT", status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
    },
  });
  if (agents.length === 0) return [];

  // One groupBy gives O(1) per-agent open-conversation count instead of
  // N queries. Conversations are "open" when isActive=true.
  const grouped = await prisma.conversation.groupBy({
    by: ["agentId"],
    where: {
      tenantId,
      isActive: true,
      agentId: { in: agents.map((a) => a.id) },
    },
    _count: { _all: true },
  });
  const loadMap = new Map<string, number>(
    grouped
      .filter((g): g is typeof g & { agentId: string } => g.agentId !== null)
      .map((g) => [g.agentId, g._count._all]),
  );

  const now = Date.now();
  return agents.map((a) => ({
    userId: a.id,
    name: a.name,
    email: a.email,
    openConversationCount: loadMap.get(a.id) ?? 0,
    tenureMs: now - a.createdAt.getTime(),
  }));
}

/**
 * High-level entry point. Loads the agent pool, picks the best
 * candidate deterministically, optionally polishes the rationale via
 * the LLM. Returns null when there are no eligible agents (caller maps
 * to 404).
 */
export async function routeBestAgent(args: {
  tenantId: string;
  conversationId: string;
}): Promise<AgentRouteSuggestion | null> {
  // Sanity check: the conversation exists in this tenant. Skip the
  // ranker work when it doesn't.
  const convo = await prisma.conversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: {
      id: true,
      labels: true,
      contact: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { content: true, direction: true },
      },
    },
  });
  if (!convo) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Conversation not found.");
  }

  const candidates = await collectCandidates(args.tenantId);
  const best = rankBestAgent(candidates);
  if (!best) return null;

  const fallback: AgentRouteSuggestion = {
    agentId: best.userId,
    agentName: best.name,
    agentEmail: best.email,
    openConversationCount: best.openConversationCount,
    reasoning: fallbackReasoning(best, candidates.length),
    source: "fallback",
  };

  // Skip the LLM call when there's only one candidate — there's nothing
  // to reason about and the deterministic blurb is the right answer.
  if (candidates.length === 1) return fallback;

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{ reasoning?: string }>({
      tenantId: args.tenantId,
      feature: "agent_router_reasoning",
      system:
        "You write a one-sentence rationale for routing a WhatsApp conversation " +
        "to a specific agent. The agent has already been chosen deterministically " +
        "by load + tenure; your job is to phrase the choice for an operator. " +
        "Under 22 words. No emoji. No apology. Mention the agent's name + the " +
        "load number explicitly. Return JSON: {\"reasoning\":\"...\"}",
      prompt: JSON.stringify({
        chosenAgent: {
          name: best.name,
          openConversationCount: best.openConversationCount,
        },
        otherAgents: candidates
          .filter((c) => c.userId !== best.userId)
          .slice(0, 5)
          .map((c) => ({
            name: c.name,
            openConversationCount: c.openConversationCount,
          })),
        conversation: {
          contactName: convo.contact?.name ?? null,
          labels: convo.labels ?? [],
          latestInbound:
            convo.messages.find((m) => m.direction === "INBOUND")?.content ??
            null,
        },
      }),
      maxTokens: 200,
      temperature: 0.4,
    });

    const reasoning = (llm.reasoning ?? "").trim().slice(0, 280);
    if (!reasoning) return fallback;
    return { ...fallback, reasoning, source: "ai" };
  } catch (err) {
    console.warn("[agent-router] LLM polish failed:", (err as Error).message);
    return fallback;
  }
}
