import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  CampaignStatus,
  MessageDirection,
  MessageStatus,
} from "@nexaflow/shared";
import { sendWhatsAppTemplate } from "./whatsapp.service";
import { specToWhere, type SegmentFilterSpec } from "./segment.service";
import { canSendNow, recordSend } from "./sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "./billing.service";
import { ApiError } from "@nexaflow/shared";
import {
  getCampaignQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type CampaignJobData,
} from "../lib/queue";

interface CampaignAudience {
  contactIds?: string[];
  tags?: string[];
  filterSpec?: SegmentFilterSpec;
  optedOut?: false;
}

function parseAudience(json: string): CampaignAudience {
  try {
    return JSON.parse(json) as CampaignAudience;
  } catch {
    return {};
  }
}

async function resolveAudience(
  tenantId: string,
  audience: CampaignAudience,
): Promise<Array<{ id: string; phoneNumber: string }>> {
  // Prefer rich filter spec when present.
  if (audience.filterSpec) {
    const where = specToWhere(tenantId, audience.filterSpec);
    // Always exclude opted-out for sends, regardless of spec.
    (where as Record<string, unknown>).optedOut = false;
    return prisma.contact.findMany({
      where,
      select: { id: true, phoneNumber: true },
    });
  }

  const where: Record<string, unknown> = { tenantId, optedOut: false };
  if (audience.contactIds?.length) where.id = { in: audience.contactIds };
  if (audience.tags?.length) where.tags = { hasSome: audience.tags };
  return prisma.contact.findMany({
    where,
    select: { id: true, phoneNumber: true },
  });
}

export async function dispatchCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, tenant: true },
  });
  if (!campaign) return;
  if (campaign.status !== CampaignStatus.SCHEDULED && campaign.status !== CampaignStatus.DRAFT) {
    return;
  }
  if (!campaign.tenant.wabaPhoneNumber || !campaign.tenant.wabaAccessToken) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.FAILED },
    });
    return;
  }

  const audience = parseAudience(campaign.targetContacts);
  const contacts = await resolveAudience(campaign.tenantId, audience);

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: CampaignStatus.RUNNING,
      startedAt: new Date(),
      totalContacts: contacts.length,
    },
  });

  let sent = 0;
  let failed = 0;
  let throttled = 0;
  for (const contact of contacts) {
    try {
      // Throttle gate: respects monthly quota + per-second smoothing. If the
      // per-second window is full, wait briefly and re-check (campaigns are
      // background work — we can absorb the smoothing delay).
      let gate = await canSendNow(campaign.tenantId);
      if (!gate.allowed && gate.retryAfterMs) {
        await new Promise((r) => setTimeout(r, gate.retryAfterMs));
        gate = await canSendNow(campaign.tenantId);
      }
      if (!gate.allowed) {
        // Monthly quota exhausted — stop the campaign so the rest doesn't fail.
        throttled = contacts.length - (sent + failed);
        console.warn(
          `[campaign:${campaign.id}] halted: ${gate.reason}`,
        );
        break;
      }

      // Wallet pre-check. If the tenant can't afford this send, halt the
      // campaign (don't fail individual messages) so the remaining contacts
      // can be picked up after a top-up.
      try {
        await assertCanAffordMessage(campaign.tenantId);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 402) {
          throttled = contacts.length - (sent + failed);
          console.warn(
            `[campaign:${campaign.id}] halted: ${err.message}`,
          );
          break;
        }
        throw err;
      }

      const metaMessageId = await sendWhatsAppTemplate({
        phoneNumberId: campaign.tenant.wabaPhoneNumber,
        accessToken: campaign.tenant.wabaAccessToken,
        to: contact.phoneNumber.replace(/^\+/, ""),
        templateName: campaign.template.name,
        languageCode: campaign.template.language ?? "en_US",
      });
      await recordSend(campaign.tenantId);
      await debitMessage(campaign.tenantId, metaMessageId, {
        reason: `Campaign ${campaign.id}`,
      });
      const convo = await prisma.conversation.upsert({
        where: {
          id: (
            await prisma.conversation.findFirst({
              where: { tenantId: campaign.tenantId, contactId: contact.id, isActive: true },
              select: { id: true },
            })
          )?.id ?? "____none____",
        },
        update: { lastMessageAt: new Date() },
        create: {
          tenantId: campaign.tenantId,
          contactId: contact.id,
          isActive: true,
          lastMessageAt: new Date(),
        },
      });
      await prisma.message.create({
        data: {
          conversationId: convo.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: campaign.template.bodyText,
          templateId: campaign.templateId,
          campaignId: campaign.id,
          metaMessageId,
        },
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error("[campaign] send failed for contact", contact.id, err);
    }
  }

  const finalStatus =
    sent === 0 && failed > 0
      ? CampaignStatus.FAILED
      : throttled > 0 && sent === 0
        ? CampaignStatus.PAUSED // hit quota immediately — leave for next cycle
        : CampaignStatus.COMPLETED;

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: finalStatus,
      completedAt: finalStatus === CampaignStatus.COMPLETED ? new Date() : null,
      sentCount: sent,
    },
  });
}

