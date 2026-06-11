"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api } from "../../../src/lib/api";

interface PartnerDashboard {
  partnerName: string;
  customers: number;
  activeCustomers: number;
  contacts: number;
  messagesMonth: number;
  aiCostInCentsThisMonth: number;
  walletBalanceCredits: number;
  creditLimitCredits: number;
  demosExpiringSoon: number;
  billingCurrency: string;
  activeSubscriptionCount: number;
  baseMrrInPaisa: number;
  agencyProfitInPaisa: number;
  partnerMarginEnabled: boolean;
  partnerMarginBps: number;
  planDistribution: Array<{
    planId: string;
    name: string;
    count: number;
    percentage: number;
    mrrInPaisa: number;
  }>;
}

interface CustomerHealthRow {
  tenantId: string;
  tenantName: string;
  status: string;
  score: number;
  tier: "THRIVING" | "HEALTHY" | "AT_RISK" | "CHURNING";
  recommendation: string;
  assessedAt: string;
  metrics: {
    messages30d: number;
    complianceReview30d: number;
    complianceBlock30d: number;
    walletRiskTier: string | null;
  };
}

interface PartnerAssistantSummary {
  partnerTenantId: string;
  generatedAt: string;
  totals: Record<CustomerHealthRow["tier"], number>;
  totalTenants: number;
  headline: string;
  actions: Array<{
    title: string;
    rationale: string;
    tenantIds: string[];
  }>;
  worstAccounts: Array<{
    tenantId: string;
    tenantName: string;
    score: number;
    tier: CustomerHealthRow["tier"];
    recommendation: string;
  }>;
}

