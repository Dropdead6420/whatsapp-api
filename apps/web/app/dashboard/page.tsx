"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api } from "../../src/lib/api";
import { useI18n } from "../../src/i18n/I18nProvider";
import {
  billingIntentHref,
  readBillingIntentFromWindow,
  type BillingIntent,
} from "../../src/lib/billingIntent";

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
    monthlyQuota: number | null;
    monthlySafetyCapEnabled: boolean;
    perSecondLimit: number;
    percentUsed: number | null;
  };
  planQuotas?: {
    contacts: { used: number; limit: number };
    campaigns: { used: number; limit: number };
    agentSeats: { used: number; limit: number };
    aiCreditsPerMonth: number;
  } | null;
}

interface WalletAlert {
  balanceCredits: number;
  lowBalanceThreshold: number;
  isLow: boolean;
  isEmpty: boolean;
}

interface OnboardingSummary {
  completedSteps: number;
  totalSteps: number;
  completed: boolean;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [walletAlert, setWalletAlert] = useState<WalletAlert | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingSummary | null>(null);
  const [billingIntent, setBillingIntent] = useState<BillingIntent>({
    billing: false,
    plan: null,
  });

  useEffect(() => {
    setBillingIntent(readBillingIntentFromWindow());
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .get<DashboardSummary>("/api/v1/analytics/summary")
      .then(setSummary)
      .catch(() => setSummary(null));
    if (user.role === "BUSINESS_ADMIN" || user.role === "TEAM_LEAD") {
      api
        .get<WalletAlert | null>("/api/v1/wallets/alerts")
        .then(setWalletAlert)
        .catch(() => setWalletAlert(null));
      // Onboarding banner — fetch the same status the /onboarding page
      // uses, just trimmed for the dashboard's needs.
      api
        .get<OnboardingSummary>("/api/v1/onboarding/status")
        .then(setOnboarding)
        .catch(() => setOnboarding(null));
    }
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("dashboard.welcome", { name: user.name.split(" ")[0] })}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.role === "SUPER_ADMIN"
            ? t("dashboard.subtitleSuperAdmin")
            : t("dashboard.subtitleBusiness")}
        </p>
      </header>

      {billingIntent.billing && user.role !== "SUPER_ADMIN" && (
        <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="font-medium">
            {billingIntent.plan
              ? t("dashboard.planSelected", { plan: billingIntent.plan })
              : t("dashboard.planSaved")}
          </div>
          <div className="mt-1 text-emerald-800/80">
            {t("dashboard.reviewPlanFrom")}{" "}
            <a
              href={billingIntentHref("/dashboard/billing", billingIntent)}
              className="font-semibold underline"
            >
              {t("dashboard.planBillingLink")}
            </a>
            .
          </div>
        </div>
      )}

