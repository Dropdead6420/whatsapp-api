"use client";

// Partner AI — REAL backend integration.
//
// The previous Gemini version was a high-fidelity LIE: every "AI"
// button ran a setTimeout + dumped hardcoded fake data. It claimed
// "Stable Diffusion & Anthropic Codex API active..." while making
// zero API calls. This rewrite:
//
//   1. Shows real this-month AI spend across the partner's portfolio
//      (GET /api/v1/partner/ai/usage — aggregates AiUsage + AiAgent
//      rows scoped to child tenants).
//   2. Wires the AI Creative Studio card to the real Anthropic-backed
//      POST /api/v1/ai/copy route. That's the one playground that
//      works for a partner: copy generation only needs an LLM, not
//      tenant CRM data, so a white-label partner can demo it.
//   3. Links agent management and reply-suggestion features to where
//      they actually live (/ai-agents, inbox), instead of faking a
//      playground that would 404 against a partner-tenant context.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface UsageSummary {
  monthStart: string;
  totalCostInCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byFeature: Array<{
    feature: string;
    costInCents: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }>;
  byTenant: Array<{
    tenantId: string;
    tenantName: string;
    costInCents: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }>;
  agents: {
    total: number;
    active: number;
    byTenant: Array<{ tenantId: string; tenantName: string; agents: number }>;
  };
}

interface CopyVariant {
  id: string;
  text: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  facebook_ad: "Facebook Ad",
  google_ad: "Google Ad",
  email: "Email",
  sms: "SMS",
  instagram_caption: "Instagram caption",
};

