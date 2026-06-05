"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CreditCard, Send, Sparkles } from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { useAuth } from "../../../src/hooks/useAuth";
import { api, ApiClientError } from "../../../src/lib/api";
import { useI18n } from "../../../src/i18n/I18nProvider";

interface Plan {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
  features: string[];
}

interface CurrentSubscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: Plan;
}

interface TenantBillingResponse {
  tenant: {
    id: string;
    name: string;
    messageQuotaPerMonth: number;
    contactLimit: number;
    agentLimit: number;
    aiCreditsPerMonth: number;
    campaignLimit: number;
  };
  currentSubscription: CurrentSubscription | null;
  plans: Plan[];
}

interface PlanRequestResult {
  status: "requested" | "already_active";
  requestedPlan: Plan;
  message: string;
}

function formatCurrencyFromPaisa(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: "compact" }).format(value);
}

function readRequestedPlan() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("plan");
}

function findPlanByRequest(plans: Plan[], requestedPlan: string | null) {
  if (!requestedPlan) return null;
  const normalized = requestedPlan.toLowerCase();
  return (
    plans.find(
      (plan) =>
        plan.id.toLowerCase() === normalized ||
        plan.name.toLowerCase() === normalized ||
        plan.displayName.toLowerCase() === normalized,
    ) ?? null
  );
}

export default function DashboardBillingPage() {
  const { t } = useI18n();
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "WHITE_LABEL_ADMIN"],
  });
  const [billing, setBilling] = useState<TenantBillingResponse | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [requestedPlan, setRequestedPlan] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadBilling(planFromUrl: string | null = requestedPlan) {
    setErr(null);
    try {
      const data = await api.get<TenantBillingResponse>("/api/v1/billing");
      const selectedFromUrl = findPlanByRequest(data.plans, planFromUrl);
      setBilling(data);
      setSelectedPlanId(
        selectedFromUrl?.id ??
          data.currentSubscription?.plan.id ??
          data.plans[0]?.id ??
          "",
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("billing.loadFailed"));
    }
  }

  async function requestPlan(plan: Plan) {
    setErr(null);
    setNotice(null);
    setBusyPlanId(plan.id);
    try {
      const result = await api.post<PlanRequestResult>(
        "/api/v1/billing/plan-change-requests",
        { planId: plan.id },
      );
      setNotice(result.message);
      await loadBilling();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("billing.requestFailed"));
    } finally {
      setBusyPlanId(null);
    }
  }

  useEffect(() => {
    const plan = readRequestedPlan();
    setRequestedPlan(plan);
    void loadBilling(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPlan = useMemo(
    () => billing?.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [billing?.plans, selectedPlanId],
  );
  const currentPlanId = billing?.currentSubscription?.plan.id ?? null;

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {t("billing.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            {t("billing.subtitle")}
          </p>
        </div>
        <a
          href="/pricing"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {t("billing.publicPricing")}
        </a>
      </header>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {requestedPlan && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t("billing.selectedFromPricing", { plan: requestedPlan })}
        </div>
      )}

      <section className="mb-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-slate-950 text-white">
              <CreditCard className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {t("billing.activeSubscription")}
              </div>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">
                {billing?.currentSubscription?.plan.displayName ?? t("billing.noActivePlan")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {billing?.currentSubscription
                  ? t("billing.renews", {
                      date: new Date(
                        billing.currentSubscription.currentPeriodEnd,
                      ).toLocaleDateString(),
                    })
                  : t("billing.noPlanHint")}
              </p>
            </div>
            {billing?.currentSubscription && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                {billing.currentSubscription.status}
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuotaCard
              label={t("billing.quotaContacts")}
              value={formatCompact(billing?.tenant.contactLimit ?? 0)}
            />
            <QuotaCard
              label={t("billing.quotaAgents")}
              value={String(billing?.tenant.agentLimit ?? 0)}
            />
            <QuotaCard
              label={t("billing.quotaCampaigns")}
              value={formatCompact(billing?.tenant.campaignLimit ?? 0)}
            />
            <QuotaCard
              label={t("billing.quotaAiCredits")}
              value={formatCompact(billing?.tenant.aiCreditsPerMonth ?? 0)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {t("billing.selectedPlan")}
              </h2>
              <p className="text-sm text-slate-500">
                {t("billing.selectedPlanHint")}
              </p>
            </div>
          </div>
          {selectedPlan ? (
            <div className="mt-5">
              <div className="text-2xl font-semibold text-slate-950">
                {selectedPlan.displayName}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {formatCurrencyFromPaisa(selectedPlan.priceInPaisa)}/
                {selectedPlan.billingCycle}
              </div>
              <button
                type="button"
                onClick={() => requestPlan(selectedPlan)}
                disabled={busyPlanId === selectedPlan.id}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {busyPlanId === selectedPlan.id
                  ? t("billing.sending")
                  : currentPlanId === selectedPlan.id
                    ? t("billing.confirmActive")
                    : t("billing.requestThis")}
              </button>
            </div>
          ) : (
            <div className="mt-5 text-sm text-slate-500">{t("billing.loadingPlans")}</div>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        {billing?.plans.map((plan) => {
          const isCurrent = currentPlanId === plan.id;
          const isSelected = selectedPlanId === plan.id;
          return (
            <article
              key={plan.id}
              className={`rounded-lg border bg-white p-5 shadow-sm transition ${
                isSelected ? "border-slate-950 ring-2 ring-slate-950/5" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    {plan.displayName}
                  </h2>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                    {plan.name}
                  </p>
                </div>
                {isCurrent && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                    {t("billing.current")}
                  </span>
                )}
              </div>
              <div className="mt-4 text-2xl font-semibold text-slate-950">
                {formatCurrencyFromPaisa(plan.priceInPaisa)}
                <span className="text-sm font-medium text-slate-400">
                  /{plan.billingCycle}
                </span>
              </div>
              <p className="mt-3 min-h-[3rem] text-sm leading-6 text-slate-500">
                {plan.description ?? "Managed by the platform billing catalog."}
              </p>
              <button
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={`mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold ${
                  isSelected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {isSelected ? "Selected" : "Select"}
              </button>
              <ul className="mt-5 space-y-2 text-sm text-slate-600">
                {plan.features.slice(0, 6).map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>
    </DashboardShell>
  );
}

function QuotaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}
