/**
 * Flow runtime types.
 *
 * A Flow is a JSON document with `nodes` and `edges`. Each node has a `type`
 * matching a key in the NodeRegistry. The engine starts from a START node
 * (or the first node marked `isEntry`) and walks edges by following each
 * node's returned `nextNodeId`.
 *
 * V2 §29: every node must be reusable, configurable, versioned, independently
 * deployable. The registry pattern enforces this — adding a new node type is
 * a single file.
 */

export interface FlowNode {
  id: string;
  type: string;        // matches a NodeHandler key
  isEntry?: boolean;
  config: Record<string, unknown>;
  next?: string;       // default next node id (for linear nodes)
  branches?: Record<string, string>; // for CONDITION nodes: label → nodeId
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges?: FlowEdge[];
}

export interface FlowExecutionContext {
  tenantId: string;
  flowId: string;
  runId: string;
  contactId: string | null;
  conversationId: string | null;
  vars: Record<string, unknown>;
  /** The most recent inbound message text (if triggered by message). */
  triggerText?: string;
}

export interface NodeRunResult {
  /** Next node id to execute. null = end. */
  nextNodeId: string | null;
  /** Variables to merge into the run context. */
  vars?: Record<string, unknown>;
  /** If set, the engine should suspend (e.g. delay). */
  waitUntil?: Date;
  /** Status override (e.g. to mark a run COMPLETED early). */
  status?: "COMPLETED" | "FAILED" | "ABORTED";
  /** Free-form metadata for the trail. */
  trail?: Record<string, unknown>;
}

export interface NodeHandler {
  /** Unique node type id. Must match `node.type`. */
  type: string;
  /** Human label for the admin UI. */
  label: string;
  /** Execute the node and return where to go next. */
  run(node: FlowNode, ctx: FlowExecutionContext): Promise<NodeRunResult>;
}

export class FlowRuntimeError extends Error {
  constructor(message: string, public nodeId?: string) {
    super(message);
  }
}
