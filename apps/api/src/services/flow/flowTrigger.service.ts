import { prisma } from "@nexaflow/db";
import { findFlowForInbound, startFlowRun } from "./engine";
import { maybeRunDefaultAgentReply } from "../aiAgentInbound.service";

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
}): Promise<number> {
  if (args.trigger === "keyword") {
    return 0;
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
    return started;
  } catch (err) {
    console.error(`[flow-trigger:${args.trigger}]`, err);
    return 0;
  }
}

/**
 * Inbound WhatsApp:
 *   1. Keyword flow match → start run.
 *   2. Otherwise, active `message_received` flow → start run(s).
 *   3. Otherwise, if `Tenant.aiAgentAutoReply` and a default AI agent
 *      is configured → run the agent and send its reply.
 *
 * Step 3 is the T-052 slice 4 fallback. It only fires when steps 1+2
 * matched nothing, so an operator who's set up an explicit flow keeps
 * the predictable scripted path; the AI is the "if nothing else, just
 * answer" net.
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

    const eventRuns = await dispatchFlowTriggers({
      tenantId: args.tenantId,
      trigger: "message_received",
      contactId: args.contactId,
      conversationId: args.conversationId,
      triggerText: args.text,
    });
    if (eventRuns > 0) return;

    // Nothing matched — try the default-agent auto-reply.
    const ai = await maybeRunDefaultAgentReply({
      tenantId: args.tenantId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      text: args.text,
    });
    if (!ai.fired) {
      // Log the skip reason at debug level; this is the most common
      // codepath for tenants who haven't opted into auto-reply, so we
      // don't want to spam at info.
      if (process.env.AI_AGENT_LOG_SKIPS === "true") {
        console.log(`[ai-agent:inbound] skip=${ai.reason}`);
      }
    }
  } catch (err) {
    console.error("[flow-trigger:inbound]", err);
  }
}

/** Returns tags present in `next` but not in `prev`. */
export function tagsAdded(prev: string[], next: string[]): string[] {
  const before = new Set(prev);
  return next.filter((t) => t && !before.has(t));
}