      {walletAlert?.isLow && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("dashboard.walletLow", {
            balance: walletAlert.balanceCredits,
            threshold: walletAlert.lowBalanceThreshold,
          })}{" "}
          <a href="/wallets" className="font-medium underline">
            {t("dashboard.rechargeCredits")}
          </a>
          {walletAlert.isEmpty ? t("dashboard.sendingBlockedSuffix") : "."}
        </div>
      )}

      {onboarding && !onboarding.completed && (
        <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("dashboard.onboardingProgress", {
                done: onboarding.completedSteps,
                total: onboarding.totalSteps,
              })}
            </span>
            <a
              href="/onboarding"
              className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
            >
              {t("dashboard.continueSetup")}
            </a>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{
                width: `${Math.round((onboarding.completedSteps / onboarding.totalSteps) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {user.role === "SUPER_ADMIN" && <SuperAdminCards summary={summary} />}
      {(user.role === "BUSINESS_ADMIN" || user.role === "TEAM_LEAD") && (
        <BusinessCards summary={summary} />
      )}
      {user.role === "AGENT" && (
        <p className="text-sm text-slate-600">
          {t("dashboard.agentOpenYour")}{" "}
          <a className="text-emerald-700 hover:underline" href="/inbox">
            {t("dashboard.inbox")}
          </a>{" "}
          {t("dashboard.toStartReplying")}
        </p>
      )}
    </DashboardShell>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
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

// AI usage cost is recorded as USD cents on AiUsage rows (Claude pricing is
// USD-denominated). We surface it in USD on the dashboard to stay honest —
// converting to INR without a tracked FX rate would be more confusing
// than helpful.
function formatCurrencyFromCents(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function SuperAdminCards({ summary }: { summary: DashboardSummary | null }) {
  const { t } = useI18n();
  const totals = summary?.totals;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard
        label={t("dashboard.tenants")}
        value={totals?.tenants?.toString() ?? "—"}
        hint={t("dashboard.nActive", { n: totals?.activeTenants ?? "—" })}
      />
      <StatCard
        label={t("dashboard.messagesToday")}
        value={totals?.messagesToday?.toString() ?? "—"}
        hint={t("dashboard.nThisMonth", { n: totals?.messagesMonth ?? "—" })}
      />
      <StatCard
        label={t("dashboard.mrr")}
        value={formatCurrencyFromPaisa(totals?.mrrInPaisa)}
        hint={t("dashboard.fromActiveSubs")}
      />
    </div>
  );
}

function PlanQuotaBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const { t } = useI18n();
  // Treat 0 / negative limit as "unlimited on this plan" — show count only.
  if (!limit || limit <= 0) {
    return (
      <div>
        <div className="flex justify-between text-xs text-slate-600">
          <span className="font-medium">{label}</span>
          <span>{used.toLocaleString()} · {t("dashboard.unlimited")}</span>
        </div>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone =
    pct >= 90
      ? "bg-red-500"
      : pct >= 70
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span className="font-medium">{label}</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
          <span className="ml-2 text-slate-500">({pct}%)</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BusinessCards({ summary }: { summary: DashboardSummary | null }) {
  const { t } = useI18n();
  const totals = summary?.totals;
  const quota = summary?.sendQuota;
  const plan = summary?.planQuotas;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("dashboard.contacts")} value={totals?.contacts?.toString() ?? "—"} />
        <StatCard
          label={t("dashboard.campaigns")}
          value={totals?.campaigns?.toString() ?? "—"}
          hint={t("dashboard.nMessagesThisMonth", { n: totals?.messagesMonth ?? "—" })}
        />
        <StatCard
          label={t("dashboard.openConversations")}
          value={totals?.activeConversations?.toString() ?? "—"}
          hint={t("dashboard.nLeadsPipeline", { n: totals?.leads ?? "—" })}
        />
        <StatCard
          label={t("dashboard.aiSpend")}
          value={formatCurrencyFromCents(totals?.aiCostInCentsThisMonth)}
          hint={t("dashboard.usdThisMonth")}
        />
      </div>

      {quota && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("dashboard.sendQuotaTitle")}
              </div>
              <div className="mt-1 font-medium">
                {quota.monthlyUsed.toLocaleString()}
                <span className="ml-2 text-slate-500">
                  {quota.monthlySafetyCapEnabled && quota.monthlyQuota
                    ? `/ ${quota.monthlyQuota.toLocaleString()} ${t("dashboard.thisMonth")}`
                    : t("dashboard.walletMetered")}
                </span>
              </div>
            </div>
            {quota.monthlySafetyCapEnabled && quota.percentUsed !== null ? (
              <div
                className={`rounded-full px-2 py-0.5 text-xs ${
                  quota.percentUsed >= 90
                    ? "bg-red-50 text-red-700"
                    : quota.percentUsed >= 70
                      ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {t("dashboard.percentUsedBadge", { pct: quota.percentUsed })}
              </div>
            ) : (
              <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                {t("dashboard.noPlanMessageCap")}
              </div>
            )}
          </div>
          {quota.monthlySafetyCapEnabled && quota.percentUsed !== null ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${
                  quota.percentUsed >= 90
                    ? "bg-red-500"
                    : quota.percentUsed >= 70
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, quota.percentUsed)}%` }}
              />
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-slate-500">
            {t("dashboard.perSecondNote", { limit: quota.perSecondLimit })}
          </p>
        </section>
      )}

      {plan && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("dashboard.planUsage")}
          </div>
          <div className="mt-4 space-y-3">
            <PlanQuotaBar
              label={t("dashboard.contacts")}
              used={plan.contacts.used}
              limit={plan.contacts.limit}
            />
            <PlanQuotaBar
              label={t("dashboard.campaigns")}
              used={plan.campaigns.used}
              limit={plan.campaigns.limit}
            />
            <PlanQuotaBar
              label={t("dashboard.agentSeats")}
              used={plan.agentSeats.used}
              limit={plan.agentSeats.limit}
            />
          </div>
          {plan.aiCreditsPerMonth > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              {t("dashboard.aiCreditBudget", {
                credits: plan.aiCreditsPerMonth.toLocaleString(),
              })}
            </p>
          )}
        </section>
      )}
    </>
  );
}
