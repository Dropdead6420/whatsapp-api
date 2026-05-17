import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { nodeRegistry } from "./nodes";
import {
  FlowDefinition,
  FlowExecutionContext,
  FlowNode,
  FlowRuntimeError,
} from "./types";

const MAX_NODES_PER_RUN = 50; // guard against runaway loops

function parseDefinition(flow: {
  nodes: string;
  edges: string | null;
}): FlowDefinition {
  try {
    const nodes = JSON.parse(flow.nodes) as FlowNode[];
    const edges = flow.edges ? JSON.parse(flow.edges) : [];
    return { nodes, edges };
  } catch {
    throw new FlowRuntimeError("Flow JSON is malformed");
  }
}

function findEntryNode(def: FlowDefinition): FlowNode {
  const entry =
    def.nodes.find((n) => n.isEntry) ??
    def.nodes.find((n) => n.type === "START") ??
    def.nodes[0];
  if (!entry) throw new FlowRuntimeError("Flow has no entry node");
  return entry;
}

interface TrailEntry {
  nodeId: string;
  type: string;
  at: string;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Drive a single flow run forward. If the run hits a DELAY node, it suspends
 * itself and returns; the flow worker (or a manual resume) will pick it back
 * up when `resumeAt` arrives.
 */
export async function executeFlowRun(runId: string): Promise<void> {
  const run = await prisma.flowRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "ABORTED") {
    return;
  }

  const flow = await prisma.chatbotFlow.findUnique({ where: { id: run.flowId } });
  if (!flow) {
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: "flow not found", completedAt: new Date() },
    });
    return;
  }

  const def = parseDefinition(flow);
  const nodeById = new Map(def.nodes.map((n) => [n.id, n]));

  let currentNodeId =
    run.currentNodeId ?? findEntryNode(def).id;
  let vars = (() => {
    try {
      return JSON.parse(run.context) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const trail: TrailEntry[] = (() => {
    try {
      return JSON.parse(run.trail) as TrailEntry[];
    } catch {
      return [];
    }
  })();

  let steps = 0;
  while (currentNodeId && steps < MAX_NODES_PER_RUN) {
    steps += 1;
    const node = nodeById.get(currentNodeId);
    if (!node) {
      trail.push({
        nodeId: currentNodeId,
        type: "?",
        at: new Date().toISOString(),
        error: "node id not found",
      });
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: `Missing node ${currentNodeId}`,
          trail: JSON.stringify(trail),
          context: JSON.stringify(vars),
          completedAt: new Date(),
        },
      });
      return;
    }

    const handler = nodeRegistry[node.type];
    if (!handler) {
      trail.push({
        nodeId: node.id,
        type: node.type,
        at: new Date().toISOString(),
        error: "no handler registered",
      });
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: `No handler for node type ${node.type}`,
          trail: JSON.stringify(trail),
          context: JSON.stringify(vars),
          completedAt: new Date(),
        },
      });
      return;
    }

    const ctx: FlowExecutionContext = {
      tenantId: run.tenantId,
      flowId: flow.id,
      runId: run.id,
      contactId: run.contactId,
      conversationId: run.conversationId,
      vars,
      triggerText: vars.triggerText as string | undefined,
    };

    try {
      const result = await handler.run(node, ctx);
      if (result.vars) vars = { ...vars, ...result.vars };

      trail.push({
        nodeId: node.id,
        type: node.type,
        at: new Date().toISOString(),
        result: result.trail,
      });

      if (result.waitUntil) {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: {
            status: "WAITING",
            currentNodeId: result.nextNodeId,
            resumeAt: result.waitUntil,
            context: JSON.stringify(vars),
            trail: JSON.stringify(trail),
          },
        });
        return;
      }
      if (result.status === "FAILED" || result.status === "ABORTED") {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: {
            status: result.status,
            context: JSON.stringify(vars),
            trail: JSON.stringify(trail),
            completedAt: new Date(),
          },
        });
        return;
      }
      if (result.status === "COMPLETED" || result.nextNodeId === null) {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            currentNodeId: null,
            context: JSON.stringify(vars),
            trail: JSON.stringify(trail),
            completedAt: new Date(),
          },
        });
        return;
      }
      currentNodeId = result.nextNodeId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      trail.push({
        nodeId: node.id,
        type: node.type,
        at: new Date().toISOString(),
        error: msg,
      });
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: msg,
          context: JSON.stringify(vars),
          trail: JSON.stringify(trail),
          completedAt: new Date(),
        },
      });
      return;
    }
  }

  if (steps >= MAX_NODES_PER_RUN) {
    await prisma.flowRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: `Exceeded ${MAX_NODES_PER_RUN}-node guard (possible loop)`,
        trail: JSON.stringify(trail),
        context: JSON.stringify(vars),
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Start a fresh run for a flow against a contact/conversation. Returns the
 * run id; the engine executes immediately (until DELAY or end).
 */
export async function startFlowRun(args: {
  tenantId: string;
  flowId: string;
  contactId?: string | null;
  conversationId?: string | null;
  initialVars?: Record<string, unknown>;
  triggerText?: string;
}): Promise<string> {
  const flow = await prisma.chatbotFlow.findFirst({
    where: { id: args.flowId, tenantId: args.tenantId },
  });
  if (!flow) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Flow not found.");
  }

  const vars = {
    ...(args.initialVars ?? {}),
    ...(args.triggerText ? { triggerText: args.triggerText } : {}),
  };

  const run = await prisma.flowRun.create({
    data: {
      tenantId: args.tenantId,
      flowId: flow.id,
      contactId: args.contactId ?? null,
      conversationId: args.conversationId ?? null,
      status: "RUNNING",
      context: JSON.stringify(vars),
      trail: "[]",
    },
  });

  // Fire-and-forget; the caller doesn't need to await full execution.
  void executeFlowRun(run.id);
  return run.id;
}

/**
 * Find any flow that matches the inbound text via keyword triggers.
 * Returns the first matching active flow.
 */
export async function findFlowForInbound(
  tenantId: string,
  inboundText: string,
): Promise<string | null> {
  const lower = inboundText.toLowerCase().trim();
  const flows = await prisma.chatbotFlow.findMany({
    where: { tenantId, isActive: true, trigger: "keyword" },
    select: { id: true, triggerKeywords: true },
  });
  for (const flow of flows) {
    for (const kw of flow.triggerKeywords) {
      if (!kw) continue;
      const k = kw.toLowerCase().trim();
      if (!k) continue;
      // Match if inbound starts with keyword or is exactly keyword
      if (lower === k || lower.startsWith(`${k} `) || lower.includes(` ${k} `)) {
        return flow.id;
      }
    }
  }
  return null;
}

let workerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Background worker — resumes WAITING runs whose resumeAt has passed.
 */
export async function startFlowWorker(intervalMs = 30_000): Promise<void> {
  if (workerHandle) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[flow-worker] database unavailable; worker not started.");
    return;
  }

  const tick = async () => {
    try {
      const due = await prisma.flowRun.findMany({
        where: {
          status: "WAITING",
          resumeAt: { lte: new Date() },
        },
        select: { id: true },
        take: 25,
      });
      for (const r of due) {
        await prisma.flowRun.update({
          where: { id: r.id },
          data: { status: "RUNNING" },
        });
        await executeFlowRun(r.id);
      }
    } catch (err) {
      console.error("[flow-worker] tick failed", err);
    }
  };
  setTimeout(tick, 10_000);
  workerHandle = setInterval(tick, intervalMs);
}

export function stopFlowWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}
