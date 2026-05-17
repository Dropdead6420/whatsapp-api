import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  MessageDirection,
  MessageStatus,
} from "@nexaflow/shared";
import { assertCanSend, recordSend } from "./sendThrottle.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { emitWebhookEvent } from "./webhook.service";

let workerStarted = false;

async function getTenantWabaConfig(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { wabaPhoneNumber: true, wabaAccessToken: true },
  });
  if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp Business API is not configured for this tenant.",
    );
  }
  return {
    phoneNumberId: tenant.wabaPhoneNumber,
    accessToken: tenant.wabaAccessToken,
  };
}

async function getOrCreateConversation(tenantId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, contactId },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: {
      tenantId,
      contactId,
      isActive: true,
      lastMessageAt: new Date(),
    },
  });
}

export async function sendLeadFollowUp(
  leadId: string,
  tenantId: string,
): Promise<{
  lead: unknown;
  message: unknown;
  conversation: unknown;
  metaMessageId: string;
}> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: { contact: true },
  });
  if (!lead) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Lead not found.");
  }
  if (!lead.followUpMessage) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Generate or write a follow-up message before sending.",
    );
  }
  if (lead.contact.optedOut) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "This contact has opted out of WhatsApp messages.",
    );
  }

  await assertCanSend(tenantId);
  const config = await getTenantWabaConfig(tenantId);
  const conversation = await getOrCreateConversation(tenantId, lead.contactId);
  const metaMessageId = await sendWhatsAppText({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    to: lead.contact.phoneNumber.replace(/^\+/, ""),
    body: lead.followUpMessage,
  });
  await recordSend(tenantId);

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT,
      content: lead.followUpMessage,
      metaMessageId,
    },
  });
  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastOutboundAt: now,
      slaBreachedAt: null,
    },
  });
  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      followUpStatus: "SENT",
      followUpSentAt: now,
      followUpLastError: null,
    },
    include: {
      contact: true,
      assignee: { select: { id: true, name: true } },
    },
  });

  void emitWebhookEvent(tenantId, "MESSAGE_SENT", {
    conversationId: conversation.id,
    messageId: message.id,
    contactId: lead.contactId,
    leadId: lead.id,
    content: lead.followUpMessage,
    source: "lead_follow_up",
  });

  return {
    lead: updatedLead,
    message,
    conversation: updatedConversation,
    metaMessageId,
  };
}

async function processDueFollowUps(): Promise<void> {
  const due = await prisma.lead.findMany({
    where: {
      followUpStatus: "SCHEDULED",
      followUpDueAt: { lte: new Date() },
      status: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
    },
    orderBy: { followUpDueAt: "asc" },
    take: 25,
    select: { id: true, tenantId: true },
  });

  for (const lead of due) {
    try {
      await sendLeadFollowUp(lead.id, lead.tenantId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send scheduled follow-up.";
      await prisma.lead.update({
        where: { id: lead.id },
        data: { followUpStatus: "FAILED", followUpLastError: message },
      });
      console.warn("[lead-follow-up] scheduled send failed", lead.id, message);
    }
  }
}

export async function startLeadFollowUpWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.warn(
      "[lead-follow-up] database unavailable, worker not started:",
      (err as Error).message,
    );
    return;
  }

  console.log("[lead-follow-up] worker started");
  setInterval(() => {
    void processDueFollowUps().catch((err) =>
      console.error("[lead-follow-up] worker tick failed", err),
    );
  }, 60_000);
}
