"use client";

// AdGrowly — Reports (planning PDF §3 + §2 AI monthly report). Generate a
// period report aggregating reviews/ranking/citations/posts with a narrative
// summary + action plan. Backed by module 8: /api/v1/gmb/reports.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const TYPES = ["WEEKLY", "MONTHLY", "CUSTOM"] as const;

interface ActionItem {
  priority: "high" | "medium" | "low";
  area: string;
  task: string;
}

interface Report {
  id: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  summary: string | null;
  actionPlan: ActionItem[] | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

const toIso = (d: string) => (d ? new Date(d).toISOString() : undefined);

export default function GmbReportsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Report[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [type, setType] = useState<string>("MONTHLY");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [locationId, setLocationId] = useState("");

  async function refresh() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      setItems(await api.get<Report[]>(`/api/v1/gmb/reports${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load reports.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/reports/generate", {
        type,
        periodStart: toIso(periodStart),
        periodEnd: toIso(periodEnd),
        locationId: locationId.trim() || undefined,
      });
      setNotice("Report generated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate report.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this report?")) return;
    try {
      await api.delete(`/api/v1/gmb/reports/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString();

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Reports</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Generate a weekly or monthly performance report — reviews, ranking, citations and posts — with a narrative summary and an action plan.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={generate} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Generate report</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Period start
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Period end
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Location ID (optional)
            <input value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="tenant-wide if blank" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Generate</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}
          {items.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{r.type} · {fmt(r.periodStart)} – {fmt(r.periodEnd)}</span>
                <button onClick={() => void remove(r.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
              </div>
              {r.summary && <p className="mt-2 text-sm text-slate-600">{r.summary}</p>}
              {r.actionPlan && r.actionPlan.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {r.actionPlan.map((a, i) => (
                    <li key={i} className="text-sm text-slate-600">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[a.priority]}`}>{a.priority}</span>
                      {a.task}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
