import { prisma } from "@nexaflow/db";
import { ApiError, MessageDirection, MessageStatus } from "@nexaflow/shared";
import { runAgent } from "./aiAgentRunner.service";
import { getDefaultAgent } from "./aiAgent.service";
import { sendWhatsAppText } from "./whatsapp";
import { canSendNow, recordSend } from "./sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "./billing.service";
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";
import { dispatchAgentTool } from "./aiAgentTool.service";

// T-052 slice 4: inbound auto-reply fallback.
//
// When an inbound WhatsApp message:
//   (a) does NOT match any keyword/event-triggered flow, AND
//   (b) the tenant has `aiAgentAutoReply: true`, AND
//   (c) the tenant has a default AiAgent that is ACTIVE
// ...then this helper runs that agent against the conversation and sends
// the reply back via WhatsApp. Returns true if it fired, false if any
// gate skipped it.
//
// Why a separate file from `flow/flowTrigger.service.ts` (the natural-
// looking host): keeping the AI plumbing here lets us mock just this
// module from the trigger-service tests, and lets the unit tests for
// THIS path stub Whatsapp/wallet/throttle/runner all in one place.

export interface InboundAutoReplyInput {
  tenantId: string;
  contactId: string;
  conversationId: string;
  text: string;
}

export type InboundAutoReplyReason =
  | "ok_sent"
  | "skipped_autoreply_off"
  | "skipped_no_default_agent"
  | "skipped_contact_opted_out"
  | "skipped_no_waba"
  | "skipped_throttled"
  | "skipped_unfunded"
  | "skipped_token_decrypt_failed"
  | "skipped_agent_escalated"
  | "skipped_agent_empty_reply"
  | "send_failed";

export interface InboundAutoReplyResult {
  fired: boolean;
  reason: InboundAutoReplyReason;
  // Populated when fired === true
  metaMessageId?: string;
  reply?: string;
  agentId?: string;
}

export async function maybeRunDefaultAgentReply(
  input: InboundAutoReplyInput,
): Promise<InboundAutoReplyResult> {
  // Gate 1: tenant-level auto-reply must be ON.
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      aiAgentAutoReply: true,
      wabaPhoneNumber: true,
      wabaAccessToken: true,
    },
  });
  if (!tenant?.aiAgentAutoReply) {
    return { fired: false, reason: "skipped_autoreply_off" };
  }

  // Gate 2: a default ACTIVE agent must exist.
  const agent = await getDefaultAgent(input.tenantId);
  if (!agent) {
    return { fired: false, reason: "skipped_no_default_agent" };
  }

  // Gate 3: contact mustn't be opted out. (We have only the contactId
  // here; refetch to get the optedOut state since the webhook caller
  // may have toggled it on this same request.)
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { phoneNumber: true, optedOut: true },
  });
  if (!contact || contact.optedOut) {
    return { fired: false, reason: "skipped_contact_opted_out" };
  }

  // Gate 4: WABA must be configured (no point running the LLM if we
  // can't send the answer back).
  if (!tenant.wabaPhoneNumber || !tenant.wabaAccessToken) {
    return { fired: false, reason: "skipped_no_waba" };
  }

  // Build the conversation snapshot for the runner. Same pattern as
  // the AI_AGENT flow node — last N messages, chronological.
  const rows = await prisma.message.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { direction: true, content: true },
  });
  const conversation = rows.reverse().map((m) => ({
    role:
      m.direction === MessageDirection.INBOUND
        ? ("user" as const)
        : ("assistant" as const),
    content: m.content,
  }));

  // If there are no messages on this conversation yet (rare; usually
  // the webhook just persisted the inbound, so we should see it),
  // synthesize from `text`.
  if (conversation.length === 0) {
    conversation.push({ role: "user", content: input.text });
  }

  const runResult = await runAgent({
    tenantId: input.tenantId,
    agentId: agent.id,
    conversation,
  });

  // Tool calls: dispatch them in the background — we don't block the
  // reply on a CREATE_LEAD or BOOK_APPOINTMENT round-trip. If a tool
  // fails we log; the agent's text reply still goes out.
  if (runResult.toolCalls.length > 0) {
    const allowedTools = Array.from(
      new Set(runResult.toolCalls.map((tc) => tc.tool)),
    );
    void Promise.all(
      runResult.toolCalls.map((tc) =>
        dispatchAgentTool(
          {
            tenantId: input.tenantId,
            contactId: input.contactId,
            conversationId: input.conversationId,
            allowedTools,
          },
          { tool: tc.tool, arguments: tc.arguments },
        ),
      ),
    ).catch((err) => {
      console.error("[ai-agent:inbound] tool dispatch error", err);
    });
  }

  if (runResult.escalated) {
    // Agent declined to answer (LLM unavailable, agent not ACTIVE in
    // a race window, etc.). We don't auto-send anything — the operator
    // can configure a SEND_TEMPLATE fallback via flows if they want
    // an explicit "we'll get back to you" message.
    return {
      fired: false,
      reason: "skipped_agent_escalated",
      agentId: agent.id,
    };
  }

  const reply = (runResult.reply ?? "").trim();
  if (!reply) {
    return {
      fired: false,
      reason: "skipped_agent_empty_reply",
      agentId: agent.id,
    };
  }

  // Throttle + wallet gates before the actual WhatsApp call. Mirror
  // the same checks MESSAGE node uses so auto-reply respects the
  // tenant's send budget exactly as a flow-driven reply would.
  const gate = await canSendNow(input.tenantId, {
    phoneNumberId: tenant.wabaPhoneNumber,
  });
  if (!gate.allowed) {
    return { fired: false, reason: "skipped_throttled", agentId: agent.id };
  }
  try {
    await assertCanAffordMessage(input.tenantId);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 402) {
      return { fired: false, reason: "skipped_unfunded", agentId: agent.id };
    }
    throw err;
  }

  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    return {
      fired: false,
      reason: "skipped_token_decrypt_failed",
      agentId: agent.id,
    };
  }

  let metaMessageId: string;
  try {
    metaMessageId = await sendWhatsAppText({
      tenantId: input.tenantId,
      phoneNumberId: tenant.wabaPhoneNumber,
      accessToken,
      to: contact.phoneNumber.replace(/^\+/, ""),
      body: reply,
    });
  } catch (err) {
    console.error("[ai-agent:inbound] send failed", err);
    return { fired: false, reason: "send_failed", agentId: agent.id };
  }

  await recordSend(input.tenantId, { phoneNumberId: tenant.wabaPhoneNumber });
  await debitMessage(input.tenantId, metaMessageId, {
    reason: `AI agent auto-reply (${agent.name})`,
  });

  await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.SENT,
      content: reply,
      metaMessageId,
      aiGenerated: true,
    },
  });

  return {
    fired: true,
    reason: "ok_sent",
    metaMessageId,
    reply,
    agentId: agent.id,
  };
}
