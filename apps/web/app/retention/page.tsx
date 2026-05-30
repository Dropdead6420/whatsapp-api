"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type RetentionTier = "ACTIVE" | "COOLING" | "DORMANT" | "LOST";

interface RetentionFactor {
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

interface RetentionRow {
  contactId: string;
  name: string;
  phoneNumber: string;
  tier: RetentionTier;
  score: number;
  daysSinceInteraction: number;
  optedOut: boolean;
  lifecycleStage: string;
  recommendation: string;
  assessedAt: string;
  factors: Record<"recency" | "lifecycle" | "intent", RetentionFactor>;
}

interface RetentionSummary {
  tenantId: string;
  generatedAt: string;
  totals: Record<RetentionTier, number>;
  totalScored: number;
  rows: RetentionRow[];
}

type RetentionMode = "MANUAL" | "ASSISTED" | "AUTOPILOT";

interface RetentionConfig {
  mode: RetentionMode;
  winbackSequenceId: string | null;
  maxEnrollPerRun: number;
  lastRunAt: string | null;
  lastEnrolledCount: number;
}

interface DripSeqLite {
  id: string;
  name: string;
  status: string;
}

interface AutopilotResult {
  mode: RetentionMode;
  winbackSequenceId: string | null;
  candidates: number;
  enrolled: number;
  skipped: number;
  reason?: string;
}

const MODE_HELP: Record<RetentionMode, string> = {
  MANUAL: "Score and recommend only. No contacts are enrolled.",
  ASSISTED: "Surface win-back candidates for your approval. No auto-enroll.",
  AUTOPILOT: "Auto-enroll dormant contacts into the win-back sequence each scan.",
};

const TIERS: RetentionTier[] = ["LOST", "DORMANT", "COOLING", "ACTIVE"];

const TIER_META: Record<
  RetentionTier,
  { label: string; tone: string; bar: string; description: string }
> = {
  ACTIVE: {
    label: "Active",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    bar: "bg-emerald-500",
    description: "Engaged recently",
  },
  COOLING: {
    label: "Cooling",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    bar: "bg-amber-500",
    description: "Needs a gentle nudge",
  },
  DORMANT: {
    label: "Dormant",
    tone: "border-orange-200 bg-orange-50 text-orange-800",
    bar: "bg-orange-500",
    description: "Win-back candidate",
  },
  LOST: {
    label: "Lost",
    tone: "border-rose-200 bg-rose-50 text-rose-800",
    bar: "bg-rose-500",
    description: "Suppress or reactivate carefully",
  },
};

export default function RetentionPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [tier, setTier] = useState<RetentionTier | "ALL">("ALL");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [config, setConfig] = useState<RetentionConfig | null>(null);
  const [sequences, setSequences] = useState<DripSeqLite[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [runResult, setRunResult] = useState<AutopilotResult | null>(null);
  const [running, setRunning] = useState(false);

  const load = async (refresh = false) => {
    setBusy(!refresh);
    setRefreshing(refresh);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (refresh) params.set("refresh", "true");
      if (tier !== "ALL") params.set("tier", tier);
      const data = await api.get<RetentionSummary>(`/api/v1/retention?${params}`);
      setSummary(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load retention data");
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) void load(false);
  }, [user, tier]);

  useEffect(() => {
    if (!user) return;
    api
      .get<RetentionConfig>("/api/v1/retention/config")
      .then(setConfig)
      .catch(() => setConfig(null));
    api
      .get<DripSeqLite[]>("/api/v1/drip-sequences")
      .then((rows) => setSequences(rows ?? []))
      .catch(() => setSequences([]));
  }, [user]);

  const saveConfig = async (patch: Partial<RetentionConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setSavingConfig(true);
    setErr(null);
    try {
      const saved = await api.put<RetentionConfig>("/api/v1/retention/config", {
        mode: next.mode,
        winbackSequenceId: next.winbackSequenceId,
        maxEnrollPerRun: next.maxEnrollPerRun,
      });
      setConfig(saved);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to save autopilot config");
    } finally {
      setSavingConfig(false);
    }
  };

  const runAutopilot = async (dryRun: boolean) => {
    setRunning(true);
    setErr(null);
    setRunResult(null);
    try {
      const result = await api.post<AutopilotResult>(
        "/api/v1/retention/autopilot/run",
        { dryRun },
      );
      setRunResult(result);
      if (!dryRun && result.enrolled > 0) void load(false);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to run autopilot");
    } finally {
      setRunning(false);
    }
  };

  const activeSequences = useMemo(
    () => sequences.filter((s) => s.status === "ACTIVE"),
    [sequences],
  );

