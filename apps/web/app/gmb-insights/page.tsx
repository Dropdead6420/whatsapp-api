"use client";

// AdGrowly — Insights (planning PDF §3). Record Business-Profile performance
// snapshots per period and see headline totals + action rate. Backed by
// module 4: /api/v1/gmb/insights (+ /summary).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const METRIC_FIELDS = [
  ["mapsViews", "Maps views"],
  ["searchViews", "Search views"],
  ["directSearches", "Direct searches"],
  ["discoverySearches", "Discovery searches"],
  ["brandedSearches", "Branded searches"],
  ["callClicks", "Calls"],
  ["websiteClicks", "Website clicks"],
  ["directionRequests", "Directions"],
  ["messageClicks", "Messages"],
  ["bookingClicks", "Bookings"],
  ["photoViews", "Photo views"],
] as const;

interface Insight {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalViews: number;
  totalSearches: number;
  totalActions: number;
  actionRate: number;
}

interface Summary {
  periods: number;
  totalViews: number;
  totalSearches: number;
  totalActions: number;
  actionRate: number;
  rangeStart: string | null;
  rangeEnd: string | null;
}

const toIso = (d: string) => (d ? new Date(d).toISOString() : undefined);

export default function GmbInsightsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [locationId, setLocationId] = useState("");
  const [items, setItems] = useState<Insight[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [metrics, setMetrics] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      const [list, sum] = await Promise.all([
        api.get<Insight[]>(`/api/v1/gmb/insights${q}`),
        api.get<Summary>(`/api/v1/gmb/insights/summary${q}`),
      ]);
      setItems(list);
      setSummary(sum);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load insights.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locationId.trim()) {
      setErr("Enter a Location ID to record insights.");
      return;
    }
    setErr(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        locationId: locationId.trim(),
        periodStart: toIso(periodStart),
        periodEnd: toIso(periodEnd),
      };
      for (const [key] of METRIC_FIELDS) body[key] = Number(metrics[key] || 0);
      await api.post("/api/v1/gmb/insights", body);
      setMetrics({});
      setNotice("Snapshot recorded.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to record snapshot.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this snapshot?")) return;
    try {
      await api.delete(`/api/v1/gmb/insights/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const fmtRange = (s: string) => new Date(s).toLocaleDateString();

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Insights</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Record Business-Profile performance per period and track views, searches and customer actions.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <label className="mb-4 block max-w-md text-sm font-medium text-slate-700">
        Location ID
        <input value={locationId} onChange={(e) => setLocationId(e.target.value)} onBlur={() => void refresh()} placeholder="loc_…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total views</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.totalViews}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total actions</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.totalActions}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Action rate</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{Math.round(summary.actionRate * 100)}%</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Periods</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.periods}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <form onSubmit={record} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Record snapshot</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Period start
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Period end
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {METRIC_FIELDS.map(([key, label]) => (
              <label key={key} className="block text-xs font-medium text-slate-600">
                {label}
                <input
                  type="number"
                  min={0}
                  value={metrics[key] ?? ""}
                  onChange={(e) => setMetrics((m) => ({ ...m, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
            ))}
          </div>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Record snapshot</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No snapshots yet.</p>}
          {items.map((it) => (
            <div key={it.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{fmtRange(it.periodStart)} – {fmtRange(it.periodEnd)}</span>
                <button onClick={() => void remove(it.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {it.totalViews} views · {it.totalSearches} searches · {it.totalActions} actions · {Math.round(it.actionRate * 100)}% action rate
              </p>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
