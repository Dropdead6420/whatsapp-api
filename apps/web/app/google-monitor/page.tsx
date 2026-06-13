"use client";

// AdGrowly — Google API Monitor (planning PDF §4). SUPER_ADMIN observability
// over Google Business Profile connections: per-location health + API log feed.
// Backed by module 14: /api/v1/admin/google-monitor (/overview, /logs).

import { useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface LocationHealth {
  locationId: string;
  name: string;
  tenantId: string;
  state: "CONNECTED" | "STALE" | "ERROR" | "DISCONNECTED";
  hasCredential: boolean;
  lastSyncedAt: string | null;
  recentErrorCount: number;
}

interface Overview {
  generatedAt: string;
  windowHours: number;
  total: number;
  summary: Record<string, number>;
  locations: LocationHealth[];
}

interface Log {
  id: string;
  locationId: string | null;
  operation: string;
  status: "OK" | "ERROR" | "RATE_LIMITED";
  statusCode: number | null;
  message: string | null;
  rateLimitRemaining: number | null;
  createdAt: string;
}

const STATE_STYLES: Record<string, string> = {
  CONNECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  STALE: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  DISCONNECTED: "bg-slate-100 text-slate-600 border-slate-200",
};

const LOG_STYLES: Record<string, string> = {
  OK: "bg-emerald-50 text-emerald-700",
  ERROR: "bg-red-50 text-red-700",
  RATE_LIMITED: "bg-amber-50 text-amber-700",
};

export default function GoogleMonitorPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [schema, setSchema] = useState<{ ok: boolean; healthy: number; total: number; checks: { table: string; ok: boolean; error?: string }[] } | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const q = statusFilter ? `?status=${statusFilter}&limit=100` : "?limit=100";
      const [ov, lg] = await Promise.all([
        api.get<Overview>("/api/v1/admin/google-monitor/overview"),
        api.get<Log[]>(`/api/v1/admin/google-monitor/logs${q}`),
      ]);
      setOverview(ov);
      setLogs(lg);
      try {
        setSchema(await api.get("/api/v1/admin/google-monitor/gmb-schema"));
      } catch {
        setSchema(null);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load monitor (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user, statusFilter]);

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Super Admin</p>
          <h1 className="text-2xl font-semibold text-slate-950">Google API Monitor</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Connection health, token/sync status, rate limits and the raw Google Business Profile API log across the platform.
          </p>
        </div>
        {schema && (
          <span
            title={
              schema.ok
                ? "All GMB tables reachable"
                : schema.checks.filter((c) => !c.ok).map((c) => `${c.table}: ${c.error ?? "missing"}`).join("\n")
            }
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              schema.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            GMB schema {schema.healthy}/{schema.total} {schema.ok ? "✓" : "— migrations pending"}
          </span>
        )}
        <button onClick={() => void refresh()} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      {overview && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            {(["CONNECTED", "STALE", "ERROR", "DISCONNECTED"] as const).map((s) => (
              <div key={s} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.toLowerCase()}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{overview.summary[s] ?? 0}</p>
              </div>
            ))}
          </div>

          <div className="mb-8 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Location</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">Last sync</th>
                  <th className="px-4 py-2">Errors (24h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.locations.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-4 text-slate-500">No locations.</td></tr>
                )}
                {overview.locations.map((l) => (
                  <tr key={l.locationId}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{l.name}</div>
                      <div className="text-xs text-slate-400">{l.hasCredential ? "credential set" : "no credential"}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_STYLES[l.state]}`}>{l.state}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{l.lastSyncedAt ? new Date(l.lastSyncedAt).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{l.recentErrorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-950">API log</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">All</option>
          <option value="OK">OK</option>
          <option value="ERROR">Error</option>
          <option value="RATE_LIMITED">Rate limited</option>
        </select>
      </div>
      <div className="space-y-2">
        {logs.length === 0 && <p className="text-sm text-slate-500">No log entries.</p>}
        {logs.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
            <div>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LOG_STYLES[l.status]}`}>{l.status}</span>
              <span className="ml-2 font-medium text-slate-800">{l.operation}</span>
              {l.statusCode != null && <span className="ml-2 text-xs text-slate-400">HTTP {l.statusCode}</span>}
              {l.message && <span className="ml-2 text-xs text-slate-500">{l.message}</span>}
            </div>
            <div className="text-xs text-slate-400">
              {l.rateLimitRemaining != null && <span className="mr-2">rl {l.rateLimitRemaining}</span>}
              {new Date(l.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
