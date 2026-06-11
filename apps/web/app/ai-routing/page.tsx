"use client";

// SuperAdmin — AI Settings workload routing (AI Control Center). Per workload,
// choose enabled + provider + model. Config-only for now; the AI gateway reads
// it to route each workload. Backed by GET/PUT /api/v1/admin/ai-routing.

import { useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Route {
  workload: string;
  label: string;
  group: "text" | "qr" | "media" | "embeddings";
  description: string;
  enabled: boolean;
  provider: string;
  model: string;
}

const GROUPS: { key: Route["group"]; title: string; blurb: string }[] = [
  { key: "text", title: "Text & Reasoning", blurb: "Content, text, chat and code workloads." },
  { key: "qr", title: "QR Generation", blurb: "QR-controlled generation has its own provider route." },
  { key: "media", title: "Media Generation", blurb: "Image, video and voice usually deserve their own provider path." },
  { key: "embeddings", title: "Embeddings", blurb: "Search, similarity, retrieval and indexing." },
];

export default function AiRoutingPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [routes, setRoutes] = useState<Route[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setErr(null);
      setRoutes(await api.get<Route[]>("/api/v1/admin/ai-routing"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load AI routing (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user]);

  function setCell(workload: string, patch: Partial<Route>) {
    setRoutes((prev) => prev.map((r) => (r.workload === workload ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.put("/api/v1/admin/ai-routing", {
        routes: routes.map((r) => ({ workload: r.workload, enabled: r.enabled, provider: r.provider, model: r.model })),
      });
      setNotice("AI routing saved.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save AI routing.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">AI Control Center</p>
        <h1 className="text-2xl font-semibold text-slate-950">AI Settings — Workload Routing</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Choose one strong default stack, keep provider keys organized, and route each workload only when it benefits from a different model family.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="space-y-5">
        {GROUPS.map((g) => {
          const rows = routes.filter((r) => r.group === g.key);
          if (rows.length === 0) return null;
          return (
            <section key={g.key} className="rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
                <p className="mt-1 text-sm text-slate-500">{g.blurb}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2">Workload</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Provider</th>
                    <th className="px-4 py-2">Model</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map((r) => (
                    <tr key={r.workload}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-slate-900">{r.label}</p>
                        <p className="mt-0.5 max-w-xs text-xs text-slate-400">{r.description}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <select
                          value={r.enabled ? "enable" : "disable"}
                          onChange={(e) => setCell(r.workload, { enabled: e.target.value === "enable" })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="enable">Enable</option>
                          <option value="disable">Disable</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input value={r.provider} onChange={(e) => setCell(r.workload, { provider: e.target.value })} className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input value={r.model} onChange={(e) => setCell(r.workload, { model: e.target.value })} className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      <div className="mt-5">
        <button onClick={() => void save()} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "Saving..." : "Save changes"}
        </button>
      </div>
    </DashboardShell>
  );
}
