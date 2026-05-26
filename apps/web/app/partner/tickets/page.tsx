"use client";

// Partner support tickets — REAL backend integration.
//
// Replaces the Gemini localStorage mock with the real SupportTicket
// API (T-053). Each child-tenant raises tickets in their own portal;
// partners triage + reply here. Internal notes (partner-only) are
// supported via the same compose form.

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

type Status = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "RESOLVED" | "CLOSED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type SenderType = "CUSTOMER" | "PARTNER" | "SYSTEM";
type StatusFilter = "ALL" | Status;

interface TicketSummary {
  id: string;
  subject: string;
  status: Status;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  lastRepliedAt: string | null;
  resolvedAt: string | null;
  tenant: { id: string; name: string };
  _count: { messages: number };
}

interface TicketMessage {
  id: string;
  senderType: SenderType;
  senderUserId: string | null;
  content: string;
  internalNote: boolean;
  createdAt: string;
}

interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}

const STATUS_LABEL: Record<Status, string> = {
  NEW: "New",
  OPEN: "Open",
  PENDING_CUSTOMER: "Waiting on customer",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

function statusColor(s: Status): string {
  switch (s) {
    case "NEW":
      return "bg-indigo-100 text-indigo-800";
    case "OPEN":
      return "bg-amber-100 text-amber-800";
    case "PENDING_CUSTOMER":
      return "bg-slate-200 text-slate-700";
    case "RESOLVED":
      return "bg-emerald-100 text-emerald-800";
    case "CLOSED":
      return "bg-slate-100 text-slate-500";
  }
}

function priorityColor(p: Priority): string {
  switch (p) {
    case "URGENT":
      return "bg-red-100 text-red-700";
    case "HIGH":
      return "bg-amber-100 text-amber-700";
    case "MEDIUM":
      return "bg-slate-100 text-slate-600";
    case "LOW":
      return "bg-slate-50 text-slate-500";
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PartnerTicketsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [listErr, setListErr] = useState<string | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  async function refreshList() {
    setBusy(true);
    setListErr(null);
    try {
      const data = await api.get<TicketSummary[]>("/api/v1/partner/tickets");
      setTickets(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      } else if (selectedId && !data.find((t) => t.id === selectedId)) {
        setSelectedId(data[0]?.id ?? null);
      }
    } catch (e) {
      setListErr(
        e instanceof ApiClientError
          ? `Failed to load tickets: ${e.message}`
          : "Failed to load tickets.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(id: string) {
    setDetailErr(null);
    try {
      const data = await api.get<TicketDetail>(`/api/v1/partner/tickets/${id}`);
      setDetail(data);
    } catch (e) {
      setDetailErr(
        e instanceof ApiClientError
          ? `Failed to load ticket: ${e.message}`
          : "Failed to load ticket.",
      );
    }
  }

  useEffect(() => {
    if (user) void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId]);

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    setDetailErr(null);
    try {
      await api.post(`/api/v1/partner/tickets/${selectedId}/replies`, {
        content: reply,
        internalNote: internal,
      });
      setReply("");
      setInternal(false);
      await Promise.all([loadDetail(selectedId), refreshList()]);
    } catch (e) {
      setDetailErr(
        e instanceof ApiClientError
          ? `Failed to send reply: ${e.message}`
          : "Failed to send reply.",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleStatus(s: Status) {
    if (!selectedId) return;
    setDetailErr(null);
    try {
      await api.patch(`/api/v1/partner/tickets/${selectedId}`, { status: s });
      await Promise.all([loadDetail(selectedId), refreshList()]);
    } catch (e) {
      setDetailErr(
        e instanceof ApiClientError
          ? `Failed to update status: ${e.message}`
          : "Failed to update status.",
      );
    }
  }

  async function handlePriority(p: Priority) {
    if (!selectedId) return;
    setDetailErr(null);
    try {
      await api.patch(`/api/v1/partner/tickets/${selectedId}`, { priority: p });
      await Promise.all([loadDetail(selectedId), refreshList()]);
    } catch (e) {
      setDetailErr(
        e instanceof ApiClientError
          ? `Failed to update priority: ${e.message}`
          : "Failed to update priority.",
      );
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const filtered =
    filter === "ALL" ? tickets : tickets.filter((t) => t.status === filter);

  const stats = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "NEW" || t.status === "OPEN").length,
    waiting: tickets.filter((t) => t.status === "PENDING_CUSTOMER").length,
    resolved: tickets.filter((t) => t.status === "RESOLVED").length,
  };

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Support tickets
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Customer tenants raise tickets from their own dashboards. Use
            internal notes to coordinate with your team without the customer
            seeing them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshList()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {listErr && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listErr}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats.total} accent="slate" />
        <StatCard
          label="New / open"
          value={stats.open}
          accent={stats.open > 0 ? "amber" : "slate"}
        />
        <StatCard label="Waiting" value={stats.waiting} accent="slate" />
        <StatCard label="Resolved" value={stats.resolved} accent="emerald" />
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(["ALL", "NEW", "OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 font-medium ${
                filter === s
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {s === "ALL" ? "All" : STATUS_LABEL[s]}
            </button>
          ),
        )}
      </div>

      {/* Master / detail layout */}
      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[34rem] overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 && !busy && (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                {tickets.length === 0
                  ? "No tickets yet."
                  : "No tickets match this filter."}
              </div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`w-full px-3 py-3 text-left text-sm transition ${
                  selectedId === t.id
                    ? "bg-emerald-50"
                    : "hover:bg-slate-50"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityColor(t.priority)}`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor(t.status)}`}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
                <h3 className="truncate font-medium text-slate-900">
                  {t.subject}
                </h3>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="truncate">{t.tenant.name}</span>
                  <span>{formatDateTime(t.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="rounded-lg border border-slate-200 bg-white shadow-sm">
          {!detail && (
            <div className="p-10 text-center text-sm text-slate-500">
              Select a ticket to view the conversation.
            </div>
          )}
          {detail && (
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900">
                      {detail.subject}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {detail.tenant.name} · Opened{" "}
                      {formatDateTime(detail.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <select
                      value={detail.status}
                      onChange={(e) => void handleStatus(e.target.value as Status)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {(
                        [
                          "NEW",
                          "OPEN",
                          "PENDING_CUSTOMER",
                          "RESOLVED",
                          "CLOSED",
                        ] as const
                      ).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={detail.priority}
                      onChange={(e) =>
                        void handlePriority(e.target.value as Priority)
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map(
                        (p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>
              </div>

              {detailErr && (
                <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {detailErr}
                </div>
              )}

              {/* Timeline */}
              <div className="max-h-[28rem] flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {detail.messages.map((m) => {
                  const isPartner = m.senderType === "PARTNER";
                  const isSystem = m.senderType === "SYSTEM";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isPartner ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
                          m.internalNote
                            ? "border-amber-300 bg-amber-50 text-amber-900"
                            : isPartner
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : isSystem
                                ? "border-slate-200 bg-slate-50 text-slate-700"
                                : "border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide">
                          <span>
                            {m.senderType}
                            {m.internalNote && (
                              <span className="ml-1 rounded bg-amber-200 px-1 text-amber-900">
                                internal
                              </span>
                            )}
                          </span>
                          <span className="font-normal text-slate-500">
                            {formatDateTime(m.createdAt)}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {m.content}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Compose */}
              <form
                onSubmit={handleSendReply}
                className="border-t border-slate-200 px-4 py-3"
              >
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    internal
                      ? "Internal note — visible only to your team"
                      : "Reply to customer…"
                  }
                  className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                    internal
                      ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-amber-500"
                      : "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
                  }`}
                />
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Internal note (team-only)
                  </label>
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {sending
                      ? "Sending…"
                      : internal
                        ? "Add note"
                        : "Send reply"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </section>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald" | "amber";
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
  } as const;
  const numColor = {
    slate: "text-slate-900",
    emerald: "text-emerald-800",
    amber: "text-amber-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${accents[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${numColor[accent]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
