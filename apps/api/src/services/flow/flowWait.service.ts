import { prisma } from "@nexaflow/db";
import { executeFlowRun } from "./engine";

const WAIT_NODE_TYPE = "WAIT_FOR_REPLY";

/**
 * Resume flow runs paused on WAIT_FOR_REPLY when the customer sends a message.
 */
export async function resumeWaitingFlowRuns(args: {
  tenantId: string;
  conversationId: string;
  contactId: string;
  inboundText: string;
}): Promise<void> {
  try {
    const waiting = await prisma.flowRun.findMany({
      where: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        status: "WAITING",
        currentNodeId: { not: null },
      },
      select: { id: true, currentNodeId: true, flowId: true, context: true },
      take: 5,
    });

    for (const run of waiting) {
      const flow = await prisma.chatbotFlow.findFirst({
        where: { id: run.flowId, tenantId: args.tenantId },
        select: { nodes: true },
      });
      if (!flow || !run.currentNodeId) continue;

      let nodes: Array<{ id: string; type: string; next?: string }>;
      try {
        nodes = JSON.parse(flow.nodes) as Array<{ id: string; type: string; next?: string }>;
      } catch {
        continue;
      }
      const waitNode = nodes.find((n) => n.id === run.currentNodeId);
      if (waitNode?.type !== WAIT_NODE_TYPE) continue;

      let vars: Record<string, unknown> = {};
      try {
        vars = JSON.parse(run.context) as Record<string, unknown>;
      } catch {
        vars = {};
      }
      vars.triggerText = args.inboundText;
      vars.lastReplyText = args.inboundText;
      vars.waitingForReply = false;

      const claim = await prisma.flowRun.updateMany({
        where: { id: run.id, status: "WAITING" },
        data: {
          status: "RUNNING",
          currentNodeId: waitNode.next ?? null,
          resumeAt: null,
          context: JSON.stringify(vars),
        },
      });
      if (claim.count === 0) continue;
      await executeFlowRun(run.id);
    }
  } catch (err) {
    console.error("[flow-wait:resume]", err);
  }
}
