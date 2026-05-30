"use client";

// Wallet Risk dashboard (PRD-v2 §8, Sprint 2 — slice 1 UI).
//
// Shows the latest WalletRiskAssessment for the current tenant: tier pill,
// the deterministic math the worker computed, and (when present) the LLM's
// recommended action + reasoning. A Refresh button forces a fresh
// assessment now rather than waiting for the 6-hour scheduled scan.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Tier = "OK" | "WATCH" | "URGENT" | "CRITICAL";
type Action =
  | "NONE"
  | "RECHARGE"
  | "ENABLE_AUTO_RECHARGE"
  | "THROTTLE_CAMPAIGNS"
  | "SWITCH_TO_POSTPAID"
  | "UPGRADE_PLAN";

interface Assessment {
  id: string;
  dayKey: string;
  assessedAt: string;
  balanceCredits: number;
  lowBalanceThreshold: number;
  dailyBurnAvg: number;
  dailyBurnP90: number;
  daysToLowBalance: number | null;
  daysToZero: number | null;
  riskTier: Tier;
  recommendedActionCode: Action;
  recommendedAmountCredits: number | null;
  reasoning: string | null;
  llmUsed: boolean;
}

const TIER_COLOR: Record<Tier, string> = {
  OK: "bg-emerald-100 text-emerald-800 border-emerald-200",
  WATCH: "bg-amber-100 text-amber-800 border-amber-200",
  URGENT: "bg-orange-100 text-orange-800 border-orange-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
};

const ACTION_LABEL: Record<Action, string> = {
  NONE: "No action needed",
  RECHARGE: "Top up the wallet",
  ENABLE_AUTO_RECHARGE: "Enable auto-recharge",
  THROTTLE_CAMPAIGNS: "Slow down active campaigns",
  SWITCH_TO_POSTPAID: "Move to postpaid billing",
  UPGRADE_PLAN: "Upgrade the plan",
};

function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1) return "< 1 day";
  return `${n.toFixed(1)} days`;
}

export default function WalletRiskPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<Assessment | null>("/api/v1/wallet-risk");
      setAssessment(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load assessment: ${e.message}`
          : "Failed to load assessment.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function handleRefresh() {
    setRefreshing(true);
    setErr(null);
    try {
      const data = await api.post<Assessment>("/api/v1/wallet-risk/refresh");
      setAssessment(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to refresh assessment.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Wallet Risk
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            14-day burn-rate analysis with an AI-recommended action when the
            tier is anything other than OK. The scheduled scan runs every 6
            hours; click <em>Refresh</em> to run one now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing || busy}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {refreshing ? "Assessing…" : "Refresh now"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {!busy && !assessment && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No assessment yet. Click <em>Refresh now</em> to run one, or wait
          for the next scheduled scan.
        </div>
      )}

      {assessment && (
        <section className="space-y-4">
          {/* Tier banner */}
          <div
            className={`rounded-lg border p-4 ${TIER_COLOR[assessment.riskTier]}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide">
                  Current risk tier
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {assessment.riskTier}
                </div>
              </div>
              <div className="text-right text-[11px]">
                Assessed{" "}
                {new Date(assessment.assessedAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {assessment.llmUsed ? " · AI narrative" : " · math only"}
              </div>
            </div>
            {assessment.reasoning && (
              <p className="mt-3 text-sm leading-relaxed">
                {assessment.reasoning}
              </p>
            )}
            {assessment.recommendedActionCode !== "NONE" && (
              <div className="mt-4 rounded-md bg-white/70 px-3 py-2 text-sm">
                <span className="font-semibold">Recommended action:</span>{" "}
                {ACTION_LABEL[assessment.recommendedActionCode]}
                {assessment.recommendedAmountCredits != null && (
                  <span className="ml-2 font-mono text-xs">
                    ≈ {fmtNumber(assessment.recommendedAmountCredits)} credits
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Math snapshot */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Balance"
              value={`${fmtNumber(assessment.balanceCredits)} credits`}
              hint={`low-balance threshold ${fmtNumber(assessment.lowBalanceThreshold)}`}
            />
            <StatCard
              label="Daily burn (14d avg)"
              value={`${fmtNumber(assessment.dailyBurnAvg, 1)} credits/day`}
              hint={`p90 ${fmtNumber(assessment.dailyBurnP90, 1)}/day`}
            />
            <StatCard
              label="Runway"
              value={fmtDays(assessment.daysToZero)}
              hint={`to low-balance: ${fmtDays(assessment.daysToLowBalance)}`}
            />
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            <strong>How tiers are picked.</strong> CRITICAL when balance ≤
            threshold OR runway ≤ 3 days. URGENT when runway ≤ 7 days. WATCH
            when runway ≤ 30 days. OK otherwise. A zero-burn tenant stays OK
            regardless of balance.
          </div>
        </section>
      )}
    </DashboardShell>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}
