"use client";

// Follow-up tasks queue (PRD §7, slice 3).
//
// AGENT → only their own queue (the API pins assigneeId server-side
// regardless of what we send). BUSINESS_ADMIN / TEAM_LEAD see the
// whole tenant queue and get an assignee column.
//
// Reuses GET /api/v1/agent-performance for the assignee picker
// (returns active AGENT-role users with name+email) so we don't need
// a dedicated users endpoint for this page.

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { DashboardShell } from "../../src/components/DashboardShell";
import { AgentShell } from "../../src/components/AgentShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type FollowUpStatus = "PENDING" | "DONE" | "CANCELLED";

interface FollowUpTask {
  id: string;
  title: string;
  notes: string | null;
  status: FollowUpStatus;
  dueAt: string;
  assigneeId: string;
  createdById: string | null;
  contactId: string | null;
  conversationId: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentRowLite {
  agentId: string;
  agentName: string;
  agentEmail: string;
}

interface AgentPerformanceSummary {
  totalActiveAgents: number;
  rows: AgentRowLite[];
}

const STATUSES: FollowUpStatus[] = ["PENDING", "DONE", "CANCELLED"];

const STATUS_META: Record<FollowUpStatus, { label: string; tone: string }> = {
  PENDING: { label: "Pending", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  DONE: { label: "Done", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-50 text-slate-600 border-slate-200" },
};

/** Pad to a `<input type="datetime-local">` value (local timezone). */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDueAtLocal(): string {
  // Default new tasks to "tomorrow 9am" — common case for callbacks.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return toLocalInputValue(tomorrow);
}

function describeDue(dueAt: string): { label: string; tone: string } {
  const due = new Date(dueAt);
  const diffMs = due.getTime() - Date.now();
  const absHours = Math.abs(diffMs) / (1000 * 60 * 60);
  if (diffMs < 0) {
    return {
      label: absHours < 24 ? `Overdue ${Math.round(absHours)}h` : `Overdue ${Math.round(absHours / 24)}d`,
      tone: "text-rose-700",
    };
  }
  if (absHours < 24) {
    return { label: `Due in ${Math.round(absHours)}h`, tone: "text-amber-700" };
  }
  return {
    label: `Due in ${Math.round(absHours / 24)}d`,
    tone: "text-slate-600",
  };
}

export default function FollowUpsPage() {
  const pathname = usePathname() ?? "";
  const agentPortal = pathname.startsWith("/agent");
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["AGENT", "TEAM_LEAD", "BUSINESS_ADMIN"],
  });
  const Shell = agentPortal ? AgentShell : DashboardShell;
  const canSeeOtherAgents = user?.role !== "AGENT";

  const [statusFilter, setStatusFilter] = useState<FollowUpStatus>("PENDING");
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [agents, setAgents] = useState<AgentRowLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    dueAtLocal: defaultDueAtLocal(),
    assigneeId: "",
    notes: "",
  });

  const loadTasks = async () => {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ statuses: statusFilter });
      const data = await api.get<FollowUpTask[]>(
        `/api/v1/follow-up-tasks?${params}`,
      );
      setTasks(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to load follow-ups",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void loadTasks();
  }, [user, statusFilter]);

  useEffect(() => {
    if (!user || !canSeeOtherAgents) return;
    // Best-effort enumeration of the agent pool for the assignee picker.
    // 403/404 → fall back silently to "assign to self".
    api
      .get<AgentPerformanceSummary>("/api/v1/agent-performance?sinceDays=30")
      .then((s) => setAgents(s.rows ?? []))
      .catch(() => setAgents([]));
  }, [user, canSeeOtherAgents]);

  const create = async () => {
    if (!draft.title.trim()) {
      setErr("Title is required.");
      return;
    }
    const dueAt = new Date(draft.dueAtLocal);
    if (Number.isNaN(dueAt.getTime())) {
      setErr("Pick a valid due date / time.");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        dueAt: dueAt.toISOString(),
      };
      if (draft.notes.trim()) body.notes = draft.notes.trim();
      if (canSeeOtherAgents && draft.assigneeId) {
        body.assigneeId = draft.assigneeId;
      }
      await api.post("/api/v1/follow-up-tasks", body);
      setShowCreate(false);
      setDraft({
        title: "",
        dueAtLocal: defaultDueAtLocal(),
        assigneeId: "",
        notes: "",
      });
      await loadTasks();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const transition = async (
    taskId: string,
    kind: "complete" | "cancel",
  ) => {
    setErr(null);
    try {
      await api.post(`/api/v1/follow-up-tasks/${taskId}/${kind}`);
      await loadTasks();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : `Failed to ${kind} task`,
      );
    }
  };

  const assigneeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.agentId, a.agentName);
    return (id: string) => map.get(id) ?? id;
  }, [agents]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <Shell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Inbox · Follow-ups
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            {canSeeOtherAgents ? "Team follow-up queue" : "My follow-ups"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            {canSeeOtherAgents
              ? "Reminders agents have created from inbox conversations. Pending tasks sort soonest-first."
              : "Reminders you set while working through conversations. Pending tasks sort soonest-first."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                statusFilter === s
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {STATUS_META[s].label}
            </button>
          ))}
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + New follow-up
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          {tasks.length} {STATUS_META[statusFilter].label.toLowerCase()} task
          {tasks.length === 1 ? "" : "s"}
        </header>
        {tasks.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            {busy
              ? "Loading…"
              : statusFilter === "PENDING"
                ? "Nothing on your queue right now. Add a reminder from any inbox conversation."
                : `No ${STATUS_META[statusFilter].label.toLowerCase()} tasks in this window.`}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => {
              const due = describeDue(t.dueAt);
              return (
                <li key={t.id} className="px-5 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{t.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 ${STATUS_META[t.status].tone}`}
                        >
                          {STATUS_META[t.status].label}
                        </span>
                        <span className={due.tone}>{due.label}</span>
                        <span className="text-slate-400">
                          · {new Date(t.dueAt).toLocaleString()}
                        </span>
                        {canSeeOtherAgents && (
                          <span className="text-slate-500">
                            · {assigneeName(t.assigneeId)}
                          </span>
                        )}
                      </div>
                      {t.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                          {t.notes}
                        </p>
                      )}
                    </div>
                    {t.status === "PENDING" && (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() => transition(t.id, "complete")}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          Mark done
                        </button>
                        <button
                          onClick={() => transition(t.id, "cancel")}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-base font-semibold text-slate-950">
                New follow-up
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {canSeeOtherAgents
                  ? "Assign to yourself or any active agent."
                  : "This task will be added to your queue."}
              </p>
            </header>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Title
                </label>
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                  placeholder="Call back to confirm pricing"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  maxLength={280}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Due
                </label>
                <input
                  type="datetime-local"
                  value={draft.dueAtLocal}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, dueAtLocal: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              {canSeeOtherAgents && agents.length > 0 && (
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Assignee
                  </label>
                  <select
                    value={draft.assigneeId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, assigneeId: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">— Me ({user.name}) —</option>
                    {agents.map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {a.agentName} · {a.agentEmail}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Notes (optional)
                </label>
                <textarea
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  placeholder="Context the next person on this needs."
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                  maxLength={4000}
                />
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={creating}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {creating ? "Saving…" : "Create"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </Shell>
  );
}
