"use client";

// Lead pipeline — kanban board.
//
// Drag a card between columns to change LeadStatus. Uses native HTML5
// drag-drop (no react-dnd / dnd-kit) — fewer moving parts, smaller
// bundle, and the UX is fine for ~hundreds of leads per board.
//
// Cards show title + contact name + value + assignee. Click opens
// the existing /leads detail (read-only for now; pipeline-from-detail
// editing is a follow-up).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  description: string | null;
  status: LeadStatus;
  value: number | null;
  probability: number | null;
  assigneeId: string | null;
  contact: { id: string; name: string | null; phoneNumber: string } | null;
  assignee: { id: string; name: string } | null;
  followUpStatus: string | null;
  followUpDueAt: string | null;
  updatedAt: string;
}

interface LeadListResponse {
  leads: Lead[];
  pagination: { page: number; limit: number; total: number };
}

interface Column {
  key: LeadStatus;
  label: string;
  /** Tailwind classes for the column header strip. */
  accent: string;
}

const COLUMNS: Column[] = [
  { key: "NEW", label: "New", accent: "bg-slate-500" },
  { key: "QUALIFIED", label: "Qualified", accent: "bg-blue-500" },
  { key: "NEGOTIATION", label: "Negotiation", accent: "bg-indigo-500" },
  { key: "PROPOSAL_SENT", label: "Proposal sent", accent: "bg-violet-500" },
  { key: "NEGOTIATION_FAILED", label: "Stalled", accent: "bg-amber-500" },
  { key: "CLOSED_WON", label: "Won", accent: "bg-emerald-600" },
  { key: "CLOSED_LOST", label: "Lost", accent: "bg-slate-400" },
];

function formatValue(value: number | null): string {
  if (value === null || value === undefined) return "";
  if (value >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function PipelinesPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [leads, setLeads] = useState<Lead[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<LeadStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Group leads by status. Memoized so dragging doesn't recompute on
  // every mouse-move (status doesn't change on hover, only on drop).
  const byColumn = useMemo(() => {
    const map = new Map<LeadStatus, Lead[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const lead of leads) {
      const bucket = map.get(lead.status);
      if (bucket) bucket.push(lead);
      else map.get("NEW")?.push(lead);
    }
    return map;
  }, [leads]);

  async function refresh() {
    try {
      // Pull a generous slice; the /leads endpoint paginates but for
      // a pipeline view the operator wants everything visible at once.
      const data = await api.get<LeadListResponse>(
        "/api/v1/leads?limit=200",
      );
      setLeads(data.leads);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Pipeline load failed.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function moveLead(leadId: string, newStatus: LeadStatus) {
    const original = leads.find((l) => l.id === leadId);
    if (!original || original.status === newStatus) return;

    setBusy(true);
    setErr(null);
    setNotice(null);

    // Optimistic update — flip status locally first so the card lands
    // in the new column immediately. Revert on error.
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)),
    );

    try {
      await api.patch(`/api/v1/leads/${leadId}`, { status: newStatus });
      setNotice(`Moved "${original.title}" to ${formatStatusLabel(newStatus)}.`);
    } catch (e) {
      // Revert optimistic update.
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: original.status } : l)),
      );
      setErr(e instanceof ApiClientError ? e.message : "Move failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sales pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Drag a card to change a lead&apos;s stage. Cards link to the
            lead detail page. {leads.length} total leads on the board.
          </p>
        </div>
        <Link
          href="/leads"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          List view →
        </Link>
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            err
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      <div className="-mx-2 flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colLeads = byColumn.get(col.key) ?? [];
          const totalValue = colLeads.reduce(
            (sum, l) => sum + (l.value ?? 0),
            0,
          );
          const isHover = hoverColumn === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingId) setHoverColumn(col.key);
              }}
              onDragLeave={() => {
                if (hoverColumn === col.key) setHoverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const leadId = e.dataTransfer.getData("text/lead-id");
                setHoverColumn(null);
                setDraggingId(null);
                if (leadId) void moveLead(leadId, col.key);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-md border bg-slate-50/80 transition-colors ${
                isHover
                  ? "border-emerald-400 bg-emerald-50"
                  : "border-slate-200"
              }`}
            >
              <div
                className={`flex items-center justify-between rounded-t-md px-3 py-2 text-xs font-semibold text-white ${col.accent}`}
              >
                <span>{col.label}</span>
                <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-bold">
                  {colLeads.length}
                </span>
              </div>
              {totalValue > 0 && (
                <div className="border-b border-slate-200 px-3 py-1 text-[10px] text-slate-500">
                  pipeline value: ₹{formatValue(totalValue)}
                </div>
              )}
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                {colLeads.length === 0 && (
                  <div className="rounded border border-dashed border-slate-200 py-6 text-center text-[10px] text-slate-400">
                    Drop a card here
                  </div>
                )}
                {colLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    busy={busy}
                    isDragging={draggingId === lead.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/lead-id", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(lead.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setHoverColumn(null);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}

function LeadCard({
  lead,
  busy,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  busy: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const contactName =
    lead.contact?.name?.trim() || lead.contact?.phoneNumber || "Unknown";
  const followUpDue =
    lead.followUpDueAt && new Date(lead.followUpDueAt) < new Date()
      ? "overdue"
      : lead.followUpDueAt
        ? "scheduled"
        : null;

  return (
    <div
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group cursor-grab rounded-md border bg-white p-2.5 text-xs shadow-sm transition active:cursor-grabbing ${
        isDragging
          ? "border-emerald-500 opacity-50"
          : "border-slate-200 hover:border-slate-300 hover:shadow"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads`}
          className="line-clamp-2 font-medium text-slate-900 hover:text-emerald-700"
          // Don't trigger drag on link click
          onMouseDown={(e) => e.stopPropagation()}
        >
          {lead.title}
        </Link>
        {lead.value !== null && (
          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-800">
            ₹{formatValue(lead.value)}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5">
          {contactName}
        </span>
        {lead.assignee && (
          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-blue-700">
            {lead.assignee.name.split(" ")[0]}
          </span>
        )}
        {followUpDue && (
          <span
            className={`rounded-full px-1.5 py-0.5 ${
              followUpDue === "overdue"
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            follow-up {followUpDue}
          </span>
        )}
      </div>

      <div className="mt-1.5 text-[9px] text-slate-400">
        updated {relativeDate(lead.updatedAt)}
      </div>
    </div>
  );
}

function formatStatusLabel(s: LeadStatus): string {
  const col = COLUMNS.find((c) => c.key === s);
  return col ? col.label : s;
}
