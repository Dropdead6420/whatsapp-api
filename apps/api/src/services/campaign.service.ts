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

let interval: ReturnType<typeof setInterval> | null = null;

export async function startCampaignWorker(intervalMs = 30_000): Promise<void> {
  if (interval) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[campaign-worker] database unavailable; worker not started. Start Postgres and restart the API to enable scheduled campaigns.",
    );
    return;
  }

  const tick = async () => {
    try {
      const due = await prisma.campaign.findMany({
        where: {
          status: CampaignStatus.SCHEDULED,
          scheduledFor: { lte: new Date() },
        },
        take: 5,
      });
      for (const c of due) {
        await dispatchCampaign(c.id);
      }
    } catch (err) {
      console.error("[campaign-worker] tick failed", err);
    }
  };
  // Defer first tick so connect happens after startup completes.
  setTimeout(tick, 5_000);
  interval = setInterval(tick, intervalMs);
}

export function stopCampaignWorker(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