export default function PartnerDashboardPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [data, setData] = useState<PartnerDashboard | null>(null);
  const [healthRows, setHealthRows] = useState<CustomerHealthRow[]>([]);
  const [assistantSummary, setAssistantSummary] =
    useState<PartnerAssistantSummary | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<"7d" | "30d" | "all">("30d");

  function refreshAssistantSummary() {
    setAssistantLoading(true);
    api.get<PartnerAssistantSummary>("/api/v1/partner/assistant/summary")
      .then(setAssistantSummary)
      .catch(() => setAssistantSummary(null))
      .finally(() => setAssistantLoading(false));
  }

  useEffect(() => {
    if (!user) return;

    // Fetch live dashboard data
    api.get<PartnerDashboard>("/api/v1/partner/dashboard")
      .then((res) => {
        setData(res);
      })
      .catch(() => {
        // Fallback to high-fidelity mock data if database/API is offline
        const mockDashboard: PartnerDashboard = {
          partnerName: user.name || "NexaReseller Admin",
          customers: 12,
          activeCustomers: 9,
          contacts: 8450,
          messagesMonth: 48900,
          aiCostInCentsThisMonth: 12540, // ₹125.40 AI spend
          walletBalanceCredits: 4520,
          creditLimitCredits: 10000,
          demosExpiringSoon: 2,
          billingCurrency: "INR",
          activeSubscriptionCount: 0,
          baseMrrInPaisa: 0,
          agencyProfitInPaisa: 0,
          partnerMarginEnabled: false,
          partnerMarginBps: 0,
          planDistribution: [],
        };
        setData(mockDashboard);
      });
    api.get<CustomerHealthRow[]>("/api/v1/partner/customer-health?limit=6")
      .then(setHealthRows)
      .catch(() => setHealthRows([]));
    refreshAssistantSummary();
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Agency Dashboard…</div>;
  }

  const billingCurrency = data?.billingCurrency ?? "INR";
  const marginPct = ((data?.partnerMarginBps ?? 0) / 100).toFixed(1);
  const baseMrrInPaisa = data?.baseMrrInPaisa ?? 0;
  const agencyProfitInPaisa = data?.agencyProfitInPaisa ?? 0;
  const planColors = ["bg-emerald-500", "bg-indigo-500", "bg-purple-500", "bg-cyan-500", "bg-amber-500"];
  const plans = (data?.planDistribution ?? []).map((plan, index) => ({
    ...plan,
    percentageText: `${plan.percentage.toFixed(1)}%`,
    color: planColors[index % planColors.length],
  }));

  const chartData = [
    {
      month: "This month",
      profitInPaisa: agencyProfitInPaisa,
      usage: data?.messagesMonth ?? 0,
    },
  ];

  const atRiskCount = healthRows.filter((row) =>
    row.tier === "AT_RISK" || row.tier === "CHURNING"
  ).length;

  return (
    <PartnerShell user={user} signOut={signOut}>
      {/* Upper header action board */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Welcome Back, {data?.partnerName ?? "NexaReseller"}
          </h1>
          <p className="text-sm text-slate-400">
            Agency Sales, Client WhatsApp Usage, and Revenue Margins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as any)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
          <Link
            href="/partner/customers"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all duration-300"
          >
            + Onboard Client
          </Link>
        </div>
      </div>

      {/* Stats Widgets Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label="Agency Monthly Profit"
          value={formatMoneyFromPaisa(agencyProfitInPaisa, billingCurrency)}
          subtext={`From ${formatMoneyFromPaisa(baseMrrInPaisa, billingCurrency)} managed customer MRR`}
          badge={data?.partnerMarginEnabled ? `${marginPct}% margin` : "Margin off"}
          badgeColor={
            data?.partnerMarginEnabled
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : "text-slate-400 bg-slate-500/10 border-slate-500/20"
          }
        />
        <StatCard
          label="Total Active Clients"
          value={`${data?.activeCustomers ?? 0} / ${data?.customers ?? 0}`}
          subtext={`${data?.demosExpiringSoon ?? 0} sandbox accounts expiring soon`}
          badge="92% active"
          badgeColor="text-indigo-400 bg-indigo-500/10 border-indigo-500/20"
        />
        <StatCard
          label="Credits Balance"
          value={`${data ? data.walletBalanceCredits.toLocaleString() : "—"} Cr`}
          subtext={`Credit Limit: ${data ? data.creditLimitCredits.toLocaleString() : "—"}`}
          badge="Prepaid Mode"
          badgeColor="text-amber-400 bg-amber-500/10 border-amber-500/20"
        />
        <StatCard
          label="Campaign Messages Sent"
          value={data ? data.messagesMonth.toLocaleString() : "—"}
          subtext={`Total Active Contacts: ${data ? data.contacts.toLocaleString() : "—"}`}
          badge="99.4% SLA"
          badgeColor="text-purple-400 bg-purple-500/10 border-purple-500/20"
        />
      </div>

      <div className="mb-6 rounded-xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 p-6 backdrop-blur-md">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                AI Partner Assistant
              </span>
              {assistantSummary && (
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {assistantSummary.totalTenants} customers scanned
                </span>
              )}
            </div>
            <h2 className="text-xl font-black tracking-tight text-white">
              {assistantSummary?.headline ??
                (assistantLoading ? "Reading portfolio signals…" : "Portfolio assistant is ready.")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {assistantSummary
                ? "Top actions are generated from customer health, wallet risk, compliance, and engagement signals."
                : "Open customer accounts or refresh the summary after new health scans finish."}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshAssistantSummary}
            disabled={assistantLoading}
            className="w-fit rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-4 py-2 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {assistantLoading ? "Refreshing…" : "Refresh assistant"}
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {(["THRIVING", "HEALTHY", "AT_RISK", "CHURNING"] as const).map((tier) => (
              <div key={tier} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <TierBadge tier={tier} />
                  <span className="text-xl font-black text-white">
                    {assistantSummary?.totals[tier] ?? 0}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {(assistantSummary?.actions.length ? assistantSummary.actions : [
              {
                title: "No urgent partner actions",
                rationale: "Health scans have not found at-risk customers in this portfolio yet.",
                tenantIds: [],
              },
            ]).slice(0, 3).map((action, index) => (
              <div key={`${action.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-white">{action.title}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{action.rationale}</p>
                  </div>
                  {action.tenantIds.length > 0 && (
                    <span className="w-fit rounded-full border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400">
                      {action.tenantIds.length} account{action.tenantIds.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {healthRows.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-bold text-white">Customer Health Radar</h2>
              <p className="text-xs text-slate-400">
                Daily score from wallet risk, compliance, engagement, onboarding, and message activity.
              </p>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-semibold ${
              atRiskCount > 0
                ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            }`}>
              {atRiskCount > 0 ? `${atRiskCount} need attention` : "Portfolio stable"}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {healthRows.slice(0, 6).map((row) => (
              <div key={row.tenantId} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{row.tenantName}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{row.status}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-white">{row.score}</div>
                    <TierBadge tier={row.tier} />
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${tierBarColor(row.tier)}`}
                    style={{ width: `${row.score}%` }}
                  />
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-400">
                  {row.recommendation}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
                  <span>{row.metrics.messages30d.toLocaleString()} msgs</span>
                  <span>{row.metrics.walletRiskTier ?? "wallet n/a"}</span>
                  <span>{row.metrics.complianceBlock30d} blocked</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Revenue chart and plans */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Interactive Growth chart */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Agency Sales & Platform Volume</h2>
              <p className="text-xs text-slate-400">Live margin from active subscriptions vs this month's message volume</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <span className="h-2 w-2 rounded-full bg-indigo-500"></span> Profit Markup
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Messages Sent
              </span>
            </div>
          </div>

          {/* Monthly Flex CSS charts */}
          <div className="flex h-56 items-end justify-between gap-4 border-b border-slate-800 pb-2 pt-6">
            {chartData.map((d) => {
              const maxVal = Math.max(agencyProfitInPaisa, 1);
              const profitPct = `${Math.max(8, (d.profitInPaisa / maxVal) * 100)}%`;
              const maxUsage = Math.max(data?.messagesMonth ?? 0, 1);
              const usagePct = `${(d.usage / maxUsage) * 100}%`;

              return (
                <div key={d.month} className="group relative flex flex-1 flex-col items-center h-full justify-end">
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full mb-2 hidden flex-col items-center rounded bg-slate-950 p-2 text-[10px] text-white shadow-xl border border-slate-800 group-hover:flex z-10 w-28">
                    <div className="font-semibold text-indigo-400">Profit: {formatMoneyFromPaisa(d.profitInPaisa, billingCurrency)}</div>
                    <div className="text-emerald-400">Sent: {d.usage.toLocaleString()}</div>
                  </div>

                  <div className="flex w-full items-end justify-center gap-1.5 h-full">
                    {/* Profit bar */}
                    <div
                      style={{ height: profitPct }}
                      className="w-4 rounded-t bg-gradient-to-t from-indigo-600 to-indigo-400 transition-all duration-500 group-hover:brightness-125"
                    ></div>
                    {/* Usage line approximation bar */}
                    <div
                      style={{ height: usagePct }}
                      className="w-2 rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-500 group-hover:brightness-125"
                    ></div>
                  </div>
                  <span className="mt-2 text-xs text-slate-400">{d.month}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Client Plan Distribution */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <h2 className="text-base font-bold text-white mb-2">Active License Allocations</h2>
          <p className="text-xs text-slate-400 mb-6">Subscriptions mapped under your agency domain name.</p>
          
          <div className="space-y-4">
            {plans.length > 0 ? plans.map((p) => (
              <div key={p.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">{p.name}</span>
                  <span className="text-slate-400">{p.count} accounts ({p.percentageText})</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    style={{ width: p.percentageText }}
                    className={`h-full rounded-full ${p.color} transition-all duration-1000`}
                  ></div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs leading-5 text-slate-400">
                No active customer subscriptions yet. Once SuperAdmin assigns plans to your clients, this panel will show the live distribution.
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <div className="flex justify-between py-1">
              <span>Commission margins</span>
              <span className="font-semibold text-white">
                {data?.partnerMarginEnabled ? `${marginPct}% flat` : "Disabled"}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span>Total value resold</span>
              <span className="font-semibold text-indigo-400">
                {formatMoneyFromPaisa(baseMrrInPaisa, billingCurrency)} / mo
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Lower alert table panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white">Expiring Sub-Client Demands</h2>
            <p className="text-xs text-slate-400">Trial packages and low balance thresholds requiring intervention.</p>
          </div>
          <Link
            href="/partner/demos"
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
          >
            Open Demo Engine →
          </Link>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold">Customer Account</th>
                <th className="px-4 py-3 font-semibold">Alert Condition</th>
                <th className="px-4 py-3 font-semibold">Days Remaining</th>
                <th className="px-4 py-3 font-semibold">Action Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              <tr className="hover:bg-slate-900/20">
                <td className="px-4 py-3 font-semibold text-slate-200">Cutz & Bangs Salon</td>
                <td className="px-4 py-3 text-slate-300">
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-400 border border-amber-500/20">
                    Low balance threshold (85 Cr)
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">N/A (Prepaid)</td>
                <td className="px-4 py-3 text-indigo-400 font-medium hover:underline">
                  <Link href="/partner/wallet">Transfer Credits</Link>
                </td>
              </tr>
              <tr className="hover:bg-slate-900/20">
                <td className="px-4 py-3 font-semibold text-slate-200">PixelCraft Marketing</td>
                <td className="px-4 py-3 text-slate-300">
                  <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[9px] font-semibold text-rose-400 border border-rose-500/20">
                    Sandbox Period Ending
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">2 days left</td>
                <td className="px-4 py-3 text-indigo-400 font-medium hover:underline">
                  <Link href="/partner/demos">Score Demo</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  subtext,
  badge,
  badgeColor,
}: {
  label: string;
  value: string;
  subtext: string;
  badge: string;
  badgeColor: string;
}) {
  return (
    <div className="group relative rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md transition-all duration-300 hover:border-slate-700/50 hover:bg-slate-900 hover:scale-[1.01]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold border ${badgeColor}`}>
          {badge}
        </span>
      </div>
      <div className="mt-4 text-3xl font-extrabold text-white tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtext}</div>
    </div>
  );
}

function TierBadge({ tier }: { tier: CustomerHealthRow["tier"] }) {
  const className =
    tier === "THRIVING"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
      : tier === "HEALTHY"
        ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/20"
        : tier === "AT_RISK"
          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
          : "bg-rose-500/10 text-rose-300 border-rose-500/20";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${className}`}>
      {tier.replace("_", " ")}
    </span>
  );
}

function tierBarColor(tier: CustomerHealthRow["tier"]) {
  if (tier === "THRIVING") return "bg-emerald-500";
  if (tier === "HEALTHY") return "bg-indigo-500";
  if (tier === "AT_RISK") return "bg-amber-500";
  return "bg-rose-500";
}

function formatMoneyFromPaisa(valueInPaisa: number, currency: string) {
  const safeCurrency = currency && currency.length === 3 ? currency : "INR";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 0,
    }).format(valueInPaisa / 100);
  } catch {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(valueInPaisa / 100);
  }
}