// ----------------------------------------------------------------------------
// Producer API — both the API route ("send now") and the scan scheduler
// call enqueueCampaign. `jobId` deduplicates: if the same campaign is
// enqueued twice (e.g. scheduler tick + manual send), BullMQ silently drops
// the second add. The worker is the single mover of state for SCHEDULED →
// RUNNING / COMPLETED / FAILED / PAUSED.
// ----------------------------------------------------------------------------

export async function enqueueCampaign(campaignId: string): Promise<void> {
  const q = getCampaignQueue();
  await q.add(
    "dispatch",
    { campaignId },
    {
      // Idempotency: same campaign enqueued twice collapses into one job.
      jobId: `dispatch:${campaignId}`,
    },
  );
}

async function scanScheduledCampaigns(): Promise<number> {
  const due = await prisma.campaign.findMany({
    where: {
      status: CampaignStatus.SCHEDULED,
      scheduledFor: { lte: new Date() },
    },
    select: { id: true },
    take: 100,
  });
  for (const c of due) {
    await enqueueCampaign(c.id);
  }
  return due.length;
}

// ----------------------------------------------------------------------------
// Worker lifecycle — replaces the old setInterval polling loop. The worker
// processes two job kinds on the same queue:
//
//   1. "scan"     — repeated by BullMQ every SCAN_INTERVAL_MS; queries
//                   SCHEDULED campaigns whose scheduledFor <= now and
//                   enqueues a "dispatch" job for each.
//   2. "dispatch" — runs dispatchCampaign(campaignId). One concurrent
//                   per worker instance; horizontal scale comes from running
//                   APP_MODE=worker on multiple boxes.
//
// On Redis outage we log + degrade to no-op rather than crashing the API.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 30_000;
const SCAN_JOB_NAME = "scan";

let campaignWorker: Worker<CampaignJobData> | null = null;

export async function startCampaignWorker(): Promise<void> {
  if (campaignWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[campaign-worker] database unavailable; worker not started. Start Postgres and restart the API to enable scheduled campaigns.",
    );
    return;
  }

  const q = getCampaignQueue();

  // Reset any pre-existing scan schedule so we don't accumulate duplicates
  // on a redeploy with a different interval. Failures are non-fatal — the
  // first scheduler.add below will overwrite.
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan-scheduled" } },
    );
  } catch (err) {
    console.warn(
      "[campaign-worker] could not register scan scheduler (Redis unavailable?)",
      (err as Error).message,
    );
    return;
  }

  campaignWorker = new Worker<CampaignJobData>(
    QueueNames.CAMPAIGN_DISPATCH,
    async (job) => {
      if (job.name === SCAN_JOB_NAME) {
        const enqueued = await scanScheduledCampaigns();
        return { enqueued };
      }
      const data = job.data as { campaignId: string };
      await dispatchCampaign(data.campaignId);
      return { dispatched: data.campaignId };
    },
    {
      connection: getQueueConnection(),
      // One dispatch at a time per worker; horizontal concurrency comes from
      // running multiple worker processes. Bumping this risks tripping the
      // per-tenant throttle inside dispatchCampaign.
      concurrency: 1,
    },
  );

  campaignWorker.on("failed", (job, err) => {
    console.error(
      `[campaign-worker] job ${job?.id} (${job?.name}) failed:`,
      err?.message,
    );
  });
  campaignWorker.on("error", (err) => {
    // Redis disconnects bubble here; BullMQ will reconnect.
    console.error("[campaign-worker] worker error:", err.message);
  });

  trackWorker(campaignWorker);
}

export function stopCampaignWorker(): void {
  if (campaignWorker) {
    void campaignWorker.close();
    campaignWorker = null;
  }
}
