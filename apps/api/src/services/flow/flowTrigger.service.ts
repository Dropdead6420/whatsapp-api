import { prisma } from "@nexaflow/db";
import { findFlowForInbound, startFlowRun } from "./engine";

/** Matches `ChatbotFlow.trigger` string values. */
export type FlowTriggerType =
  | "keyword"
  | "message_received"
  | "lead_created"
  | "tag_added"
  | "appointment_booked";

const MAX_RUNS_PER_EVENT = 5;

export async function dispatchFlowTriggers(args: {
  tenantId: string;
  trigger: FlowTriggerType;
  contactId?: string | null;
  conversationId?: string | null;
  triggerText?: string;
  /** For tag_added: the tag that was newly applied. */
  tag?: string;
  initialVars?: Record<string, unknown>;
}): Promise<void> {
  if (args.trigger === "keyword") {
    return;
  }

  try {
    const flows = await prisma.chatbotFlow.findMany({
      where: {
        tenantId: args.tenantId,
        isActive: true,
        trigger: args.trigger,
      },
      select: { id: true, triggerKeywords: true },
      take: MAX_RUNS_PER_EVENT + 1,
    });

    const matched =
      args.trigger === "tag_added" && args.tag
        ? flows.filter((f) => {
            if (f.triggerKeywords.length === 0) return true;
            return f.triggerKeywords.includes(args.tag!);
          })
        : flows;

    let started = 0;
    for (const flow of matched) {
      if (started >= MAX_RUNS_PER_EVENT) break;
      await startFlowRun({
        tenantId: args.tenantId,
        flowId: flow.id,
        contactId: args.contactId,
        conversationId: args.conversationId,
        triggerText: args.triggerText,
        initialVars: {
          ...(args.initialVars ?? {}),
          ...(args.tag ? { triggerTag: args.tag } : {}),
        },
      });
      started += 1;
    }
  } catch (err) {
    console.error(`[flow-trigger:${args.trigger}]`, err);
  }
}

/**
 * Inbound WhatsApp: keyword flow first, else any active message_received flow.
 */
export async function dispatchInboundMessageFlows(args: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  text: string;
}): Promise<void> {
  try {
    const flowId = await findFlowForInbound(args.tenantId, args.text);
    if (flowId) {
      await startFlowRun({
        tenantId: args.tenantId,
        flowId,
        contactId: args.contactId,
        conversationId: args.conversationId,
        triggerText: args.text,
      });
      return;
    }

    await dispatchFlowTriggers({
      tenantId: args.tenantId,
      trigger: "message_received",
      contactId: args.contactId,
      conversationId: args.conversationId,
      triggerText: args.text,
    });
  } catch (err) {
    console.error("[flow-trigger:inbound]", err);
  }
}

/** Returns tags present in `next` but not in `prev`. */
export function tagsAdded(prev: string[], next: string[]): string[] {
  const before = new Set(prev);
  return next.filter((t) => t && !before.has(t));
}
