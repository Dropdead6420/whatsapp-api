// ============================================================================
// AI Support Ticket Resolver (Claude FINAL §9).
//
// Drafts a suggested partner reply to a customer support ticket. Same
// generate-then-approve discipline as the inbox reply-suggest / win-back
// copy: the LLM produces a draft, the partner reviews + edits, then
// sends via the existing partnerReplyToTicket. We never auto-send.
//
// Internal notes ARE fed to the model as context (they're the partner's
// private working notes on the ticket) but the draft itself is
// customer-facing — the system prompt is explicit that the output must
// never quote or reference internal notes.
//
// Deterministic fallback always renders, so a missing API key / LLM
// outage degrades to a safe generic acknowledgement rather than a dead
// button.
// ============================================================================

import { getPartnerTicket } from "./supportTicket.service";

export interface TicketMessageLike {
  senderType: string; // CUSTOMER | PARTNER | SYSTEM
  content: string;
  internalNote: boolean;
  createdAt: Date;
}

export interface TicketReplySuggestion {
  draft: string;
  source: "ai" | "fallback";
}

const MAX_TRANSCRIPT_MESSAGES = 30;

/**
 * Formats the ticket thread for the LLM prompt. Pure — exported for
 * tests. Internal notes are kept (labeled) so the model has the
 * partner's context; customer + partner messages are labeled by role.
 * Caps to the most recent N messages so a long thread can't blow the
 * token budget.
 */
export function buildTicketTranscript(
  messages: ReadonlyArray<TicketMessageLike>,
): string {
  const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES);
  return recent
    .map((m) => {
      const who =
        m.senderType === "CUSTOMER"
          ? "Customer"
          : m.senderType === "PARTNER"
            ? m.internalNote
              ? "Partner (internal note)"
              : "Partner"
            : "System";
      return `${who}: ${m.content.slice(0, 2000)}`;
    })
    .join("\n");
}

/**
 * Returns the latest inbound (customer) message, or null when the
 * thread has none. Pure — drives the fallback + gives the LLM a clear
 * "reply to this" anchor.
 */
export function latestCustomerMessage(
  messages: ReadonlyArray<TicketMessageLike>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderType === "CUSTOMER") return messages[i].content;
  }
  return null;
}

/**
 * Deterministic safe reply. Pure. Used when the LLM is unavailable or
 * returns nothing usable — never blocks the partner.
 */
export function fallbackTicketReply(args: {
  subject: string;
  customerName?: string | null;
}): string {
  const hi = args.customerName ? `Hi ${args.customerName},` : "Hi,";
  return (
    `${hi}\n\n` +
    `Thanks for reaching out about "${args.subject}". We've received your ` +
    `message and a member of our team is looking into it now. We'll follow ` +
    `up here shortly with an update.\n\n` +
    `If anything else comes up in the meantime, just reply to this ticket.`
  );
}

/**
 * Loads the ticket (scope-guarded by getPartnerTicket), builds the
 * transcript, and asks the LLM for a customer-facing draft. Falls back
 * to the deterministic reply on any failure.
 */
export async function suggestTicketReply(args: {
  partnerTenantId: string;
  ticketId: string;
}): Promise<TicketReplySuggestion> {
  const ticket = await getPartnerTicket(args.partnerTenantId, args.ticketId);
  if (!ticket) {
    // getPartnerTicket throws on scope violation; a null here means the
    // id doesn't exist. Surface a fallback so the route still returns
    // something coherent.
    return {
      draft: fallbackTicketReply({ subject: "your request" }),
      source: "fallback",
    };
  }

  const messages = ticket.messages as TicketMessageLike[];
  const customerName = ticket.tenant?.name ?? null;
  const fallback = fallbackTicketReply({
    subject: ticket.subject,
    customerName,
  });

  // Nothing from the customer yet → fallback acknowledgement is the
  // right answer; no point spending an LLM call.
  if (!latestCustomerMessage(messages)) {
    return { draft: fallback, source: "fallback" };
  }

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{ reply?: string }>({
      // Bill the AI usage to the customer's tenant (the ticket subject),
      // consistent with how other per-conversation AI is metered.
      tenantId: ticket.tenantId,
      feature: "support_ticket_resolver",
      system:
        "You are a support agent drafting a reply to a customer support " +
        "ticket. Write a warm, concise, professional reply that directly " +
        "addresses the customer's latest message. Use any 'internal note' " +
        "lines as private context ONLY — never quote them or reveal that " +
        "internal notes exist. Do not invent facts, ticket numbers, refund " +
        "amounts, or timelines you weren't given. If you lack the " +
        "information to resolve it, acknowledge + say the team is looking " +
        'into it. Return JSON: {"reply":"..."}',
      prompt: JSON.stringify({
        subject: ticket.subject,
        priority: ticket.priority,
        status: ticket.status,
        transcript: buildTicketTranscript(messages),
      }),
      maxTokens: 600,
      temperature: 0.4,
    });
    const reply = (llm.reply ?? "").trim();
    if (!reply) return { draft: fallback, source: "fallback" };
    return { draft: reply.slice(0, 4000), source: "ai" };
  } catch (err) {
    console.warn(
      "[support-resolver] LLM draft failed:",
      (err as Error).message,
    );
    return { draft: fallback, source: "fallback" };
  }
}
