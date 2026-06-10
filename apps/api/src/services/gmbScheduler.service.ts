import { prisma, GmbPostStatus } from "@nexaflow/db";

// =====================================================================
// AdGrowly GMB — Scheduled-post publisher (planning PDF §3 Post Scheduler).
// Selects due SCHEDULED posts and publishes them. Live Google Business Profile
// publishing wires into `publishDuePosts` later (replacing the stub mark-as-
// published with per-post API calls + FAILED-on-error retry handling). The
// selection helper is pure and unit-tested.
// =====================================================================

export interface SchedulablePost {
  id: string;
  status: GmbPostStatus;
  scheduledAt: Date | string | null;
}

/** Posts that are SCHEDULED and whose scheduledAt is at/before `now`. */
export function selectDuePosts<T extends SchedulablePost>(posts: T[], now: Date): T[] {
  return posts.filter(
    (p) =>
      p.status === GmbPostStatus.SCHEDULED &&
      p.scheduledAt != null &&
      new Date(p.scheduledAt).getTime() <= now.getTime(),
  );
}

export interface PublishResult {
  published: number;
  ids: string[];
}

/**
 * Publish all of a tenant's due scheduled posts. Currently a stub that marks
 * them PUBLISHED (no live Google connection yet); the real publish call slots
 * in here, setting FAILED + error on failure so a later run can retry.
 */
export async function publishDuePosts(tenantId: string, now: Date = new Date()): Promise<PublishResult> {
  const due = await prisma.gmbPost.findMany({
    where: { tenantId, status: GmbPostStatus.SCHEDULED, scheduledAt: { lte: now } },
    select: { id: true },
  });
  if (due.length === 0) return { published: 0, ids: [] };

  const ids = due.map((d) => d.id);
  await prisma.gmbPost.updateMany({
    where: { id: { in: ids } },
    data: { status: GmbPostStatus.PUBLISHED, publishedAt: now, error: null },
  });
  return { published: ids.length, ids };
}
