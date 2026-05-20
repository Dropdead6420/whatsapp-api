"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { AgentShell } from "../../../src/components/AgentShell";
import { api, ApiClientError } from "../../../src/lib/api";

type LeadStatus =
  | "NEW"
  | "QUALIFIED"
  | "NEGOTIATION"
  | "PROPOSAL_SENT"
  | "NEGOTIATION_FAILED"
  | "CLOSED_WON"
  | "CLOSED_LOST";

interface Lead {
  id: string;
  title: string;
  status: LeadStatus;
  value: number | null;
  contact: { name: string; phoneNumber: string };
}

const STATUSES: LeadStatus[] = [
  "NEW",
  "QUALIFIED",
  "NEGOTIATION",
  "PROPOSAL_SENT",
  "CLOSED_WON",
  "CLOSED_LOST",
];

export default function AgentLeadsPage() {
  const { user, loading, signOut } = useAuth({ required: true, roles: ["AGENT"] });
  const [board, setBoard] = useState<Partial<Record<LeadStatus, Lead[]>>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<Record<LeadStatus, Lead[]>>("/api/v1/leads")
      .then(setBoard)
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : "Load failed"));
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <AgentShell user={user} signOut={signOut}>
      <h1 className="mb-2 text-xl font-semibold">My leads</h1>
      <p className="mb-6 text-sm text-slate-500">Leads assigned to you.</p>
      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {STATUSES.map((status) => (
          <div key={status} className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">{status}</h2>
            <ul className="space-y-2">
              {(board[status] ?? []).map((lead) => (
                <li key={lead.id} className="rounded border border-slate-100 p-2 text-sm">
                  <div className="font-medium">{lead.title}</div>
                  <div className="text-slate-500">{lead.contact.name}</div>
                </li>
              ))}
              {(board[status] ?? []).length === 0 && (
                <li className="text-xs text-slate-400">None</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </AgentShell>
  );
}
