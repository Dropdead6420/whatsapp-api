"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

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
  _count?: { subscriptions: number };
}

interface PlanDraft {
  displayName: string;
  description: string;
  priceInRupees: string;
  billingCycle: string;
  messageQuota: string;
  contactLimit: string;
  agentLimit: string;
  aiCreditsPerMonth: string;
  campaignLimit: string;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: Plan;
  tenant: {
    id: string;
    name: string;
    type: string;
    status: string;
    parentTenantId?: string | null;
    parentTenant?: {
      id: string;
      name: string;
      partnerMarginEnabled: boolean;
    } | null;
  };
}

interface PlanRequest {
  id: string;
  tenant: { id: string; name: string; status: string };
  user: { id: string; name: string; email: string };
  currentPlan: { displayName?: string; planName?: string } | null;
  requestedPlan: {
    requestedPlanId?: string;
    requestedDisplayName?: string;
    requestedPlanName?: string;
    priceInPaisa?: number;
    billingCycle?: string;
  } | null;
  createdAt: string;
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
    directMrrInPaisa: number;
    partnerMrrInPaisa: number;
    partnerAgencyProfitInPaisa: number;
    planCount: number;
  };
  partnerSummaries: Array<{
    partnerTenantId: string;
    partnerName: string;
    customerCount: number;
    activeSubscriptions: number;
    baseMrrInPaisa: number;
    agencyProfitInPaisa: number;
    partnerMarginEnabled: boolean;
    partnerMarginBps: number;
    planBreakdown: Array<{
      planId: string;
      name: string;
      count: number;
      mrrInPaisa: number;
    }>;
  }>;
  planRequests: PlanRequest[];
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

