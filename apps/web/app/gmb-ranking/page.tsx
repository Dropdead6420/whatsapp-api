"use client";

// AdGrowly — Ranking tracker (planning PDF §2/§3). Combines the AI Keyword
// Finder (module 10) with the local-ranking tracker (module 3): generate
// keyword ideas, track them, record rank checks and view the trend.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface KeywordIdea {
  keyword: string;
  kind: string;
  score: number;
}

interface Keyword {
  id: string;
  keyword: string;
  isActive: boolean;
}

interface Snapshot {
  id: string;
  rank: number | null;
  bucket: string;
  checkedAt: string;
}

interface Trend {
  latest: number | null;
  previous: number | null;
  delta: number | null;
  best: number | null;
  average: number | null;
  checks: number;
  bucket: string;
}

interface KeywordDetail extends Keyword {
  trend: Trend;
  snapshots: Snapshot[];
}

const BUCKET_STYLES: Record<string, string> = {
  top3: "bg-emerald-50 text-emerald-700 border-emerald-200",
  top10: "bg-amber-50 text-amber-700 border-amber-200",
  beyond: "bg-slate-100 text-slate-600 border-slate-200",
  not_found: "bg-red-50 text-red-700 border-red-200",
};

export default function GmbRankingPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [services, setServices] = useState("");
  const [ideas, setIdeas] = useState<KeywordIdea[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [detail, setDetail] = useState<Record<string, KeywordDetail>>({});
  const [rankInputs, setRankInputs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshKeywords() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      setKeywords(await api.get<Keyword[]>(`/api/v1/gmb/keywords${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load keywords.");
    }
  }

  useEffect(() => {
    if (user) void refreshKeywords();
  }, [user]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      const res = await api.post<{ ideas: KeywordIdea[] }>("/api/v1/gmb/keyword-ideas/generate", {
        category: category.trim() || undefined,
        city: city.trim() || undefined,
        services: services.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setIdeas(res.ideas);
      if (res.ideas.length === 0) setNotice("Add a category or service to generate ideas.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate ideas.");
    }
  }

  async function track(keyword: string) {
    if (!locationId.trim()) {
      setErr("Enter a Location ID to track keywords.");
      return;
    }
    setErr(null);
    try {
      await api.post("/api/v1/gmb/keywords", { locationId: locationId.trim(), keyword });
      setNotice(`Tracking "${keyword}".`);
      await refreshKeywords();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to track keyword.");
    }
  }

  async function loadTrend(id: string) {
    try {
      setDetail((d) => ({ ...d, [id]: undefined as unknown as KeywordDetail }));
      const res = await api.get<KeywordDetail>(`/api/v1/gmb/keywords/${id}`);
      setDetail((d) => ({ ...d, [id]: res }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load trend.");
    }
  }

  async function recordRank(id: string) {
    const raw = (rankInputs[id] ?? "").trim();
    const rank = raw === "" ? null : Number(raw);
    setErr(null);
    try {
      await api.post(`/api/v1/gmb/keywords/${id}/snapshots`, { rank });
      setRankInputs((r) => ({ ...r, [id]: "" }));
      setNotice("Rank recorded.");
      await loadTrend(id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to record rank.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Ranking tracker</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Find local-SEO keywords, track them, and record rank checks to watch your trend over time.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <label className="mb-4 block max-w-md text-sm font-medium text-slate-700">
        Location ID
        <input value={locationId} onChange={(e) => setLocationId(e.target.value)} onBlur={() => void refreshKeywords()} placeholder="loc_…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">AI keyword finder</h2>
          <form onSubmit={generate} className="mt-3 space-y-3">
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Cafe)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Pune)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="Services, comma-separated" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Generate ideas</button>
          </form>
          {ideas.length > 0 && (
            <ul className="mt-4 space-y-2">
              {ideas.map((idea) => (
                <li key={idea.keyword} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <span><span className="text-slate-800">{idea.keyword}</span> <span className="text-xs text-slate-400">· {idea.kind} · {idea.score}</span></span>
                  <button onClick={() => void track(idea.keyword)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Track</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-slate-950">Tracked keywords</h2>
          <div className="space-y-3">
            {keywords.length === 0 && <p className="text-sm text-slate-500">No keywords tracked yet.</p>}
            {keywords.map((k) => {
              const d = detail[k.id];
              return (
                <div key={k.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{k.keyword}</span>
                    {d?.trend && (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BUCKET_STYLES[d.trend.bucket]}`}>
                        {d.trend.latest == null ? "not found" : `#${d.trend.latest}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      placeholder="rank"
                      value={rankInputs[k.id] ?? ""}
                      onChange={(e) => setRankInputs((r) => ({ ...r, [k.id]: e.target.value }))}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button onClick={() => void recordRank(k.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Record</button>
                    <button onClick={() => void loadTrend(k.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Trend</button>
                  </div>
                  {d?.trend && (
                    <p className="mt-2 text-xs text-slate-500">
                      latest {d.trend.latest ?? "—"} · prev {d.trend.previous ?? "—"} · Δ {d.trend.delta ?? "—"} · best {d.trend.best ?? "—"} · avg {d.trend.average ?? "—"} · {d.trend.checks} checks
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
