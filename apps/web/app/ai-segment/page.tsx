"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface FilterSpec {
  reasoning: string;
  tagsAny?: string[];
  tagsAll?: string[];
  optedOut?: boolean;
  inactiveSinceDays?: number;
  interactedWithinDays?: number;
  aiScoreGte?: number;
  aiScoreLte?: number;
  hasEmail?: boolean;
}

interface SegmentResult {
  spec: FilterSpec;
  count: number;
  sample: Array<{ id: string; name: string; phoneNumber: string; tags: string[] }>;
}

const PRESETS = [
  "Customers likely to churn",
  "Inactive customers from the last 60 days",
  "High-value repeat customers",
  "New leads who haven't been contacted yet",
  "VIPs we haven't spoken to in a month",
];

export default function AiSegmentPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [request, setRequest] = useState("");
  const [result, setResult] = useState<SegmentResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!request.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const data = await api.post<SegmentResult>("/api/v1/ai/segment", {
        request,
        preview: true,
      });
      setResult(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Segment failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">AI Smart Segmentation</h1>
        <p className="text-sm text-slate-500">
          Describe the audience you want in plain English. Claude translates it
          into a filter and previews the matching contacts.
        </p>
      </header>

      <form onSubmit={run} className="rounded-lg border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium text-slate-700">
          Describe your audience
        </label>
        <textarea
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder='e.g. "Salon customers who haven&apos;t booked in 60 days and have the VIP tag"'
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setRequest(p)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={busy || !request.trim()}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Generating…" : "✦ Build segment"}
          </button>
        </div>
      </form>

      {err && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {result && (
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-5 md:col-span-1">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              AI interpretation
            </h2>
            <p className="mt-2 text-sm italic text-slate-700">
              {result.spec.reasoning}
            </p>

            <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Filter spec
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {result.spec.tagsAny && (
                <li>
                  <b>Any of tags:</b> {result.spec.tagsAny.join(", ")}
                </li>
              )}
              {result.spec.tagsAll && (
                <li>
                  <b>All tags:</b> {result.spec.tagsAll.join(", ")}
                </li>
              )}
              {typeof result.spec.optedOut === "boolean" && (
                <li>
                  <b>Opted out:</b> {String(result.spec.optedOut)}
                </li>
              )}
              {typeof result.spec.inactiveSinceDays === "number" && (
                <li>
                  <b>Inactive since:</b> {result.spec.inactiveSinceDays}+ days
                </li>
              )}
              {typeof result.spec.interactedWithinDays === "number" && (
                <li>
                  <b>Interacted within:</b> {result.spec.interactedWithinDays} days
                </li>
              )}
              {typeof result.spec.aiScoreGte === "number" && (
                <li>
                  <b>AI score ≥</b> {result.spec.aiScoreGte}
                </li>
              )}
              {typeof result.spec.aiScoreLte === "number" && (
                <li>
                  <b>AI score ≤</b> {result.spec.aiScoreLte}
                </li>
              )}
              {typeof result.spec.hasEmail === "boolean" && (
                <li>
                  <b>Has email:</b> {String(result.spec.hasEmail)}
                </li>
              )}
            </ul>

            <div className="mt-6 rounded-md bg-slate-900 p-3 text-white">
              <div className="text-xs uppercase tracking-wide text-slate-300">
                Matching contacts
              </div>
              <div className="mt-1 text-3xl font-semibold">{result.count}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 md:col-span-2">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
              Preview ({Math.min(result.sample.length, 25)} of {result.count})
            </h2>
            <div className="divide-y divide-slate-100">
              {result.sample.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.phoneNumber}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {result.sample.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-500">
                  No matching contacts. Try a broader request.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </DashboardShell>
  );
}
