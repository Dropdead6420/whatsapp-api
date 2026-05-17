import { prisma } from "@nexaflow/db";
import type { SegmentFilterSpec } from "./ai.service";

export type { SegmentFilterSpec };

/**
 * Convert an AI-produced filter spec into a Prisma `where` clause for the
 * Contact model, scoped to a tenant. Values are clamped/validated so a
 * hallucinated spec can't run an unbounded query.
 */
export function specToWhere(
  tenantId: string,
  spec: SegmentFilterSpec,
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId };

  if (spec.tagsAny?.length) {
    where.tags = { hasSome: spec.tagsAny.slice(0, 50) };
  }
  if (spec.tagsAll?.length) {
    where.tags = {
      ...(typeof where.tags === "object" ? where.tags : {}),
      hasEvery: spec.tagsAll.slice(0, 50),
    };
  }
  if (typeof spec.optedOut === "boolean") {
    where.optedOut = spec.optedOut;
  }
  if (typeof spec.hasEmail === "boolean") {
    where.email = spec.hasEmail ? { not: null } : null;
  }

  // AI score range
  if (typeof spec.aiScoreGte === "number" || typeof spec.aiScoreLte === "number") {
    const range: Record<string, number> = {};
    if (typeof spec.aiScoreGte === "number") range.gte = Math.max(0, Math.min(1, spec.aiScoreGte));
    if (typeof spec.aiScoreLte === "number") range.lte = Math.max(0, Math.min(1, spec.aiScoreLte));
    where.aiScore = range;
  }

  // Time-based filters
  if (typeof spec.inactiveSinceDays === "number" && spec.inactiveSinceDays > 0) {
    const cutoff = new Date(Date.now() - spec.inactiveSinceDays * 86_400_000);
    where.OR = [
      { lastInteractionAt: { lt: cutoff } },
      { lastInteractionAt: null },
    ];
  }
  if (typeof spec.interactedWithinDays === "number" && spec.interactedWithinDays > 0) {
    const cutoff = new Date(Date.now() - spec.interactedWithinDays * 86_400_000);
    where.lastInteractionAt = { gte: cutoff };
  }

  return where;
}

/** Aggregate all distinct tags for a tenant (capped). */
export async function listTenantTags(
  tenantId: string,
  limit = 200,
): Promise<string[]> {
  const rows = await prisma.contact.findMany({
    where: { tenantId },
    select: { tags: true },
    take: 2000,
  });
  const set = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) {
      set.add(tag);
      if (set.size >= limit) break;
    }
    if (set.size >= limit) break;
  }
  return [...set];
}
