"use client";

// AI Platform Monitor (PRD-v2 §8, Sprint 2 final UI).
//
// SuperAdmin's triage queue. The scheduled scan pulls signals from
// Wallet Risk, Compliance Firewall, and Provider Router every 6 hours;
// this page lists the resulting items grouped by severity and lets the
// operator ack / resolve / snooze / dismiss them inline.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type Status = "OPEN" | "ACKED" | "RESOLVED" | "DISMISSED" | "SNOOZED";

interface Item {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  body: string;
  status: Status;
  targetTenantId: string | null;
  targetTenant: { id: string; name: string } | null;
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  URGENT: "bg-red-100 text-red-800 border-red-200",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-200",
  LOW: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_COLOR: Record<Status, string> = {
  OPEN: "bg-blue-100 text-blue-800",
  ACKED: "bg-indigo-100 text-indigo-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  DISMISSED: "bg-slate-100 text-slate-600",
  SNOOZED: "bg-purple-100 text-purple-800",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PlatformMonitorPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | Status>("OPEN");
  const [summary, setSummary] = useState<{
    headline: string;
    actions: Array<{ title: string; rationale: string; itemIds: string[] }>;
    totals: Record<Severity, number>;
    totalOpen: number;
    source: "ai" | "fallback";
  } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [lastRun, setLastRun] = useState<{
    ranAt: string;
    result: {
      pushed: boolean;
      reason?: string;
      urgentCount?: number;
      highCount?: number;
    };
  } | null>(null);
  const [sendingNow, setSendingNow] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const query = statusFilter === "ALL" ? "" : `?status=${statusFilter}`;
      const data = await api.get<Item[]>(
        `/api/v1/admin/platform-monitor/items${query}`,
      );
      setItems(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load items: ${e.message}`
          : "Failed to load items.",
      );
    } finally {
      setBusy(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Load the last-run state once on mount and after a manual trigger so
  // operators can verify the FCM pipeline without waiting on the 24h cadence.
  const loadLastRun = useCallback(async () => {
    try {
      const data = await api.get<{
        ranAt: string;
        result: {
          pushed: boolean;
          reason?: string;
          urgentCount?: number;
          highCount?: number;
        };
      } | null>("/api/v1/admin/platform-monitor/summary/last-run");
      setLastRun(data);
    } catch {
      // Non-fatal — the banner just won't render. Real errors surface elsewhere.
      setLastRun(null);
    }
  }, []);

  useEffect(() => {
    if (user) void loadLastRun();
  }, [user, loadLastRun]);

  async function handleSendNow() {
    setSendingNow(true);
    setErr(null);
    try {
      await api.post<{ jobId: string | null }>(
        "/api/v1/admin/platform-monitor/summary/send-now",
      );
      // The worker runs the job async — poll once after a short delay so the
      // operator sees the new "Last sent" timestamp without a manual reload.
      setTimeout(() => void loadLastRun(), 1500);
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to enqueue summary.",
      );
    } finally {
      setSendingNow(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setErr(null);
    try {
      await api.post<{
        walletItems: number;
        complianceItems: number;
        providerItems: number;
        webhookItems: number;
        aiUsageItems: number;
        churnRiskItems: number;
        onboardingStalledItems: number;
        total: number;
      }>("/api/v1/admin/platform-monitor/refresh");
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Refresh failed.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSummarize() {
    setSummarizing(true);
    setErr(null);
    try {
      const result = await api.post<{
        headline: string;
        actions: Array<{ title: string; rationale: string; itemIds: string[] }>;
        totals: Record<Severity, number>;
        totalOpen: number;
        source: "ai" | "fallback";
      }>("/api/v1/admin/platform-monitor/summary");
      setSummary(result);
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to summarize queue.",
      );
    } finally {
      setSummarizing(false);
    }
  }

  async function changeStatus(id: string, status: Status) {
    setErr(null);
    try {
      await api.patch(`/api/v1/admin/platform-monitor/items/${id}`, {
        status,
      });
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Status update failed.",
      );
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const totals = {
    urgent: items.filter((i) => i.severity === "URGENT").length,
    high: items.filter((i) => i.severity === "HIGH").length,
    medium: items.filter((i) => i.severity === "MEDIUM").length,
    low: items.filter((i) => i.severity === "LOW").length,
  };

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Platform Monitor
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Triage queue aggregating signals from Wallet Risk, Compliance
            Firewall, and Provider Router. Scheduled scan every 6 hours;
            tap <em>Refresh</em> to run one now.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSummarize()}
            disabled={summarizing || busy}
            className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {summarizing ? "Summarizing…" : "✦ Daily summary"}
          </button>
          <button
            type="button"
            onClick={() => void handleSendNow()}
            disabled={sendingNow}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Manually trigger the scheduled morning-briefing push for verifying FCM setup"
          >
            {sendingNow ? "Sending…" : "📲 Send me one now"}
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || busy}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {refreshing ? "Scanning…" : "Refresh now"}
          </button>
        </div>
      </header>

      {lastRun && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>
            Last scheduled push:{" "}
            <span className="font-medium text-slate-700">
              {timeAgo(lastRun.ranAt)}
            </span>
          </span>
          {lastRun.result.pushed ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
              Delivered · {lastRun.result.urgentCount ?? 0} urgent ·{" "}
              {lastRun.result.highCount ?? 0} high
            </span>
          ) : (
            <span
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600"
              title={lastRun.result.reason ?? ""}
            >
              Skipped · {lastRun.result.reason ?? "no reason given"}
            </span>
          )}
        </div>
      )}

      {summary && (
        <section className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                {summary.source === "ai" ? "AI daily summary" : "Suggested triage"}
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">
                {summary.headline}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="text-xs text-slate-500 hover:text-slate-700"
              aria-label="Dismiss summary"
            >
              ✕
            </button>
          </div>
          {summary.actions.length > 0 && (
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-800">
              {summary.actions.map((a, i) => (
                <li key={i}>
                  <div className="font-medium">{a.title}</div>
                  {a.rationale && (
                    <div className="text-xs text-slate-600">{a.rationale}</div>
                  )}
                  {a.itemIds.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-mono text-slate-500">
                      {a.itemIds.map((id) => (
                        <span
                          key={id}
                          className="rounded bg-white/80 px-1.5 py-0.5"
                          title={id}
                        >
                          {id.slice(0, 10)}…
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-[10px] text-slate-500">
            Prioritization only — nothing has been resolved or dismissed.
          </p>
        </section>
      )}

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Urgent" value={totals.urgent} accent="red" />
        <StatCard label="High" value={totals.high} accent="orange" />
        <StatCard label="Medium" value={totals.medium} accent="amber" />
        <StatCard label="Low" value={totals.low} accent="slate" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(
          ["ALL", "OPEN", "ACKED", "SNOOZED", "RESOLVED", "DISMISSED"] as const
        ).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 font-medium ${
              statusFilter === s
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {!busy && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No items in this filter. Nothing currently needs SuperAdmin
          attention 🎉
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-lg border p-4 ${SEVERITY_COLOR[item.severity]}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide">
                    {item.severity}
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {item.title}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLOR[item.status]}`}
                  >
                    {item.status}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {item.code}
                  </span>
                </div>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-slate-800">
                {item.body}
              </p>

              {item.targetTenant && (
                <p className="mt-2 text-[11px] text-slate-600">
                  Tenant:{" "}
                  <span className="font-medium">{item.targetTenant.name}</span>{" "}
                  <span className="font-mono text-slate-500">
                    ({item.targetTenant.id.slice(0, 12)}…)
                  </span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  Created {formatDateTime(item.createdAt)}
                  {item.resolvedAt && (
                    <> · Resolved {formatDateTime(item.resolvedAt)}</>
                  )}
                </span>
                <div className="flex gap-1">
                  {item.status === "OPEN" && (
                    <ActionButton
                      label="Ack"
                      onClick={() => void changeStatus(item.id, "ACKED")}
                    />
                  )}
                  {item.status !== "RESOLVED" && (
                    <ActionButton
                      label="Resolve"
                      onClick={() => void changeStatus(item.id, "RESOLVED")}
                    />
                  )}
                  {item.status !== "SNOOZED" && (
                    <ActionButton
                      label="Snooze"
                      onClick={() => void changeStatus(item.id, "SNOOZED")}
                    />
                  )}
                  {item.status !== "DISMISSED" && (
                    <ActionButton
                      label="Dismiss"
                      onClick={() => void changeStatus(item.id, "DISMISSED")}
                    />
                  )}
                  {item.status !== "OPEN" && (
                    <ActionButton
                      label="Reopen"
                      onClick={() => void changeStatus(item.id, "OPEN")}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "red" | "orange" | "amber" | "slate";
}) {
  const accents = {
    red: "border-red-200 bg-red-50",
    orange: "border-orange-200 bg-orange-50",
    amber: "border-amber-200 bg-amber-50",
    slate: "border-slate-200 bg-white",
  } as const;
  const numColor = {
    red: "text-red-800",
    orange: "text-orange-800",
    amber: "text-amber-800",
    slate: "text-slate-900",
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

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
    >
      {label}
    </button>
  );
}
