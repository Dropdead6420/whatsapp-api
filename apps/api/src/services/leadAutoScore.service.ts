import { Worker } from "bullmq";
import { prisma, LeadStatus } from "@nexaflow/db";
import { recommendLeadFollowUp } from "./ai.service";
import { getTenantFeatures } from "./features.service";
import {
  getLeadAutoScoreQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type LeadAutoScoreJobData,
} from "../lib/queue";

// ----------------------------------------------------------------------------
// Lead auto-score worker (PRD §3.3.8 + Phase 3 follow-ups).
//
// Operators were getting AI follow-up recommendations only when they
// manually clicked "Recommend follow-up" on the /leads board. This worker
// closes that gap: it sweeps for leads that are
//
//   - not closed
//   - have no current recommendation OR the most recent recommendation was
//     either sent or generated long enough ago to be stale
//   - haven't been touched recently (so we don't undo a fresh operator edit)
//   - have a contact who is NOT opted out
//
// …and calls recommendLeadFollowUp() on them, persisting the result. The
// existing send-side worker (leadFollowUp.service) then picks up any that
// the operator schedules.
//
// Failures are per-lead: one bad LLM call must not poison the rest of the
// scan. We never retry within the scan — the next tick will pick it up if
// staleness is still true.
// ----------------------------------------------------------------------------

const STALE_RECOMMENDATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_LEAD_IDLE_MS = 24 * 60 * 60 * 1000; // 24 hours
const TENANT_BATCH_SIZE = 10; // cap per-tenant LLM calls per tick

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((a.getTime() - b.getTime()) / 86_400_000));
}

/**
 * Find tenants with at least one lead that's a candidate for auto-score.
 * Returns a deduped list of tenant ids; we walk them serially so a single
 * busy tenant can't starve the rest.
 */
async function findTenantsWithCandidates(now: Date): Promise<string[]> {
  const recommendCutoff = new Date(now.getTime() - STALE_RECOMMENDATION_MS);
  const idleCutoff = new Date(now.getTime() - MIN_LEAD_IDLE_MS);

  const rows = await prisma.lead.findMany({
    where: {
      status: { notIn: [LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST] },
      updatedAt: { lt: idleCutoff },
      contact: { optedOut: false },
      OR: [
        { followUpStatus: null },
        { followUpStatus: "SENT" },
        {
          followUpRecommendedAt: { lt: recommendCutoff },
        },
      ],
    },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 100,
  });
  return rows.map((r) => r.tenantId);
}

/**
 * Per-tenant pass — picks the oldest stale leads (capped), then runs the
 * recommendation pipeline on each. Skips when the tenant has the
 * followUpRecommendations feature disabled.
 */
export async function autoScoreTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ scanned: number; recommended: number; skipped: number }> {
  const features = await getTenantFeatures(tenantId);
  if (!features.followUpRecommendations) {
    return { scanned: 0, recommended: 0, skipped: 0 };
  }

  const recommendCutoff = new Date(now.getTime() - STALE_RECOMMENDATION_MS);
  const idleCutoff = new Date(now.getTime() - MIN_LEAD_IDLE_MS);

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      status: { notIn: [LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST] },
      updatedAt: { lt: idleCutoff },
      contact: { optedOut: false },
      OR: [
        { followUpStatus: null },
        { followUpStatus: "SENT" },
        { followUpRecommendedAt: { lt: recommendCutoff } },
      ],
    },
    orderBy: [
      { followUpRecommendedAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
    ],
    take: TENANT_BATCH_SIZE,
    include: {
      contact: true,
    },
  });

  if (leads.length === 0) {
    return { scanned: 0, recommended: 0, skipped: 0 };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  const businessName = tenant?.name ?? "the business";

  let recommended = 0;
  let skipped = 0;
  for (const lead of leads) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { tenantId, contactId: lead.contactId },
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { direction: true, content: true, createdAt: true },
          },
        },
      });

      const rec = await recommendLeadFollowUp(tenantId, {
        businessName,
        leadTitle: lead.title,
        leadDescription: lead.description,
        leadStatus: lead.status,
        leadValue: lead.value,
        leadProbability: lead.probability,
        contactName: lead.contact.name,
        contactTags: lead.contact.tags,
        contactOptedOut: lead.contact.optedOut,
        daysSinceLeadUpdated: daysBetween(now, lead.updatedAt),
        daysSinceLastInteraction: lead.contact.lastInteractionAt
          ? daysBetween(now, lead.contact.lastInteractionAt)
          : null,
        recentMessages:
          conversation?.messages
            .slice()
            .reverse()
            .map((m) => ({
              direction: m.direction,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            })) ?? [],
        // No operator-supplied goal in the auto path — let the model pick.
        goal: undefined,
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpStatus: "RECOMMENDED",
          followUpPriority: rec.priority,
          followUpMessage: rec.message,
          followUpReason: rec.reasoning,
          followUpDueAt: new Date(rec.dueAt),
          followUpRecommendedAt: now,
          followUpLastError: null,
        },
      });
      recommended += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        `[lead-autoscore] tenant=${tenantId} lead=${lead.id} skipped:`,
        (err as Error).message,
      );
    }
  }

  return { scanned: leads.length, recommended, skipped };
}

async function scanAllTenants(): Promise<{
  tenants: number;
  recommended: number;
  skipped: number;
}> {
  const now = new Date();
  const tenantIds = await findTenantsWithCandidates(now);
  let recommended = 0;
  let skipped = 0;
  for (const tenantId of tenantIds) {
    try {
      const result = await autoScoreTenant(tenantId, now);
      recommended += result.recommended;
      skipped += result.skipped;
    } catch (err) {
      console.warn(
        `[lead-autoscore] tenant=${tenantId} scan failed:`,
        (err as Error).message,
      );
    }
  }
  return { tenants: tenantIds.length, recommended, skipped };
}

// ----------------------------------------------------------------------------
// BullMQ worker. Hourly cadence — LLM calls aren't free and the scan
// criteria already guarantee per-lead idleness > 24h.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SCAN_JOB_NAME = "scan";

let autoScoreWorker: Worker<LeadAutoScoreJobData> | null = null;

export async function startLeadAutoScoreWorker(): Promise<void> {
  if (autoScoreWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[lead-autoscore] database unavailable; worker not started.",
    );
    return;
  }

  const q = getLeadAutoScoreQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[lead-autoscore] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }

  autoScoreWorker = new Worker<LeadAutoScoreJobData>(
    QueueNames.LEAD_AUTOSCORE,
    async (job) => {
      if (job.name !== SCAN_JOB_NAME) return { skipped: true };
      return scanAllTenants();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  autoScoreWorker.on("failed", (job, err) => {
    console.error(
      `[lead-autoscore] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  trackWorker(autoScoreWorker);
}

export function stopLeadAutoScoreWorker(): void {
  if (!autoScoreWorker) return;
  void autoScoreWorker.close();
  autoScoreWorker = null;
}