function rupees(cents: number): string {
  return `₹${(cents / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PartnerAiPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  // Portfolio usage rollup
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [usageErr, setUsageErr] = useState<string | null>(null);

  // Creative Studio
  const [prompt, setPrompt] = useState(
    "20% off weekend spa packages — drive last-minute bookings",
  );
  const [channel, setChannel] = useState<keyof typeof CHANNEL_LABEL>("whatsapp");
  const [tone, setTone] = useState<
    "professional" | "friendly" | "casual" | "urgent" | "playful"
  >("friendly");
  const [variantCount, setVariantCount] = useState(3);
  const [variants, setVariants] = useState<CopyVariant[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  async function loadUsage() {
    setUsageBusy(true);
    setUsageErr(null);
    try {
      const data = await api.get<UsageSummary>("/api/v1/partner/ai/usage");
      setUsage(data);
    } catch (e) {
      setUsageErr(
        e instanceof ApiClientError
          ? `Failed to load usage: ${e.message}`
          : "Failed to load usage.",
      );
    } finally {
      setUsageBusy(false);
    }
  }

  useEffect(() => {
    if (user) void loadUsage();
  }, [user]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setGenerating(true);
    setVariants([]);
    setCopyErr(null);
    try {
      const data = await api.post<{ variants: CopyVariant[] }>(
        "/api/v1/ai/copy",
        {
          prompt,
          channel,
          tone,
          variantCount,
        },
      );
      setVariants(data.variants);
    } catch (e) {
      setCopyErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to generate copy.",
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            AI overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Portfolio-wide AI activity across every customer tenant — real
            costs, real token counts, real agent counts. Generate live copy
            below to test the LLM pipeline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage()}
          disabled={usageBusy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {usageBusy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {usageErr && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {usageErr}
        </div>
      )}

      {/* This-month rollup */}
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard
          label="AI spend this month"
          value={usage ? rupees(usage.totalCostInCents) : "—"}
          accent="emerald"
        />
        <StatCard
          label="Total LLM calls"
          value={usage ? usage.totalCalls.toLocaleString() : "—"}
          accent="slate"
        />
        <StatCard
          label="Tokens (in / out)"
          value={
            usage
              ? `${usage.totalInputTokens.toLocaleString()} / ${usage.totalOutputTokens.toLocaleString()}`
              : "—"
          }
          accent="slate"
        />
        <StatCard
          label="Active AI agents"
          value={
            usage
              ? `${usage.agents.active.toLocaleString()} / ${usage.agents.total.toLocaleString()}`
              : "—"
          }
          accent="indigo"
        />
      </section>

      {/* By feature + by tenant */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Spend by feature
          </h2>
          {!usage || usage.byFeature.length === 0 ? (
            <p className="text-xs text-slate-500">
              No AI usage yet this month.
            </p>
          ) : (
            <ul className="space-y-2">
              {usage.byFeature.map((row) => (
                <li
                  key={row.feature}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="font-medium text-slate-700">
                    {row.feature}
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {rupees(row.costInCents)} · {row.calls.toLocaleString()}{" "}
                    calls
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Spend by tenant
          </h2>
          {!usage || usage.byTenant.length === 0 ? (
            <p className="text-xs text-slate-500">
              No customer tenants are using AI yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {usage.byTenant.slice(0, 8).map((row) => (
                <li
                  key={row.tenantId}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="truncate font-medium text-slate-700">
                    {row.tenantName}
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {rupees(row.costInCents)} · {row.calls.toLocaleString()}{" "}
                    calls
                  </span>
                </li>
              ))}
              {usage.byTenant.length > 8 && (
                <li className="text-[10px] text-slate-400">
                  +{usage.byTenant.length - 8} more tenants
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {/* Agents per tenant */}
      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            AI agents per tenant
          </h2>
          <Link
            href="/ai-agents"
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            Manage agents →
          </Link>
        </div>
        {!usage || usage.agents.byTenant.length === 0 ? (
          <p className="text-xs text-slate-500">
            No AI agents have been created across your portfolio yet.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {usage.agents.byTenant.map((row) => (
              <li
                key={row.tenantId}
                className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="truncate font-medium text-slate-700">
                  {row.tenantName}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  {row.agents} agent{row.agents === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Live AI Creative Studio (REAL endpoint) */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          AI Creative Studio
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Live LLM call — generates {variantCount} copy variants for the chosen
          channel and tone. Billed to your tenant under the{" "}
          <span className="font-mono">copywriting</span> feature; charges show
          up in this month&apos;s rollup above.
        </p>

        <form onSubmit={handleGenerate} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Campaign goal / briefing
            <textarea
              required
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. 20% off weekend spa packages — drive last-minute bookings"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              maxLength={2000}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs font-semibold text-slate-700">
              Channel
              <select
                value={channel}
                onChange={(e) =>
                  setChannel(e.target.value as keyof typeof CHANNEL_LABEL)
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {Object.entries(CHANNEL_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Tone
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as typeof tone)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="casual">Casual</option>
                <option value="urgent">Urgent</option>
                <option value="playful">Playful</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Variants
              <select
                value={variantCount}
                onChange={(e) => setVariantCount(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={generating}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate variants"}
          </button>
        </form>

        {copyErr && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {copyErr}
          </div>
        )}

        {variants.length > 0 && (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {variants.map((v, idx) => (
              <article
                key={v.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wide text-emerald-700">
                    Variant {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(v.text);
                    }}
                    className="text-[10px] font-medium text-slate-500 hover:text-slate-800"
                  >
                    Copy
                  </button>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed text-slate-800">
                  {v.text}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Tip:</strong> Customer-specific AI playgrounds — reply
        suggestions, campaign autopilot, lead scoring — operate on a tenant&apos;s
        own conversation history and CRM data, so they live inside each
        customer&apos;s dashboard. From this portal you see the aggregate
        spend and can manage shared{" "}
        <Link
          href="/ai-agents"
          className="font-medium text-emerald-700 hover:text-emerald-800"
        >
          AI agents
        </Link>
        .
      </div>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "slate" | "emerald" | "indigo";
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    indigo: "border-indigo-200 bg-indigo-50",
  } as const;
  const numColor = {
    slate: "text-slate-900",
    emerald: "text-emerald-800",
    indigo: "text-indigo-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${accents[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-xl font-semibold ${numColor[accent]}`}
      >
        {value}
      </div>
    </div>
  );
}
