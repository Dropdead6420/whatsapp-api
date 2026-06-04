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
import { FollowUpComposer } from "../../src/components/FollowUpComposer";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";
import { useI18n } from "../../src/i18n/I18nProvider";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

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

function describeDue(dueAt: string, t: TFunc): { label: string; tone: string } {
  const due = new Date(dueAt);
  const diffMs = due.getTime() - Date.now();
  const absHours = Math.abs(diffMs) / (1000 * 60 * 60);
  if (diffMs < 0) {
    return {
      label:
        absHours < 24
          ? t("followups.overdueHours", { n: Math.round(absHours) })
          : t("followups.overdueDays", { n: Math.round(absHours / 24) }),
      tone: "text-rose-700",
    };
  }
  if (absHours < 24) {
    return {
      label: t("followups.dueInHours", { n: Math.round(absHours) }),
      tone: "text-amber-700",
    };
  }
  return {
    label: t("followups.dueInDays", { n: Math.round(absHours / 24) }),
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
  const { t } = useI18n();
  const Shell = agentPortal ? AgentShell : DashboardShell;
  const canSeeOtherAgents = user?.role !== "AGENT";
  const statusLabel = (s: FollowUpStatus) => t("followups.status." + s.toLowerCase());

  const [statusFilter, setStatusFilter] = useState<FollowUpStatus>("PENDING");
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [agents, setAgents] = useState<AgentRowLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);

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
        e instanceof ApiClientError ? e.message : t("followups.loadFailed"),
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

  const transition = async (
    taskId: string,
    kind: "complete" | "cancel",
  ) => {
    setErr(null);
    try {
      await api.post(`/api/v1/follow-up-tasks/${taskId}/${kind}`);
      await loadTasks();
    } catch (e) {
      const fallback =
        kind === "complete"
          ? t("followups.completeFailed")
          : t("followups.cancelFailed");
      setErr(e instanceof ApiClientError ? e.message : fallback);
    }
  };

  const assigneeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.agentId, a.agentName);
    return (id: string) => map.get(id) ?? id;
  }, [agents]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;
  }

  return (
    <Shell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {t("followups.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            {canSeeOtherAgents ? t("followups.titleTeam") : t("followups.titleMine")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            {canSeeOtherAgents
              ? t("followups.subtitleTeam")
              : t("followups.subtitleMine")}
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
              {statusLabel(s)}
            </button>
          ))}
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {t("followups.new")}
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
          {t("followups.taskCountStatus", {
            count: tasks.length,
            status: statusLabel(statusFilter).toLowerCase(),
          })}
        </header>
        {tasks.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            {busy
              ? t("common.loading")
              : statusFilter === "PENDING"
                ? t("followups.emptyPending")
                : t("followups.emptyOther", {
                    status: statusLabel(statusFilter).toLowerCase(),
                  })}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const due = describeDue(task.dueAt, t);
              return (
                <li key={task.id} className="px-5 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 ${STATUS_META[task.status].tone}`}
                        >
                          {statusLabel(task.status)}
                        </span>
                        <span className={due.tone}>{due.label}</span>
                        <span className="text-slate-400">
                          · {new Date(task.dueAt).toLocaleString()}
                        </span>
                        {canSeeOtherAgents && (
                          <span className="text-slate-500">
                            · {assigneeName(task.assigneeId)}
                          </span>
                        )}
                      </div>
                      {task.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                          {task.notes}
                        </p>
                      )}
                    </div>
                    {task.status === "PENDING" && (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() => transition(task.id, "complete")}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          {t("followups.markDone")}
                        </button>
                        <button
                          onClick={() => transition(task.id, "cancel")}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t("followups.cancel")}
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
        <FollowUpComposer
          userRole={user.role}
          userName={user.name}
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={() => void loadTasks()}
        />
      )}
    </Shell>
  );
}
