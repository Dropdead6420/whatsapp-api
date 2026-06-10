"use client";

// AdGrowly — Customer GMB Dashboard (planning PDF §3). Read-only aggregate of
// business score, reviews, ranking, citations, posts, credits and alerts,
// served by GET /api/v1/gmb/dashboard (gmbDashboard.service).

import { useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Dashboard {
  businessScore: number | null;
  grade: string | null;
  locations: { total: number; connected: number };
  reviews: { count: number; average: number; unanswered: number };
  ranking: { trackedKeywords: number; top3: number; top10: number; notFound: number };
  citations: { total: number; consistent: number; consistencyScore: number };
  posts: { recent: number; total: number };
  credits: number | null;
  advisor: { score: number; grade: string; at: string } | null;
  alerts: { severity: "high" | "medium" | "low"; area: string; message: string }[];
  generatedAt: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-red-200 bg-red-50 text-red-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-600",
};

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function GmbDashboardPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      setErr(null);
      setData(await api.get<Dashboard>("/api/v1/gmb/dashboard"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load the dashboard.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const score = data?.businessScore;
  const scoreColor =
    score == null ? "text-slate-400" : score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Google Business</p>
          <h1 className="text-2xl font-semibold text-slate-950">Growth dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Your business health at a glance — reviews, local ranking, citations, posting and alerts.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
            <div className="rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Business score</p>
              <p className={`mt-2 text-5xl font-bold ${scoreColor}`}>{score ?? "—"}</p>
              <p className="mt-1 text-sm text-slate-500">
                {data.grade ? `Grade ${data.grade}` : "Run the Ranking Advisor to get a score"}
              </p>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Alerts</h2>
              {data.alerts.length === 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  All clear — no action items right now.
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.alerts.map((a, i) => (
                    <li key={i} className={`rounded-md border px-4 py-2 text-sm ${SEVERITY_STYLES[a.severity]}`}>
                      <span className="font-medium uppercase">{a.severity}</span> · {a.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Reviews"
              value={String(data.reviews.count)}
              hint={`${data.reviews.average}★ avg · ${data.reviews.unanswered} unanswered`}
            />
            <MetricCard
              label="Local ranking"
              value={`${data.ranking.top3}/${data.ranking.trackedKeywords}`}
              hint={`in top 3 · ${data.ranking.top10} in top 10`}
            />
            <MetricCard
              label="Citations"
              value={`${data.citations.consistent}/${data.citations.total}`}
              hint={`${Math.round(data.citations.consistencyScore * 100)}% NAP-consistent`}
            />
            <MetricCard
              label="Posts (30d)"
              value={String(data.posts.recent)}
              hint={`${data.posts.total} total`}
            />
            <MetricCard
              label="Locations"
              value={`${data.locations.connected}/${data.locations.total}`}
              hint="connected to Google"
            />
            <MetricCard
              label="Credits"
              value={data.credits == null ? "—" : String(data.credits)}
              hint="available balance"
            />
          </div>

          <p className="text-xs text-slate-400">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