  const riskCount = useMemo(() => {
    if (!summary) return 0;
    return summary.totals.LOST + summary.totals.DORMANT + summary.totals.COOLING;
  }, [summary]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            AI Retention Engine
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Contact retention radar
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Score contacts by engagement decay, lifecycle stage, opt-out state, and AI intent. Focus on cooling and dormant contacts before they churn.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as RetentionTier | "ALL")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="ALL">All tiers</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_META[t].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh scores"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {TIERS.map((t) => (
          <TierCard
            key={t}
            tier={t}
            count={summary?.totals[t] ?? 0}
            total={summary?.totalScored ?? 0}
          />
        ))}
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Next best retention queue
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {riskCount.toLocaleString()} contact{riskCount === 1 ? "" : "s"} need action. Scores are sorted worst-first.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Last scan: {summary ? new Date(summary.generatedAt).toLocaleString() : "not run"}
          </div>
        </div>
      </section>

      {config && (
        <section className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/40 p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="max-w-2xl">
              <h2 className="text-base font-semibold text-slate-950">
                Win-back autopilot
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {MODE_HELP[config.mode]}
              </p>
              {config.lastRunAt && (
                <p className="mt-2 text-xs text-slate-500">
                  Last run {new Date(config.lastRunAt).toLocaleString()} ·{" "}
                  {config.lastEnrolledCount} enrolled
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runAutopilot(true)}
                disabled={running || savingConfig}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Preview candidates
              </button>
              <button
                type="button"
                onClick={() => void runAutopilot(false)}
                disabled={
                  running ||
                  savingConfig ||
                  config.mode !== "AUTOPILOT" ||
                  !config.winbackSequenceId
                }
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                title={
                  config.mode !== "AUTOPILOT"
                    ? "Switch to Autopilot mode to enroll"
                    : !config.winbackSequenceId
                      ? "Choose a win-back sequence first"
                      : undefined
                }
              >
                {running ? "Running..." : "Run autopilot now"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Mode</span>
              <select
                value={config.mode}
                onChange={(e) => void saveConfig({ mode: e.target.value as RetentionMode })}
                disabled={savingConfig}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
              >
                <option value="MANUAL">Manual</option>
                <option value="ASSISTED">Assisted</option>
                <option value="AUTOPILOT">Autopilot</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Win-back sequence
              </span>
              <select
                value={config.winbackSequenceId ?? ""}
                onChange={(e) =>
                  void saveConfig({ winbackSequenceId: e.target.value || null })
                }
                disabled={savingConfig}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
              >
                <option value="">— none —</option>
                {activeSequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {activeSequences.length === 0 && (
                <span className="mt-1 block text-xs text-amber-700">
                  No ACTIVE drip sequences. Create one to enable autopilot.
                </span>
              )}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Max enroll per run
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={config.maxEnrollPerRun}
                onChange={(e) =>
                  setConfig((c) =>
                    c ? { ...c, maxEnrollPerRun: Number(e.target.value) } : c,
                  )
                }
                onBlur={(e) =>
                  void saveConfig({
                    maxEnrollPerRun: Math.max(1, Math.min(500, Number(e.target.value) || 50)),
                  })
                }
                disabled={savingConfig}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
              />
            </label>
          </div>

          {runResult && (
            <div className="mt-4 rounded-md border border-indigo-200 bg-white px-4 py-3 text-sm text-slate-700">
              <span className="font-medium">{runResult.candidates}</span> candidate
              {runResult.candidates === 1 ? "" : "s"}
              {runResult.enrolled > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-emerald-700">
                    {runResult.enrolled} enrolled
                  </span>
                </>
              )}
              {runResult.skipped > 0 && <> · {runResult.skipped} skipped</>}
              {runResult.reason && (
                <span className="ml-1 text-slate-500">— {runResult.reason}</span>
              )}
            </div>
          )}
        </section>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Signals</th>
              <th className="px-4 py-3">Recommendation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary?.rows.map((row) => (
              <tr key={row.contactId} className="align-top hover:bg-slate-50/70">
                <td className="px-4 py-4">
                  <div className="font-medium text-slate-950">{row.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.phoneNumber}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    {row.lifecycleStage.replaceAll("_", " ")}
                    {row.optedOut ? " · opted out" : ""}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <TierBadge tier={row.tier} />
                  <div className="mt-2 text-xs text-slate-500">
                    {row.daysSinceInteraction}d quiet
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="text-lg font-semibold text-slate-950">{row.score}</div>
                  <div className="mt-2 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${TIER_META[row.tier].bar}`}
                      style={{ width: `${row.score}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="space-y-1 text-xs text-slate-500">
                    <div>{row.factors.recency.detail}</div>
                    <div>{row.factors.lifecycle.detail}</div>
                    <div>{row.factors.intent.detail}</div>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm leading-6 text-slate-600">
                  {row.recommendation}
                </td>
              </tr>
            ))}
            {!busy && summary?.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  No contacts found for this filter.
                </td>
              </tr>
            )}
            {busy && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  Loading retention scores...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}

function TierCard({
  tier,
  count,
  total,
}: {
  tier: RetentionTier;
  count: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <TierBadge tier={tier} />
        <span className="text-xs text-slate-500">{percent}%</span>
      </div>
      <div className="mt-4 text-3xl font-semibold text-slate-950">
        {count.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {TIER_META[tier].description}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: RetentionTier }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${TIER_META[tier].tone}`}
    >
      {TIER_META[tier].label}
    </span>
  );
}
