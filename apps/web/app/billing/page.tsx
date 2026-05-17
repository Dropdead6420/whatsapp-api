"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Plan {
  id: string;
  name: string;
  displayName: string;
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
  _count?: { subscriptions: number };
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: Plan;
  tenant: { id: string; name: string; type: string; status: string };
}

interface Tenant {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface BillingResponse {
  plans: Plan[];
  subscriptions: Subscription[];
  metrics: {
    activeSubscriptions: number;
    activeMrrInPaisa: number;
    planCount: number;
  };
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

export default function BillingPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadBilling() {
    setErr(null);
    try {
      const [billingData, tenantData] = await Promise.all([
        api.get<BillingResponse>("/api/v1/admin/billing"),
        api.get<Tenant[]>("/api/v1/tenants?limit=100"),
      ]);
      setBilling(billingData);
      setTenants(tenantData.filter((tenant) => tenant.status !== "DELETED"));
      setPlanId((current) => current || billingData.plans[0]?.id || "");
      setTenantId((current) => current || tenantData[0]?.id || "");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load billing");
    }
  }

  async function assignPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/subscriptions", {
        tenantId,
        planId,
        status,
      });
      setNotice("Subscription created.");
      await loadBilling();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create subscription");
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadBilling();
  }, [user]);

  const planMap = useMemo(() => {
    return new Map((billing?.plans ?? []).map((plan) => [plan.id, plan]));
  }, [billing]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Plans, subscriptions, and platform MRR controls.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">MRR</div>
          <div className="mt-2 text-2xl font-semibold">
            {billing ? formatCurrencyFromPaisa(billing.metrics.activeMrrInPaisa) : "-"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Active Subscriptions
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {billing?.metrics.activeSubscriptions ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Plan Catalog
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {billing?.metrics.planCount ?? "-"}
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
            Plans
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Limits</th>
                <th className="px-4 py-3">Features</th>
                <th className="px-4 py-3">Subs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {billing?.plans.map((plan) => (
                <tr key={plan.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{plan.displayName}</div>
                    <div className="text-xs text-slate-500">{plan.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    {formatCurrencyFromPaisa(plan.priceInPaisa)}
                    <span className="text-slate-400">/{plan.billingCycle}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{formatCompact(plan.messageQuota)} messages</div>
                    <div>{formatCompact(plan.contactLimit)} contacts</div>
                    <div>{plan.agentLimit} agents</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{plan.creativeStudioEnabled ? "Creative Studio" : "No creative"}</div>
                    <div>{plan.chatbotEnabled ? "Chatbot" : "No chatbot"}</div>
                    <div>{plan.apiAccessEnabled ? "API access" : "No API access"}</div>
                  </td>
                  <td className="px-4 py-3">{plan._count?.subscriptions ?? 0}</td>
                </tr>
              ))}
              {!billing && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading plans.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={assignPlan}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold">Assign Plan</h2>
          <p className="mt-1 text-xs text-slate-500">
            Create a subscription for a tenant.
          </p>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Tenant
            </span>
            <select
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Plan
            </span>
            <select
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            >
              {billing?.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.displayName} - {formatCurrencyFromPaisa(plan.priceInPaisa)}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="EXPIRED">EXPIRED</option>
            </select>
          </label>
          <button
            disabled={!tenantId || !planId}
            className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create Subscription
          </button>
          {planId && planMap.get(planId) && (
            <p className="mt-3 text-xs text-slate-500">
              Selected plan includes {formatCompact(planMap.get(planId)!.messageQuota)} messages and{" "}
              {formatCompact(planMap.get(planId)!.contactLimit)} contacts.
            </p>
          )}
        </form>
      </section>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          Recent Subscriptions
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Period End</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {billing?.subscriptions.map((subscription) => (
              <tr key={subscription.id}>
                <td className="px-4 py-3 font-medium">{subscription.tenant.name}</td>
                <td className="px-4 py-3">{subscription.plan.displayName}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      subscription.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {subscription.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {billing?.subscriptions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                  No subscriptions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
