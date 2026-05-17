"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * Visual editor for NexaFlow Flows.
 *
 * The flow data model in the backend is `{nodes: NexaNode[], edges: NexaEdge[]}`.
 * Each NexaNode has {id, type, config, next?, branches?}. React Flow stores
 * its own visual graph separately; this component keeps the two in sync.
 *
 * Two things matter:
 * 1. nodes/edges round-trip cleanly through JSON
 * 2. node `position` is stored in `config._editor.position` so we don't lose
 *    layout between saves (the backend ignores _editor.*)
 */

export interface NexaNode {
  id: string;
  type: string;
  isEntry?: boolean;
  config: Record<string, unknown>;
  next?: string;
  branches?: Record<string, string>;
}

export interface NexaEdge {
  from: string;
  to: string;
  label?: string;
}

interface NodeTypeMeta {
  type: string;
  label: string;
}

interface FlowEditorProps {
  initialNodes: NexaNode[];
  initialEdges: NexaEdge[];
  nodeTypes: NodeTypeMeta[];
  onSave: (nodes: NexaNode[], edges: NexaEdge[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Custom React Flow node renderer
// ---------------------------------------------------------------------------

const NODE_PILL_STYLES: Record<string, string> = {
  START: "bg-emerald-600 text-white",
  END: "bg-slate-600 text-white",
  MESSAGE: "bg-blue-600 text-white",
  CONDITION: "bg-amber-600 text-white",
  DELAY: "bg-purple-600 text-white",
  ADD_TAG: "bg-pink-600 text-white",
  AGENT_TRANSFER: "bg-cyan-600 text-white",
  AI_RESPONSE: "bg-violet-600 text-white",
  WEBHOOK: "bg-orange-600 text-white",
};

function NexaNodeCard({
  data,
  selected,
}: {
  data: { label: string; type: string; isEntry?: boolean; subtitle?: string };
  selected: boolean;
}) {
  return (
    <div
      className={`min-w-[180px] rounded-lg border-2 bg-white shadow-sm transition-all ${
        selected ? "border-emerald-500 shadow-md" : "border-slate-200"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !bg-slate-400"
      />
      <div className="border-b border-slate-100 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              NODE_PILL_STYLES[data.type] ?? "bg-slate-600 text-white"
            }`}
          >
            {data.type}
          </span>
          {data.isEntry && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              entry
            </span>
          )}
        </div>
      </div>
      <div className="px-3 py-2 text-xs">
        <div className="font-medium text-slate-900">{data.label}</div>
        {data.subtitle && (
          <div className="mt-1 line-clamp-2 text-slate-500">{data.subtitle}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !bg-slate-400"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { nexa: NexaNodeCard };

// ---------------------------------------------------------------------------
// Conversion helpers between NexaNode/Edge and React Flow shapes
// ---------------------------------------------------------------------------

interface EditorPosition {
  x: number;
  y: number;
}

function getNodePosition(node: NexaNode, fallback: EditorPosition): EditorPosition {
  const editor = (node.config?._editor as { position?: EditorPosition } | undefined);
  if (editor?.position && typeof editor.position.x === "number") {
    return editor.position;
  }
  return fallback;
}

function makeSubtitle(node: NexaNode): string | undefined {
  const c = node.config ?? {};
  if (node.type === "MESSAGE" && typeof c.text === "string") {
    return c.text.length > 60 ? `${c.text.slice(0, 60)}…` : c.text;
  }
  if (node.type === "ADD_TAG" && typeof c.tag === "string") {
    return `tag: ${c.tag}`;
  }
  if (node.type === "DELAY" && typeof c.seconds === "number") {
    return `${c.seconds}s`;
  }
  if (node.type === "WEBHOOK" && typeof c.url === "string") {
    return c.url.length > 50 ? `${c.url.slice(0, 50)}…` : c.url;
  }
  if (node.type === "CONDITION") {
    const rules = c.rules as unknown[] | undefined;
    return `${rules?.length ?? 0} rule(s)`;
  }
  return undefined;
}

function toRFNodes(nexaNodes: NexaNode[]): RFNode[] {
  return nexaNodes.map((n, idx) => ({
    id: n.id,
    type: "nexa",
    position: getNodePosition(n, { x: 80 + (idx % 4) * 240, y: 80 + Math.floor(idx / 4) * 160 }),
    data: {
      label: n.id,
      type: n.type,
      isEntry: n.isEntry,
      subtitle: makeSubtitle(n),
    },
  }));
}

function toRFEdges(nexaEdges: NexaEdge[], nexaNodes: NexaNode[]): RFEdge[] {
  const explicit = nexaEdges.map((e, idx) => ({
    id: `e_${idx}_${e.from}_${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  // Also synthesize edges from each node's `next` so flows without explicit
  // edges show their wiring.
  const implicit: RFEdge[] = [];
  for (const n of nexaNodes) {
    if (n.next) {
      implicit.push({
        id: `next_${n.id}_${n.next}`,
        source: n.id,
        target: n.next,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  }
  // Dedupe by source-target
  const seen = new Set<string>();
  return [...explicit, ...implicit].filter((e) => {
    const k = `${e.source}->${e.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fromRFNodes(rfNodes: RFNode[], original: NexaNode[]): NexaNode[] {
  const byId = new Map(original.map((n) => [n.id, n]));
  return rfNodes.map((rn) => {
    const existing = byId.get(rn.id);
    const baseConfig = (existing?.config ?? {}) as Record<string, unknown>;
    const cleanConfig = { ...baseConfig };
    cleanConfig._editor = { position: rn.position };
    return {
      id: rn.id,
      type: existing?.type ?? (rn.data as { type?: string }).type ?? "MESSAGE",
      isEntry: existing?.isEntry,
      config: cleanConfig,
      next: existing?.next,
      branches: existing?.branches,
    };
  });
}

function fromRFEdges(rfEdges: RFEdge[]): NexaEdge[] {
  return rfEdges.map((e) => ({
    from: e.source,
    to: e.target,
    label: typeof e.label === "string" ? e.label : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function FlowEditor({
  initialNodes,
  initialEdges,
  nodeTypes: availableNodeTypes,
  onSave,
}: FlowEditorProps) {
  const [nexaNodes, setNexaNodes] = useState<NexaNode[]>(initialNodes);
  const [nexaEdges, setNexaEdges] = useState<NexaEdge[]>(initialEdges);
  const [rfNodes, setRfNodes] = useState<RFNode[]>(() => toRFNodes(initialNodes));
  const [rfEdges, setRfEdges] = useState<RFEdge[]>(() =>
    toRFEdges(initialEdges, initialNodes),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState("{}");
  const [configValid, setConfigValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const nodeCounter = useRef(initialNodes.length);

  const selectedNode = useMemo(
    () => nexaNodes.find((n) => n.id === selectedId) ?? null,
    [nexaNodes, selectedId],
  );

  // Keep configDraft in sync when selecting a different node.
  useEffect(() => {
    if (!selectedNode) {
      setConfigDraft("{}");
      setConfigValid(true);
      return;
    }
    const { _editor, ...cleanConfig } = selectedNode.config as Record<
      string,
      unknown
    >;
    setConfigDraft(JSON.stringify(cleanConfig, null, 2));
    setConfigValid(true);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      // Sync positions back into NexaNodes
      setNexaNodes((prev) => fromRFNodes(next, prev));
      const positional = changes.some((c) => c.type === "position" && c.dragging === false);
      if (positional) setDirty(true);
      return next;
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((eds) => {
      const next = applyEdgeChanges(changes, eds);
      setNexaEdges(fromRFEdges(next));
      if (changes.some((c) => c.type === "remove")) setDirty(true);
      return next;
    });
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    setRfEdges((eds) => {
      const next = addEdge(
        { ...conn, markerEnd: { type: MarkerType.ArrowClosed } },
        eds,
      );
      setNexaEdges(fromRFEdges(next));
      return next;
    });
    // Also link this in NexaNode.next if it doesn't already have one
    setNexaNodes((prev) => {
      const updated = prev.map((n) => {
        if (n.id !== conn.source) return n;
        if (n.next || n.branches) return n; // don't overwrite explicit routing
        return { ...n, next: conn.target ?? undefined };
      });
      return updated;
    });
    setDirty(true);
  }, []);

  const addNodeOfType = useCallback(
    (type: string) => {
      nodeCounter.current += 1;
      const newId = `n_${nodeCounter.current}_${Date.now().toString(36)}`;
      const defaultConfig: Record<string, unknown> =
        type === "MESSAGE"
          ? { text: "Hello!" }
          : type === "ADD_TAG"
            ? { tag: "" }
            : type === "DELAY"
              ? { seconds: 60 }
              : type === "CONDITION"
                ? { rules: [], default: "" }
                : type === "WEBHOOK"
                  ? { url: "https://", method: "POST" }
                  : type === "AI_RESPONSE"
                    ? { autoSend: false }
                    : {};
      const position = { x: 200, y: 200 + nodeCounter.current * 30 };
      const newNode: NexaNode = {
        id: newId,
        type,
        config: { ...defaultConfig, _editor: { position } },
        isEntry: type === "START" && !nexaNodes.some((n) => n.isEntry || n.type === "START"),
      };
      setNexaNodes((p) => [...p, newNode]);
      setRfNodes((p) => [
        ...p,
        {
          id: newId,
          type: "nexa",
          position,
          data: {
            label: newId,
            type,
            isEntry: newNode.isEntry,
            subtitle: makeSubtitle(newNode),
          },
        },
      ]);
      setSelectedId(newId);
      setDirty(true);
    },
    [nexaNodes],
  );

  const onNodeClick = useCallback((_: unknown, node: RFNode) => {
    setSelectedId(node.id);
  }, []);

  function applyConfig() {
    if (!selectedNode) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(configDraft) as Record<string, unknown>;
    } catch {
      setConfigValid(false);
      return;
    }
    setConfigValid(true);
    setNexaNodes((prev) =>
      prev.map((n) => {
        if (n.id !== selectedNode.id) return n;
        const editor = (n.config as Record<string, unknown>)._editor;
        const newConfig = { ...parsed, _editor: editor };
        return { ...n, config: newConfig };
      }),
    );
    setRfNodes((prev) =>
      prev.map((rn) =>
        rn.id === selectedNode.id
          ? {
              ...rn,
              data: {
                ...(rn.data as object),
                subtitle: makeSubtitle({ ...selectedNode, config: parsed }),
              },
            }
          : rn,
      ),
    );
    setDirty(true);
  }

  function deleteSelectedNode() {
    if (!selectedNode) return;
    if (!confirm(`Delete node "${selectedNode.id}"?`)) return;
    setNexaNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
    setRfNodes((prev) => prev.filter((rn) => rn.id !== selectedNode.id));
    setRfEdges((prev) =>
      prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
    );
    setNexaEdges((prev) =>
      prev.filter((e) => e.from !== selectedNode.id && e.to !== selectedNode.id),
    );
    setSelectedId(null);
    setDirty(true);
  }

  function toggleEntry() {
    if (!selectedNode) return;
    setNexaNodes((prev) =>
      prev.map((n) =>
        n.id === selectedNode.id
          ? { ...n, isEntry: !n.isEntry }
          : selectedNode.isEntry
            ? n
            : { ...n, isEntry: false }, // only one entry node at a time
      ),
    );
    setRfNodes((prev) =>
      prev.map((rn) =>
        rn.id === selectedNode.id
          ? { ...rn, data: { ...(rn.data as object), isEntry: !selectedNode.isEntry } }
          : selectedNode.isEntry
            ? rn
            : {
                ...rn,
                data: { ...(rn.data as object), isEntry: false },
              },
      ),
    );
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nexaNodes, nexaEdges);
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-180px)] gap-3">
      {/* Left palette */}
      <div className="w-44 shrink-0 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Add node
          </div>
          <div className="space-y-1">
            {availableNodeTypes.map((nt) => (
              <button
                key={nt.type}
                onClick={() => addNodeOfType(nt.type)}
                className={`block w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50`}
              >
                <span
                  className={`mr-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-medium ${
                    NODE_PILL_STYLES[nt.type] ?? "bg-slate-600 text-white"
                  }`}
                >
                  {nt.type}
                </span>
                <span className="text-slate-700">{nt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600">
          Drag nodes to position. Drag from the bottom dot of one node onto the
          top dot of another to connect them.
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {dirty && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
              unsaved
            </span>
          )}
          {saveError && (
            <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
              {saveError}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save flow"}
          </button>
        </div>
      </div>

      {/* Right config panel */}
      <div className="w-72 shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
        {selectedNode ? (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Selected node
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    NODE_PILL_STYLES[selectedNode.type] ?? "bg-slate-600 text-white"
                  }`}
                >
                  {selectedNode.type}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {selectedNode.id}
                </span>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!selectedNode.isEntry}
                  onChange={toggleEntry}
                />
                Entry node (flow starts here)
              </label>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Config (JSON)
              </label>
              <textarea
                rows={12}
                value={configDraft}
                onChange={(e) => {
                  setConfigDraft(e.target.value);
                  setConfigValid(true);
                }}
                onBlur={applyConfig}
                spellCheck={false}
                className={`mt-1 block w-full rounded-md border px-2 py-1 font-mono text-[11px] ${
                  configValid ? "border-slate-300" : "border-red-400"
                }`}
              />
              {!configValid && (
                <p className="mt-1 text-[11px] text-red-600">
                  Invalid JSON — fix before blurring out.
                </p>
              )}
              <button
                onClick={applyConfig}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              >
                Apply
              </button>
            </div>

            <ConfigHint type={selectedNode.type} />

            <button
              onClick={deleteSelectedNode}
              className="w-full rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete node
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Click a node to edit its config, or use the palette to add one.
          </p>
        )}
      </div>
    </div>
  );
}

function ConfigHint({ type }: { type: string }) {
  const hint = (() => {
    switch (type) {
      case "MESSAGE":
        return '{ "text": "Hi {{contactName}}, …" }';
      case "ADD_TAG":
        return '{ "tag": "vip" }';
      case "DELAY":
        return '{ "seconds": 60 }';
      case "CONDITION":
        return '{ "rules": [{"path":"triggerText","op":"contains","value":"book","goto":"nodeId"}], "default": "nodeId" }';
      case "WEBHOOK":
        return '{ "url": "https://…", "method": "POST", "headers": {}, "body": {} }';
      case "AI_RESPONSE":
        return '{ "autoSend": false }';
      default:
        return null;
    }
  })();
  if (!hint) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Example
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-slate-700">
        {hint}
      </pre>
    </div>
  );
}