function planToDraft(plan: Plan): PlanDraft {
  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
    priceInRupees: String(plan.priceInPaisa / 100),
    billingCycle: plan.billingCycle,
    messageQuota: String(plan.messageQuota),
    contactLimit: String(plan.contactLimit),
    agentLimit: String(plan.agentLimit),
    aiCreditsPerMonth: String(plan.aiCreditsPerMonth),
    campaignLimit: String(plan.campaignLimit),
    chatbotEnabled: plan.chatbotEnabled,
    adsIntegrationEnabled: plan.adsIntegrationEnabled,
    creativeStudioEnabled: plan.creativeStudioEnabled,
    apiAccessEnabled: plan.apiAccessEnabled,
  };
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function readRequestedPlanFromWindow() {
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
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [requestedPlan, setRequestedPlan] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [activatingRequestId, setActivatingRequestId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadBilling() {
    setErr(null);
    try {
      const [billingData, tenantData] = await Promise.all([
        api.get<BillingResponse>("/api/v1/admin/billing"),
        api.get<Tenant[]>("/api/v1/tenants?limit=100"),
      ]);
      const selectedPlan = findPlanByRequest(billingData.plans, requestedPlan);
      setBilling(billingData);
      setTenants(tenantData.filter((tenant) => tenant.status !== "DELETED"));
      setPlanId((current) => selectedPlan?.id || current || billingData.plans[0]?.id || "");
      setTenantId((current) => current || tenantData[0]?.id || "");
      if (selectedPlan) {
        setEditingPlanId(selectedPlan.id);
        setPlanDraft(planToDraft(selectedPlan));
      } else if (!editingPlanId && billingData.plans[0]) {
        setEditingPlanId(billingData.plans[0].id);
        setPlanDraft(planToDraft(billingData.plans[0]));
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load billing");
    }
  }

  function startEditPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setPlanDraft(planToDraft(plan));
    setNotice(null);
    setErr(null);
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlanId || !planDraft) return;
    setSavingPlan(true);
    setErr(null);
    setNotice(null);
    try {
      const priceInPaisa = Math.max(
        0,
        Math.round(Number(planDraft.priceInRupees || "0") * 100),
      );
      const updated = await api.patch<Plan>(`/api/v1/admin/plans/${editingPlanId}`, {
        displayName: planDraft.displayName.trim(),
        description: planDraft.description.trim() || null,
        priceInPaisa,
        billingCycle: planDraft.billingCycle.trim() || "monthly",
        messageQuota: parsePositiveInt(planDraft.messageQuota, 1),
        contactLimit: parsePositiveInt(planDraft.contactLimit, 1),
        agentLimit: parsePositiveInt(planDraft.agentLimit, 1),
        aiCreditsPerMonth: parsePositiveInt(planDraft.aiCreditsPerMonth, 0),
        campaignLimit: parsePositiveInt(planDraft.campaignLimit, 1),
        chatbotEnabled: planDraft.chatbotEnabled,
        adsIntegrationEnabled: planDraft.adsIntegrationEnabled,
        creativeStudioEnabled: planDraft.creativeStudioEnabled,
        apiAccessEnabled: planDraft.apiAccessEnabled,
      });
      setNotice(`${updated.displayName} updated. Public pricing will refresh from this catalog.`);
      setPlanDraft(planToDraft(updated));
      await loadBilling();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to update plan");
    } finally {
      setSavingPlan(false);
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
      setNotice(
        status === "ACTIVE"
          ? "Subscription created and tenant limits updated."
          : "Subscription created.",
      );
      await loadBilling();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create subscription");
    }
  }

  async function activatePlanRequest(request: PlanRequest) {
    const requestedPlanId = request.requestedPlan?.requestedPlanId;
    if (!requestedPlanId) {
      setErr("This request is missing a requested plan id.");
      return;
    }
    setErr(null);
    setNotice(null);
    setActivatingRequestId(request.id);
    try {
      await api.post("/api/v1/admin/subscriptions", {
        tenantId: request.tenant.id,
        planId: requestedPlanId,
        status: "ACTIVE",
      });
      setTenantId(request.tenant.id);
      setPlanId(requestedPlanId);
      setStatus("ACTIVE");
      setNotice(
        `${request.tenant.name} is now on ${
          request.requestedPlan?.requestedDisplayName ?? "the requested plan"
        }; tenant limits were updated from the plan catalog.`,
      );
      await loadBilling();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to activate plan request");
    } finally {
      setActivatingRequestId(null);
    }
  }

  useEffect(() => {
    setRequestedPlan(readRequestedPlanFromWindow());
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadBilling();
  }, [user, requestedPlan]);

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
          Plans, public pricing, subscriptions, and platform MRR controls.
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
      {requestedPlan && (
        <div className="mb-4 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
          Requested public plan: <span className="font-semibold">{requestedPlan}</span>.
          Use the plan editor or assign it to a tenant from this page.
        </div>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">MRR</div>
          <div className="mt-2 text-2xl font-semibold">
            {billing ? formatCurrencyFromPaisa(billing.metrics.activeMrrInPaisa) : "-"}
          </div>
          <p className="mt-1 text-xs text-slate-500">Monthly-normalized active subscriptions</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Direct MRR
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {billing ? formatCurrencyFromPaisa(billing.metrics.directMrrInPaisa) : "-"}
          </div>
          <p className="mt-1 text-xs text-slate-500">Customers not attached to a partner</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Partner MRR
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {billing ? formatCurrencyFromPaisa(billing.metrics.partnerMrrInPaisa) : "-"}
          </div>
          <p className="mt-1 text-xs text-slate-500">Revenue from reseller customers</p>
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
            Partner Profit
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {billing
              ? formatCurrencyFromPaisa(billing.metrics.partnerAgencyProfitInPaisa)
              : "-"}
          </div>
          <p className="mt-1 text-xs text-slate-500">{billing?.metrics.planCount ?? "-"} catalog plans</p>
        </div>
      </section>

      <section className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold">Partner Plan Economics</div>
          <p className="mt-1 text-xs text-slate-500">
            Live reseller MRR and license distribution from active customer subscriptions.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Customers</th>
                <th className="px-4 py-3">MRR</th>
                <th className="px-4 py-3">Agency Profit</th>
                <th className="px-4 py-3">Plan Mix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {billing?.partnerSummaries.map((partner) => (
                <tr key={partner.partnerTenantId}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{partner.partnerName}</div>
                    <div className="text-xs text-slate-500">
                      {partner.partnerMarginEnabled
                        ? `${(partner.partnerMarginBps / 100).toFixed(1)}% margin enabled`
                        : "Margin disabled"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{partner.customerCount} customers</div>
                    <div className="text-xs text-slate-500">
                      {partner.activeSubscriptions} active subscriptions
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {formatCurrencyFromPaisa(partner.baseMrrInPaisa)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        partner.partnerMarginEnabled
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {formatCurrencyFromPaisa(partner.agencyProfitInPaisa)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex flex-wrap gap-2">
                      {partner.planBreakdown.map((plan) => (
                        <span
                          key={plan.planId}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-xs"
                        >
                          {plan.name}: {plan.count}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {billing?.partnerSummaries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No active partner-owned customer subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          Recent Plan Requests
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Requested Plan</th>
              <th className="px-4 py-3">Current Plan</th>
              <th className="px-4 py-3">Requested By</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {billing?.planRequests.map((request) => (
              <tr key={request.id}>
                <td className="px-4 py-3 font-medium">{request.tenant.name}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {request.requestedPlan?.requestedDisplayName ?? "-"}
                  </div>
                  {typeof request.requestedPlan?.priceInPaisa === "number" && (
                    <div className="text-xs text-slate-500">
                      {formatCurrencyFromPaisa(request.requestedPlan.priceInPaisa)}
                      /{request.requestedPlan.billingCycle ?? "monthly"}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {request.currentPlan?.displayName ?? request.currentPlan?.planName ?? "None"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{request.user.name}</div>
                  <div className="text-xs text-slate-500">{request.user.email}</div>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(request.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => activatePlanRequest(request)}
                    disabled={
                      activatingRequestId === request.id ||
                      !request.requestedPlan?.requestedPlanId
                    }
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activatingRequestId === request.id ? "Activating..." : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {billing?.planRequests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No plan requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
                <th className="px-4 py-3 text-right">Manage</th>
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
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => startEditPlan(plan)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!billing && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading plans.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-6">
          {planDraft && (
            <form
              onSubmit={savePlan}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2 className="text-sm font-semibold">Public Plan Editor</h2>
              <p className="mt-1 text-xs text-slate-500">
                These values power the website pricing cards and subscription limits.
              </p>
              <label className="mt-4 block text-sm">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Plan Name
                </span>
                <input
                  value={planDraft.displayName}
                  onChange={(event) =>
                    setPlanDraft({ ...planDraft, displayName: event.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Public Description
                </span>
                <textarea
                  value={planDraft.description}
                  onChange={(event) =>
                    setPlanDraft({ ...planDraft, description: event.target.value })
                  }
                  rows={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <NumberField
                  label="Price (₹)"
                  value={planDraft.priceInRupees}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, priceInRupees: value })
                  }
                />
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Billing Cycle
                  </span>
                  <select
                    value={planDraft.billingCycle}
                    onChange={(event) =>
                      setPlanDraft({ ...planDraft, billingCycle: event.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  >
                    <option value="monthly">monthly</option>
                    <option value="annual">annual</option>
                    <option value="custom">custom</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <NumberField
                  label="Messages"
                  value={planDraft.messageQuota}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, messageQuota: value })
                  }
                />
                <NumberField
                  label="Contacts"
                  value={planDraft.contactLimit}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, contactLimit: value })
                  }
                />
                <NumberField
                  label="Agents"
                  value={planDraft.agentLimit}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, agentLimit: value })
                  }
                />
                <NumberField
                  label="AI Credits"
                  value={planDraft.aiCreditsPerMonth}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, aiCreditsPerMonth: value })
                  }
                />
                <NumberField
                  label="Campaigns"
                  value={planDraft.campaignLimit}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, campaignLimit: value })
                  }
                />
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <Toggle
                  label="Chatbot / Workflow"
                  checked={planDraft.chatbotEnabled}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, chatbotEnabled: value })
                  }
                />
                <Toggle
                  label="AI Creative Studio"
                  checked={planDraft.creativeStudioEnabled}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, creativeStudioEnabled: value })
                  }
                />
                <Toggle
                  label="Ads Integrations"
                  checked={planDraft.adsIntegrationEnabled}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, adsIntegrationEnabled: value })
                  }
                />
                <Toggle
                  label="API Access"
                  checked={planDraft.apiAccessEnabled}
                  onChange={(value) =>
                    setPlanDraft({ ...planDraft, apiAccessEnabled: value })
                  }
                />
              </div>
              <button
                disabled={savingPlan}
                className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPlan ? "Saving..." : "Save Plan"}
              </button>
            </form>
          )}

          <form
            onSubmit={assignPlan}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold">Assign Plan</h2>
            <p className="mt-1 text-xs text-slate-500">
              Create an active subscription and apply the plan limits to the tenant.
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
        </div>
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
      />
    </label>
  );
}
