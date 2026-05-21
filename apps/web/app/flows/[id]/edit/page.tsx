"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../src/hooks/useAuth";
import { DashboardShell } from "../../../../src/components/DashboardShell";
import { api, ApiClientError } from "../../../../src/lib/api";
import { EnhancedFlowEditor } from "../../../../src/components/EnhancedFlowEditor";
import type {
  NexaEdge,
  NexaNode,
} from "../../../../src/components/FlowEditor";

interface FlowDetail {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: string;
  triggerKeywords: string[];
  definition: { nodes: NexaNode[]; edges?: NexaEdge[] } | null;
}

interface NodeTypeMeta {
  type: string;
  label: string;
}

export default function FlowEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [nodeTypes, setNodeTypes] = useState<NodeTypeMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    Promise.all([
      api.get<FlowDetail>(`/api/v1/flows/${id}`),
      api.get<NodeTypeMeta[]>("/api/v1/flows/node-types"),
    ])
      .then(([f, nt]) => {
        setFlow(f);
        setNodeTypes(nt);
      })
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : "Load failed"));
  }, [user, id]);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  if (err) {
    return (
      <DashboardShell user={user} signOut={signOut}>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      </DashboardShell>
    );
  }

  if (!flow) {
    return (
      <DashboardShell user={user} signOut={signOut}>
        <div className="p-10 text-sm text-slate-500">Loading flow…</div>
      </DashboardShell>
    );
  }

  const handleSave = async (nodes: NexaNode[], edges: NexaEdge[]) => {
    await api.patch(`/api/v1/flows/${flow.id}`, {
      definition: { nodes, edges },
    });
  };

  const initialNodes = flow.definition?.nodes ?? [];
  const initialEdges = flow.definition?.edges ?? [];

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/flows" className="text-xs text-slate-500 hover:underline">
            ← Flows
          </Link>
          <h1 className="mt-0.5 text-xl font-semibold">{flow.name}</h1>
          <p className="text-xs text-slate-500">
            Trigger: <b>{flow.trigger}</b>
            {flow.triggerKeywords.length > 0 &&
              ` · keywords: ${flow.triggerKeywords.join(", ")}`}
            {flow.isActive ? " · active" : " · paused"}
          </p>
        </div>
        <button
          onClick={() => router.push(`/flows`)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          Done
        </button>
      </header>

      <EnhancedFlowEditor
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        nodeTypes={nodeTypes}
        onSave={handleSave}
      />
    </DashboardShell>
  );
}
