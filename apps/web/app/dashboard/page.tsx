"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api } from "../../src/lib/api";
import Link from "next/link";

interface DashboardSummary {
  scope: "platform" | "tenant";
  totals: {
    tenants?: number;
    activeTenants?: number;
    contacts?: number;
    campaigns?: number;
    conversations?: number;
    activeConversations?: number;
    leads?: number;
    messagesToday?: number;
    messagesMonth?: number;
    sentMessages?: number;
    deliveredMessages?: number;
    readMessages?: number;
    aiCostInCentsThisMonth?: number;
    mrrInPaisa?: number;
  };
  sendQuota?: {
    monthlyUsed: number;
    monthlyQuota: number;
    perSecondLimit: number;
    percentUsed: number;
  };
}

export default function DashboardPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<DashboardSummary>("/api/v1/analytics/summary")
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-10 animate-fade-in">
        <span className="inline-flex rounded-full bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-3">
          Executive Control Room
        </span>
        <h1 className="text-3xl font-extrabold tracking-wide text-white">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1.5 text-xs font-medium text-slate-500 tracking-wide">
          {user.role === "SUPER_ADMIN"
            ? "Real-time health telemetry across all tenant instances."
            : "Today's campaign snapshot, delivery statuses, and response metrics."}
        </p>
      </header>

      {user.role === "SUPER_ADMIN" && <SuperAdminCards summary={summary} />}
      {(user.role === "BUSINESS_ADMIN" || user.role === "TEAM_LEAD") && (
        <BusinessCards summary={summary} />
      )}
      {user.role === "AGENT" && (
        <p className="text-sm font-semibold text-slate-400 tracking-wide animate-slide-up">
          Open your{" "}
          <Link className="text-emerald-400 hover:text-emerald-300 font-extrabold underline tracking-wide transition-all" href="/inbox">
            Inbox
          </Link>{" "}
          to start responding to clients.
        </p>
      )}
    </DashboardShell>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl glass-card-dark-hover relative overflow-hidden animate-slide-up">
      <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-30 pointer-events-none filter blur-xl" />
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-3.5 text-3xl font-black text-white text-glow-emerald">{value}</div>
      {hint && <div className="mt-2 text-xs font-medium text-slate-500 tracking-wide">{hint}</div>}
    </div>
  );
}

function formatCurrencyFromPaisa(value?: number) {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function SuperAdminCards({ summary }: { summary: DashboardSummary | null }) {
  const totals = summary?.totals;
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <StatCard
        label="Tenants"
        value={totals?.tenants?.toString() ?? "—"}
        hint={`${totals?.activeTenants ?? "—"} active`}
      />
      <StatCard
        label="Messages today"
        value={totals?.messagesToday?.toString() ?? "—"}
        hint={`${totals?.messagesMonth ?? "—"} this month`}
      />
      <StatCard
        label="MRR"
        value={formatCurrencyFromPaisa(totals?.mrrInPaisa)}
        hint="From active subscriptions"
      />
    </div>
  );
}

function BusinessCards({ summary }: { summary: DashboardSummary | null }) {
  const totals = summary?.totals;
  const quota = summary?.sendQuota;
  return (
    <>
      <div className="grid gap-6 md:grid-cols-3">
        <StatCard label="Contacts" value={totals?.contacts?.toString() ?? "—"} />
        <StatCard
          label="Campaigns"
          value={totals?.campaigns?.toString() ?? "—"}
          hint={`${totals?.messagesMonth ?? "—"} messages this month`}
        />
        <StatCard
          label="Open conversations"
          value={totals?.activeConversations?.toString() ?? "—"}
          hint={`${totals?.leads ?? "—"} leads in pipeline`}
        />
      </div>

      {quota && (
        <section className="mt-8 rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden glass-card-dark-hover animate-slide-up">
          <div className="absolute top-0 right-0 h-32 w-32 bg-radial-glow opacity-25 pointer-events-none filter blur-2xl" />
          <div className="flex items-center justify-between text-xs">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                WhatsApp Send Quota
              </div>
              <div className="mt-2 font-bold text-white text-sm">
                <span className="text-lg font-black text-emerald-400">{quota.monthlyUsed.toLocaleString()}</span>
                <span className="mx-1.5 text-slate-500 font-medium">/</span>
                <span className="text-slate-300">{quota.monthlyQuota.toLocaleString()}</span>
                <span className="ml-2 text-slate-500 font-medium">sent this month</span>
              </div>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest border ${
                quota.percentUsed >= 90
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : quota.percentUsed >= 70
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              }`}
            >
              {quota.percentUsed}% used
            </div>
          </div>
          <div className="mt-4.5 h-2 overflow-hidden rounded-full bg-slate-950/80 border border-white/5">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                quota.percentUsed >= 90
                  ? "bg-gradient-to-r from-red-600 to-red-400"
                  : quota.percentUsed >= 70
                    ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                    : "bg-gradient-to-r from-emerald-500 to-teal-400"
              }`}
              style={{ width: `${Math.min(100, quota.percentUsed)}%` }}
            />
          </div>
          <p className="mt-3 text-[10px] font-medium text-slate-500 tracking-wide">
            Per-second queue smoothing capped at <strong className="text-slate-300 font-semibold">{quota.perSecondLimit} messages/sec</strong> to protect your Meta sender reputation score.
          </p>
        </section>
      )}
    </>
  );
}
