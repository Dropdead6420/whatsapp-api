"use client";

// AdGrowly — Google Business channel Overview ("reputation command center",
// planning PDF §3). Read-only aggregate served by GET /api/v1/gmb/dashboard
// (gmbDashboard.service). The channel tab-bar + quick actions link out to the
// existing Locations / Reviews / Posts / Analytics pages.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

const TABS = [
  { label: "Overview", href: "/gmb-dashboard", active: true },
  { label: "Locations", href: "/gmb-locations" },
  { label: "Reviews", href: "/gmb-reputation" },
  { label: "Posts", href: "/gmb" },
  { label: "Analytics", href: "/gmb-insights" },
];

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
      <div className="mt-2 h-1 rounded-full bg-slate-100">
        <div className={`h-1 rounded-full ${accent}`} style={{ width: "100%" }} />
      </div>
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

  const handledPct = useMemo(() => {
    if (!data || data.reviews.count === 0) return 100;
    return Math.round(((data.reviews.count - data.reviews.unanswered) / data.reviews.count) * 100);
  }, [data]);

  const setup = useMemo(() => {
    const loc = data?.locations ?? { total: 0, connected: 0 };
    const rev = data?.reviews ?? { count: 0, average: 0, unanswered: 0 };
    return [
      { label: "Google connected", done: loc.connected > 0 },
      { label: "Locations available", done: loc.total > 0 },
      { label: "Locations selected", done: loc.total > 0 },
      { label: "Locations mapped", done: loc.connected > 0 },
      { label: "Reviews synced", done: rev.count > 0 },
    ];
  }, [data]);

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Google Business Channel</p>
          <h1 className="text-2xl font-semibold text-slate-950">Google Business</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Connect Google once, map locations, auto-sync reviews, reply with AI, and track Google review performance from one place.
          </p>
        </div>
        <Link href="/gmb-locations" className="flex-none rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Connect Google
        </Link>
      </div>

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${t.active ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
            <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Location Workspace</span>
              <h2 className="mt-3 text-xl font-semibold text-slate-950">Google reputation command center</h2>
              <p className="mt-1 max-w-xl text-sm text-slate-500">
                Map every Google Business location, keep reviews synced in the background, and move reply work into one focused queue.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/gmb-locations" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Map locations</Link>
                <Link href="/gmb-reputation" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open reviews</Link>
                <Link href="/gmb-insights" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">View analytics</Link>
              </div>
              <div className="mt-5 rounded-md border border-slate-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Review health</p>
                <p className="mt-1 text-4xl font-bold text-slate-950">{data.reviews.average || "—"}<span className="ml-2 text-sm font-normal text-slate-400">avg rating</span></p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${handledPct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{handledPct}% of reviews handled or drafted</p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Setup progress</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">Location coverage</h3>
              <ul className="mt-3 space-y-2">
                {setup.map((s) => (
                  <li key={s.label} className="flex items-center gap-2 text-sm">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {s.done ? "✓" : "•"}
                    </span>
                    <span className={s.done ? "text-slate-700" : "text-slate-400"}>{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Locations" value={String(data.locations.total)} accent="bg-blue-400" />
            <StatCard label="Managed" value={String(data.locations.connected)} accent="bg-emerald-500" />
            <StatCard label="Mapped" value={String(data.locations.connected)} accent="bg-green-600" />
            <StatCard label="Reviews" value={String(data.reviews.count)} accent="bg-amber-500" />
            <StatCard label="Not replied" value={String(data.reviews.unanswered)} accent={data.reviews.unanswered > 0 ? "bg-red-500" : "bg-emerald-500"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800">Recommended next actions</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {[
                  { title: "Choose locations", body: "Select only the Google locations this workspace should manage.", href: "/gmb-locations" },
                  { title: "Clear reply queue", body: "Open not-replied reviews and generate AI drafts faster.", href: "/gmb-reputation" },
                  { title: "Track performance", body: "Watch ranking and review trends over time.", href: "/gmb-insights" },
                ].map((a) => (
                  <Link key={a.title} href={a.href} className="block rounded-md border border-slate-200 p-3 hover:bg-slate-50">
                    <p className="text-sm font-medium text-slate-900">{a.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{a.body}</p>
                    <p className="mt-2 text-xs font-semibold text-emerald-700">Open →</p>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Risk watch</h3>
                {data.alerts.length > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{data.alerts.length} alert{data.alerts.length === 1 ? "" : "s"}</span>
                )}
              </div>
              {data.alerts.length === 0 ? (
                <p className="mt-3 text-sm text-emerald-700">All clear — no action items right now.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.alerts.slice(0, 4).map((a, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      <span className={`font-semibold uppercase ${a.severity === "high" ? "text-red-600" : a.severity === "medium" ? "text-amber-600" : "text-slate-500"}`}>{a.severity}</span> · {a.message}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/gmb-reputation" className="mt-4 block rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50">
                Review reply queue
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Generated {new Date(data.generatedAt).toLocaleString()}</p>
            <button onClick={() => void refresh()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
