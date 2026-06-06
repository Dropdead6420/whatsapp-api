"use client";

// Landing / AI Website Builder (Complete Planning PDF §2.16). Generate a
// starter single-page site from a few business inputs, then publish or
// archive it. English-first; a full block editor is a follow-up.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const GOALS = ["leads", "sales", "bookings", "awareness"] as const;

interface LandingPage {
  id: string;
  slug: string;
  title: string;
  status: string;
  blocks: unknown[];
  updatedAt: string;
}

export default function LandingPagesPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<LandingPage[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState<string>("leads");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<LandingPage[]>("/api/v1/landing-pages"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load pages.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const page = await api.post<LandingPage>("/api/v1/landing-pages/generate", {
        businessName: businessName.trim(),
        industry: industry.trim() || undefined,
        primaryGoal,
        city: city.trim() || undefined,
      });
      setBusinessName("");
      setIndustry("");
      setCity("");
      setNotice(`Draft "${page.title}" generated (${page.blocks.length} sections).`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate page.");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "publish" | "archive") {
    setErr(null);
    try {
      await api.post(`/api/v1/landing-pages/${id}/${action}`, {});
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : `Unable to ${action}.`);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this page?")) return;
    try {
      await api.delete(`/api/v1/landing-pages/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Website</p>
        <h1 className="text-2xl font-semibold text-slate-950">Landing pages</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Generate a starter single-page site, then publish it. Published pages are
          served read-only at the public render endpoint.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={generate} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">AI generate</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Industry (optional)
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. restaurant, salon, clinic" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Primary goal
            <select value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            City (optional)
            <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Generating..." : "Generate draft"}
          </button>
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No pages yet. Generate one to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Title</th>
                    <th className="px-4 py-3 font-semibold">Slug</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-slate-950">{p.title}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">/{p.slug}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700"
                          : p.status === "ARCHIVED" ? "bg-slate-100 text-slate-600"
                          : "bg-amber-50 text-amber-700"
                        }`}>{p.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.status !== "PUBLISHED" && (
                          <button onClick={() => void act(p.id, "publish")} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Publish</button>
                        )}
                        {p.status !== "ARCHIVED" && (
                          <button onClick={() => void act(p.id, "archive")} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Archive</button>
                        )}
                        <button onClick={() => void remove(p.id)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
