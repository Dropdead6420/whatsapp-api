import { prisma } from "@nexaflow/db";
import { getRedis } from "../lib/redis";

/**
 * Pick the next agent for a new conversation using round-robin across active
 * agents in the tenant. Uses Redis INCR to advance the cursor atomically.
 *
 * Returns null if no eligible agent is available (caller should leave the
 * conversation unassigned so a team lead can pick it up manually).
 */
export async function pickNextAgent(
  tenantId: string,
): Promise<string | null> {
  const agents = await prisma.user.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      role: { in: ["AGENT", "TEAM_LEAD"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (agents.length === 0) return null;

  let cursor = 0;
  try {
    const r = await getRedis();
    // Hash-tag the tenant id so future Redis Cluster keeps all routing
    // keys for one tenant on the same slot.
    const raw = await r.incr(`routing:{${tenantId}}:cursor`);
    cursor = (raw - 1) % agents.length;
    if (cursor < 0) cursor += agents.length;
  } catch {
    // Redis unavailable — fall back to random; better than crashing.
    cursor = Math.floor(Math.random() * agents.length);
  }

  return agents[cursor].id;
}
