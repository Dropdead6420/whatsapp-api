"use client";

// GMB AI Manager (Complete Planning PDF §2.19). Draft Google Business
// Profile posts with AI captions and schedule them. Live publishing to
// Google lands once the Business-Profile OAuth connection exists.

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const TYPES = ["UPDATE", "OFFER", "EVENT"] as const;
const TONES = ["friendly", "professional", "playful"] as const;

interface GmbPost {
  id: string;
  type: string;
  summary: string;
  callToActionType: string | null;
  scheduledAt: string | null;
  status: string;
  error: string | null;
  publishedAt: string | null;
}

export default function GmbPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<GmbPost[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [type, setType] = useState<string>("UPDATE");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<string>("friendly");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [costs, setCosts] = useState<{ feature: string; label: string; credits: number }[]>([]);

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<GmbPost[]>("/api/v1/gmb/posts"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load posts.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ feature: string; label: string; credits: number }[]>("/api/v1/gmb/credit-costs")
      .then(setCosts)
      .catch(() => setCosts([]));
  }, [user]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/posts/generate", {
        businessName: businessName.trim(),
        type,
        topic: topic.trim() || undefined,
        tone,
      });
      setTopic("");
      setNotice("Draft post generated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate post.");
    } finally {
      setBusy(false);
    }
  }

  async function schedule(id: string) {
    const when = window.prompt("Schedule at (ISO date-time, e.g. 2026-06-10T09:00:00Z):");
    if (!when) return;
    try {
      await api.post(`/api/v1/gmb/posts/${id}/schedule`, { scheduledAt: new Date(when).toISOString() });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to schedule.");
    }
  }

  async function publishNow(id: string) {
    setErr(null);
    setNotice(null);
    try {
      // Mark due now, then run the publisher immediately (the worker would
      // otherwise pick it up on its next sweep). Live-publishes to Google when
      // the post's location is connected; records local-only otherwise.
      await api.post(`/api/v1/gmb/posts/${id}/schedule`, { scheduledAt: new Date().toISOString() });
      const r = await api.post<{ live: number; localOnly: number; failed: number }>(
        "/api/v1/gmb/posts/run-scheduled",
        {},
      );
      setNotice(
        r.failed > 0
          ? "Publish attempted — check the post for the failure reason."
          : r.live > 0
            ? "Published live to Google."
            : "Marked published (connect a Google location to publish live).",
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to publish.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/api/v1/gmb/posts/${id}`);
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
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Business Profile posts</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Draft posts with AI captions, then publish now or schedule them.
          Posts go live on Google for connected locations; the rest are saved as
          published records.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">AI content tools:</span>
        {[
          { href: "/gmb-descriptions", label: "Descriptions" },
          { href: "/gmb-images", label: "Images" },
          { href: "/gmb-advisor", label: "Advisor" },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t.label}
          </Link>
        ))}
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={generate} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">AI draft</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Topic / offer (optional)
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. 20% off this week" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Tone
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {(() => {
            const c = costs.find((x) => x.feature === "gmb_post_caption");
            return (
              <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Generating..." : c && c.credits > 0 ? `Generate draft · ${c.credits} credit${c.credits === 1 ? "" : "s"}` : "Generate draft"}
              </button>
            );
          })()}
          {costs.length > 0 && (
            <details className="mt-4 text-xs text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600">AI credit costs</summary>
              <ul className="mt-2 space-y-1">
                {costs.map((c) => (
                  <li key={c.feature} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className="font-medium text-slate-700">{c.credits === 0 ? "free" : `${c.credits} cr`}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No posts yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((p) => (
                <li key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{p.type}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700"
                          : p.status === "SCHEDULED" ? "bg-blue-50 text-blue-700"
                          : p.status === "FAILED" ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                        }`}>{p.status}</span>
                        {p.scheduledAt && (
                          <span className="text-xs text-slate-500">{new Date(p.scheduledAt).toLocaleString()}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{p.summary}</p>
                      {p.status === "FAILED" && p.error && (
                        <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{p.error}</p>
                      )}
                      {p.status === "PUBLISHED" && p.publishedAt && (
                        <p className="mt-1 text-xs text-emerald-600">Published {new Date(p.publishedAt).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex flex-none gap-2">
                      {p.status !== "PUBLISHED" && (
                        <button onClick={() => void publishNow(p.id)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                          {p.status === "FAILED" ? "Retry" : "Publish now"}
                        </button>
                      )}
                      <button onClick={() => void schedule(p.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Schedule</button>
                      <button onClick={() => void remove(p.id)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
