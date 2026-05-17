"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

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
  probability: number | null;
  followUpStatus: "RECOMMENDED" | "SCHEDULED" | "SENT" | "DISMISSED" | "FAILED" | null;
  followUpPriority: string | null;
  followUpMessage: string | null;
  followUpReason: string | null;
  followUpDueAt: string | null;
  followUpRecommendedAt: string | null;
  followUpSentAt: string | null;
  followUpLastError: string | null;
  contact: { name: string; phoneNumber: string; optedOut?: boolean };
  assignee: { id: string; name: string } | null;
}

const COLUMNS: { status: LeadStatus; label: string }[] = [
  { status: "NEW", label: "New" },
  { status: "QUALIFIED", label: "Qualified" },
  { status: "NEGOTIATION", label: "Negotiation" },
  { status: "PROPOSAL_SENT", label: "Proposal sent" },
  { status: "NEGOTIATION_FAILED", label: "Needs rescue" },
  { status: "CLOSED_WON", label: "Closed-won" },
  { status: "CLOSED_LOST", label: "Closed-lost" },
];

export default function LeadsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [board, setBoard] = useState<Record<LeadStatus, Lead[]>>({
    NEW: [],
    QUALIFIED: [],
    NEGOTIATION: [],
    PROPOSAL_SENT: [],
    NEGOTIATION_FAILED: [],
    CLOSED_WON: [],
    CLOSED_LOST: [],
  });
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);

  async function loadBoard() {
    if (!user) return;
    try {
      const data = await api.get<Record<LeadStatus, Lead[]>>("/api/v1/leads");
      setBoard(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void loadBoard();
  }, [user]);

  async function recommendFollowUp(leadId: string) {
    setBusyLeadId(leadId);
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/leads/${leadId}/follow-up/recommend`, {
        goal: "Move this lead to the next best sales step.",
      });
      setNotice("Follow-up recommendation generated.");
      await loadBoard();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to recommend follow-up");
    } finally {
      setBusyLeadId(null);
    }
  }

  async function updateFollowUp(
    lead: Lead,
    body: {
      followUpStatus?: Lead["followUpStatus"];
      followUpDueAt?: string | null;
      followUpMessage?: string | null;
    },
  ) {
    setBusyLeadId(lead.id);
    setErr(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/leads/${lead.id}/follow-up`, body);
      setNotice("Follow-up updated.");
      await loadBoard();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to update follow-up");
    } finally {
      setBusyLeadId(null);
    }
  }

  async function scheduleFollowUp(lead: Lead) {
    const current = lead.followUpDueAt
      ? new Date(lead.followUpDueAt).toISOString().slice(0, 16)
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    const input = window.prompt("Schedule follow-up at local date/time", current);
    if (!input) return;
    const dueAt = new Date(input).toISOString();
    await updateFollowUp(lead, {
      followUpStatus: "SCHEDULED",
      followUpDueAt: dueAt,
      followUpMessage: lead.followUpMessage,
    });
  }

  async function sendFollowUpNow(lead: Lead) {
    if (
      !window.confirm(
        "Send this WhatsApp follow-up now? Only send if the contact has opted in.",
      )
    ) {
      return;
    }
    setBusyLeadId(lead.id);
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/leads/${lead.id}/follow-up/send`);
      setNotice("Follow-up sent.");
      await loadBoard();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to send follow-up");
    } finally {
      setBusyLeadId(null);
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Lead pipeline</h1>
        <p className="text-sm text-slate-500">
          Track deals from first contact to close, with AI next-step follow-ups.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {COLUMNS.map((col) => (
          <div key={col.status} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">{col.label}</span>
              <span className="rounded-full bg-slate-100 px-2 text-xs">
                {board[col.status]?.length ?? 0}
              </span>
            </div>
            <div className="space-y-2">
              {(board[col.status] ?? []).map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  busy={busyLeadId === l.id}
                  followUpsEnabled={features?.followUpRecommendations !== false}
                  onRecommend={() => void recommendFollowUp(l.id)}
                  onSchedule={() => void scheduleFollowUp(l)}
                  onDismiss={() =>
                    void updateFollowUp(l, {
                      followUpStatus: "DISMISSED",
                    })
                  }
                  onSendNow={() => void sendFollowUpNow(l)}
                />
              ))}
              {(board[col.status] ?? []).length === 0 && (
                <div className="rounded-md border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Empty
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

function LeadCard({
  lead,
  busy,
  followUpsEnabled,
  onRecommend,
  onSchedule,
  onDismiss,
  onSendNow,
}: {
  lead: Lead;
  busy: boolean;
  followUpsEnabled: boolean;
  onRecommend: () => void;
  onSchedule: () => void;
  onDismiss: () => void;
  onSendNow: () => void;
}) {
  const hasRecommendation =
    lead.followUpStatus &&
    lead.followUpStatus !== "DISMISSED" &&
    Boolean(lead.followUpMessage);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <div className="font-medium text-slate-900">{lead.title}</div>
      <div className="mt-1 text-slate-600">{lead.contact.name}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-slate-700">
        {lead.value !== null && (
          <span className="rounded-full bg-white px-2 py-0.5">
            ₹{lead.value.toLocaleString()}
          </span>
        )}
        {typeof lead.probability === "number" && (
          <span className="rounded-full bg-white px-2 py-0.5">
            {Math.round(lead.probability * 100)}% close
          </span>
        )}
        {lead.contact.optedOut && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
            opted out
          </span>
        )}
      </div>

      {hasRecommendation && (
        <div className="mt-2 rounded-md border border-emerald-100 bg-white p-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityClass(
                lead.followUpPriority,
              )}`}
            >
              {lead.followUpPriority ?? "medium"} priority
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-400">
              {lead.followUpStatus}
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-slate-700">{lead.followUpMessage}</p>
          {lead.followUpDueAt && (
            <p className="mt-2 text-[11px] text-slate-500">
              Due {new Date(lead.followUpDueAt).toLocaleString()}
            </p>
          )}
          {lead.followUpReason && (
            <p className="mt-1 line-clamp-2 text-[11px] italic text-slate-500">
              {lead.followUpReason}
            </p>
          )}
          {lead.followUpLastError && (
            <p className="mt-1 text-[11px] text-red-600">{lead.followUpLastError}</p>
          )}
        </div>
      )}

      {followUpsEnabled && (
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            onClick={onRecommend}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasRecommendation ? "Regenerate" : "AI follow-up"}
          </button>
          {hasRecommendation && lead.followUpStatus !== "SENT" && (
            <>
              <button
                onClick={onSchedule}
                disabled={busy}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Schedule
              </button>
              <button
                onClick={onSendNow}
                disabled={busy || lead.contact.optedOut}
                className="rounded-md border border-slate-900 bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send now
              </button>
              <button
                onClick={onDismiss}
                disabled={busy}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
      {lead.followUpStatus === "SENT" && lead.followUpSentAt && (
        <div className="mt-2 text-[11px] text-emerald-700">
          Sent {new Date(lead.followUpSentAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function priorityClass(priority: string | null) {
  switch (priority) {
    case "high":
      return "bg-red-50 text-red-700";
    case "low":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-amber-50 text-amber-700";
  }
}
