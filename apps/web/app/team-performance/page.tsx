"use client";

// Team performance dashboard (PRD §7).
// Consumes GET /api/v1/agent-performance — the same endpoint shipped in
// task #97. Role-gated to BUSINESS_ADMIN + TEAM_LEAD; agents shouldn't
// see how they stack against peers without a manager surfacing it.

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface AgentRow {
  agentId: string;
  agentName: string;
  agentEmail: string;
  openConversationCount: number;
  handledInWindow: number;
  avgFirstResponseSeconds: number | null;
  slaBreachedCount: number;
}

interface PerformanceSummary {
  windowDays: number;
  windowStartIso: string;
  totalActiveAgents: number;
  totalOpenConversations: number;
  totalHandledInWindow: number;
  totalSlaBreaches: number;
  rows: AgentRow[];
}

const WINDOW_OPTIONS = [7, 14, 30, 60, 90] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function TeamPerformancePage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [windowDays, setWindowDays] = useState<WindowDays>(14);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (days: WindowDays) => {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<PerformanceSummary>(
        `/api/v1/agent-performance?sinceDays=${days}`,
      );
      setSummary(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to load agent performance",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void load(windowDays);
  }, [user, windowDays]);

  const slaRate = useMemo(() => {
    if (!summary || summary.totalHandledInWindow === 0) return null;
    // Percent of in-window conversations that breached SLA. Lower is
    // better.
    return (summary.totalSlaBreaches / summary.totalHandledInWindow) * 100;
  }, [summary]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Inbox · Team metrics
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Team performance
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Per-agent load, conversations handled, average first-response, and
            SLA breaches over the selected window. Sorted by busiest first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Window
          </label>
          <select
            value={windowDays}
            onChange={(e) =>
              setWindowDays(Number(e.target.value) as WindowDays)
            }
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
            disabled={busy}
          >
            {WINDOW_OPTIONS.map((days) => (
              <option key={days} value={days}>
                Last {days} days
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load(windowDays)}
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active agents"
          value={summary?.totalActiveAgents ?? "—"}
          hint="Currently active AGENT-role users"
        />
        <StatCard
          label="Open conversations"
          value={summary?.totalOpenConversations ?? "—"}
          hint="Right now, across all agents"
        />
        <StatCard
          label="Handled in window"
          value={summary?.totalHandledInWindow ?? "—"}
          hint={
            summary
              ? `Created after ${new Date(summary.windowStartIso).toLocaleDateString()}`
              : undefined
          }
        />
        <StatCard
          label="SLA breaches"
          value={summary?.totalSlaBreaches ?? "—"}
          hint={
            slaRate === null
              ? "No in-window conversations yet"
              : `${slaRate.toFixed(1)}% of handled volume`
          }
        />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">
              Per-agent breakdown
            </h2>
            <p className="text-xs text-slate-500">
              Sorted by handled-in-window, descending; ties break alphabetically.
            </p>
          </div>
        </header>

        {!summary || summary.rows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            {busy
              ? "Loading agents…"
              : "No active agents on this tenant. Invite an agent from Settings to see their metrics here."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Agent</th>
                  <th className="px-5 py-3 font-medium">Open</th>
                  <th className="px-5 py-3 font-medium">
                    Handled (last {summary.windowDays}d)
                  </th>
                  <th className="px-5 py-3 font-medium">Avg first response</th>
                  <th className="px-5 py-3 font-medium">SLA breaches</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <tr
                    key={row.agentId}
                    className="border-t border-slate-100 hover:bg-slate-50/60"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-950">
                        {row.agentName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {row.agentEmail}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {row.openConversationCount}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {row.handledInWindow}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {formatSeconds(row.avgFirstResponseSeconds)}
                    </td>
                    <td
                      className={`px-5 py-3 ${row.slaBreachedCount > 0 ? "font-medium text-rose-700" : "text-slate-700"}`}
                    >
                      {row.slaBreachedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-500">
        SLA breaches come from the inbox SLA timer (
        <code className="font-mono">Conversation.slaBreachedAt</code>). Avg
        first response only includes conversations where an agent reply has
        been recorded.
      </p>
    </DashboardShell>
  );
}
