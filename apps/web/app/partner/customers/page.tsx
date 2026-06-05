"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface PlanOption {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  priceInPaisa: number;
  billingCycle: string;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  features: string[];
}

interface CustomerTenant {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  primaryAdmin?: {
    id: string;
    email: string;
    name: string;
    status: string;
    emailVerified: string | null;
    lastLoginAt: string | null;
  } | null;
  messageQuotaPerMonth: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  _count: { users: number; contacts: number; campaigns: number };
  subscriptions?: Array<{
    id: string;
    status: string;
    currentPeriodEnd: string;
    plan: {
      id: string;
      name: string;
      displayName: string;
      priceInPaisa: number;
      billingCycle: string;
    };
  }>;
}

interface AdminResetResult {
  customerName: string;
  admin: {
    id: string;
    email: string;
    name: string;
    status: string;
    emailVerified: string | null;
    lastLoginAt: string | null;
  };
  loginUrl: string;
  temporaryPassword: string;
}

const blankCustomerForm = {
  name: "",
  adminEmail: "",
  adminName: "",
  adminPassword: "",
  planId: "",
  industry: "",
  seedStarterPack: true,
};

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function billingLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") return "year";
  return "month";
}

function monthlyPlanValue(paise: number, billingCycle: string) {
  const normalized = billingCycle.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") {
    return Math.round(paise / 12);
  }
  return paise;
}

function usagePercent(used: number, limit: number) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function usageTone(percent: number) {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function statusBadgeClass(status: string) {
  if (status === "ACTIVE") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (status === "SUSPENDED") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function maxUsagePercent(customer: CustomerTenant) {
  return Math.max(
    usagePercent(customer._count.contacts, customer.contactLimit),
    usagePercent(customer._count.users, customer.agentLimit),
    usagePercent(customer._count.campaigns, customer.campaignLimit),
  );
}

function needsAdminAttention(customer: CustomerTenant) {
  return (
    !customer.primaryAdmin ||
    !customer.primaryAdmin.emailVerified ||
    !customer.primaryAdmin.lastLoginAt
  );
}

function csvValue(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PartnerCustomersPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [customers, setCustomers] = useState<CustomerTenant[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankCustomerForm);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [usageFilter, setUsageFilter] = useState("ALL");
  const [adminHealthFilter, setAdminHealthFilter] = useState("ALL");
  const [customersLoading, setCustomersLoading] = useState(false);
  const [changingPlanCustomerId, setChangingPlanCustomerId] = useState<string | null>(
    null,
  );
  const [changingStatusCustomerId, setChangingStatusCustomerId] = useState<
    string | null
  >(null);
  const [resettingAdminCustomerId, setResettingAdminCustomerId] = useState<
    string | null
  >(null);
  const [adminResetResult, setAdminResetResult] =
    useState<AdminResetResult | null>(null);

  async function refresh(nextSearch = search) {
    setCustomersLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      const normalizedSearch = nextSearch.trim();
      if (normalizedSearch) params.set("search", normalizedSearch);
      const res = await api.get<CustomerTenant[]>(
        `/api/v1/partner/customers?${params.toString()}`,
      );
      setCustomers(res);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
    } finally {
      setCustomersLoading(false);
    }
  }

  async function loadPlans() {
    try {
      const res = await api.get<PlanOption[]>("/api/v1/partner/plans");
      setPlans(res);
      setForm((current) => ({
        ...current,
        planId: current.planId || res[0]?.id || "",
      }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load plans");
    }
  }

  useEffect(() => {
    if (user) {
      void refresh();
      void loadPlans();
    }
  }, [user]);

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/v1/partner/customers", {
        ...form,
        planId: form.planId || undefined,
        industry: form.industry.trim() || undefined,
      });
      setShowForm(false);
      setForm({ ...blankCustomerForm, planId: plans[0]?.id || "" });
      await refresh();
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeCustomerPlan(customerId: string, planId: string) {
    if (!planId) return;
    setChangingPlanCustomerId(customerId);
    try {
      const updated = await api.patch<CustomerTenant>(
        `/api/v1/partner/customers/${customerId}/plan`,
        { planId },
      );
      setCustomers((current) =>
        current.map((customer) =>
          customer.id === customerId
            ? {
                ...customer,
                ...updated,
                primaryAdmin: updated.primaryAdmin ?? customer.primaryAdmin,
              }
            : customer,
        ),
      );
      setErr(null);
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Plan change failed");
    } finally {
      setChangingPlanCustomerId(null);
    }
  }

  async function changeCustomerStatus(
    customer: CustomerTenant,
    status: "ACTIVE" | "SUSPENDED",
  ) {
    if (customer.status === status) return;
    const isSuspending = status === "SUSPENDED";
    const confirmed = window.confirm(
      isSuspending
        ? `Suspend ${customer.name}? Their users will no longer be treated as an active customer workspace.`
        : `Reactivate ${customer.name}? Their workspace users will regain normal access.`,
    );
    if (!confirmed) return;

    setChangingStatusCustomerId(customer.id);
    try {
      const updated = await api.patch<CustomerTenant>(
        `/api/v1/partner/customers/${customer.id}/status`,
        { status },
      );
      setCustomers((current) =>
        current.map((item) =>
          item.id === customer.id
            ? {
                ...item,
                ...updated,
                primaryAdmin: updated.primaryAdmin ?? item.primaryAdmin,
              }
            : item,
        ),
      );
      setErr(null);
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Status change failed");
    } finally {
      setChangingStatusCustomerId(null);
    }
  }

  async function resetCustomerAdminAccess(customer: CustomerTenant) {
    const confirmed = window.confirm(
      `Reset the primary admin password for ${customer.name}? A new temporary password will be shown once.`,
    );
    if (!confirmed) return;

    setResettingAdminCustomerId(customer.id);
    try {
      const reset = await api.post<Omit<AdminResetResult, "customerName">>(
        `/api/v1/partner/customers/${customer.id}/admin-reset`,
        {},
      );
      setAdminResetResult({ ...reset, customerName: customer.name });
      setCustomers((current) =>
        current.map((item) =>
          item.id === customer.id
            ? {
                ...item,
                primaryAdmin: {
                  id: reset.admin.id,
                  email: reset.admin.email,
                  name: reset.admin.name,
                  status: reset.admin.status,
                  emailVerified: reset.admin.emailVerified,
                  lastLoginAt: reset.admin.lastLoginAt,
                },
              }
            : item,
        ),
      );
      setErr(null);
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Admin reset failed");
    } finally {
      setResettingAdminCustomerId(null);
    }
  }

  function exportFilteredCustomers() {
    const headers = [
      "Customer",
      "Status",
      "Admin name",
      "Admin email",
      "Admin status",
      "Admin verified",
      "Admin last login",
      "Plan",
      "Renewal date",
      "Contacts used",
      "Contact limit",
      "Agents used",
      "Agent limit",
      "Campaigns used",
      "Campaign limit",
      "Max usage %",
      "Created date",
    ];
    const rows = filteredCustomers.map((customer) => {
      const subscription = customer.subscriptions?.[0];
      return [
        customer.name,
        customer.status,
        customer.primaryAdmin?.name ?? "",
        customer.primaryAdmin?.email ?? "",
        customer.primaryAdmin?.status ?? "",
        customer.primaryAdmin?.emailVerified ? "Yes" : "No",
        customer.primaryAdmin?.lastLoginAt
          ? new Date(customer.primaryAdmin.lastLoginAt).toISOString()
          : "",
        subscription?.plan.displayName ?? "No plan",
        subscription?.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd).toISOString().slice(0, 10)
          : "",
        customer._count.contacts,
        customer.contactLimit,
        customer._count.users,
        customer.agentLimit,
        customer._count.campaigns,
        customer.campaignLimit,
        maxUsagePercent(customer),
        new Date(customer.createdAt).toISOString().slice(0, 10),
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => csvValue(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `partner-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const selectedPlan = plans.find((plan) => plan.id === form.planId);
  const statusOptions = useMemo(
    () => Array.from(new Set(customers.map((customer) => customer.status))).sort(),
    [customers],
  );
  const filteredCustomers = useMemo(
    () =>
      customers.filter((customer) => {
        const activePlanId = customer.subscriptions?.[0]?.plan.id ?? "NO_PLAN";
        const matchesStatus =
          statusFilter === "ALL" || customer.status === statusFilter;
        const matchesPlan = planFilter === "ALL" || activePlanId === planFilter;
        const maxUsage = maxUsagePercent(customer);
        const matchesUsage =
          usageFilter === "ALL" ||
          (usageFilter === "AT_RISK" && maxUsage >= 70) ||
          (usageFilter === "OVER_LIMIT" && maxUsage >= 100);
        const matchesAdminHealth =
          adminHealthFilter === "ALL" ||
          (adminHealthFilter === "ATTENTION" && needsAdminAttention(customer)) ||
          (adminHealthFilter === "NO_ADMIN" && !customer.primaryAdmin) ||
          (adminHealthFilter === "UNVERIFIED" &&
            !!customer.primaryAdmin &&
            !customer.primaryAdmin.emailVerified) ||
          (adminHealthFilter === "NEVER_LOGIN" &&
            !!customer.primaryAdmin &&
            !customer.primaryAdmin.lastLoginAt);
        return matchesStatus && matchesPlan && matchesUsage && matchesAdminHealth;
      }),
    [adminHealthFilter, customers, planFilter, statusFilter, usageFilter],
  );
  const portfolioSummary = useMemo(() => {
    const activeCustomers = customers.filter(
      (customer) => customer.status === "ACTIVE",
    ).length;
    const estimatedMrrInPaisa = customers.reduce((sum, customer) => {
      const subscription = customer.subscriptions?.[0];
      if (!subscription) return sum;
      return (
        sum +
        monthlyPlanValue(
          subscription.plan.priceInPaisa,
          subscription.plan.billingCycle,
        )
      );
    }, 0);
    const quotaRiskCustomers = customers.filter((customer) => {
      const contactPercent = usagePercent(customer._count.contacts, customer.contactLimit);
      const agentPercent = usagePercent(customer._count.users, customer.agentLimit);
      const campaignPercent = usagePercent(
        customer._count.campaigns,
        customer.campaignLimit,
      );
      return Math.max(contactPercent, agentPercent, campaignPercent) >= 70;
    }).length;
    const unplannedCustomers = customers.filter(
      (customer) => !customer.subscriptions?.[0],
    ).length;
    const adminAttentionCustomers = customers.filter(needsAdminAttention).length;
    return {
      totalCustomers: customers.length,
      activeCustomers,
      estimatedMrrInPaisa,
      quotaRiskCustomers,
      unplannedCustomers,
      adminAttentionCustomers,
    };
  }, [customers]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-slate-500">
            Business accounts under your agency, provisioned from the live plan catalog.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void refresh(search);
            }}
          >
            <input
              className="w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:w-64"
              placeholder="Search customers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="submit"
              disabled={customersLoading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Search
            </button>
          </form>
          <button
            type="button"
            onClick={() => void refresh(search)}
            disabled={customersLoading}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {customersLoading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add customer
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Total customers"
          value={formatNumber(portfolioSummary.totalCustomers)}
          detail={`${formatNumber(portfolioSummary.activeCustomers)} active`}
        />
        <SummaryCard
          label="Estimated partner MRR"
          value={formatMoney(portfolioSummary.estimatedMrrInPaisa)}
          detail="Monthly equivalent from active plans"
        />
        <SummaryCard
          label="Quota risk"
          value={formatNumber(portfolioSummary.quotaRiskCustomers)}
          detail="At or above 70% of a key limit"
        />
        <SummaryCard
          label="Admin attention"
          value={formatNumber(portfolioSummary.adminAttentionCustomers)}
          detail="No admin, unverified, or never logged in"
        />
        <SummaryCard
          label="No plan"
          value={formatNumber(portfolioSummary.unplannedCustomers)}
          detail="Customers using manual defaults"
        />
      </div>

      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

      {adminResetResult && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Temporary admin password generated
              </p>
              <p className="mt-1 text-sm text-amber-800">
                {adminResetResult.admin.name} ({adminResetResult.admin.email}) can
                sign in to {adminResetResult.customerName}. Show this password once
                and ask them to change it immediately.
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-md bg-white px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Login
                  </p>
                  <p className="mt-1 break-all font-mono text-slate-800">
                    {adminResetResult.loginUrl}
                  </p>
                </div>
                <div className="rounded-md bg-white px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Temporary password
                  </p>
                  <p className="mt-1 font-mono text-slate-900">
                    {adminResetResult.temporaryPassword}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${adminResetResult.loginUrl}\n${adminResetResult.admin.email}\n${adminResetResult.temporaryPassword}`,
                  )
                }
                className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Copy access
              </button>
              <button
                type="button"
                onClick={() => setAdminResetResult(null)}
                className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={createCustomer}
          className="mb-6 rounded-lg border border-slate-200 bg-white p-4 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              Business name
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="Cutz & Bangs"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Industry pack
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="salon, clinic, real estate..."
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Admin name
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="Workspace owner"
                value={form.adminName}
                onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                required
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Admin email
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                type="email"
                placeholder="owner@example.com"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                required
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Temporary password
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                type="password"
                placeholder="Minimum 8 characters"
                value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                required
                minLength={8}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Plan
              <select
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                value={form.planId}
                onChange={(e) => setForm({ ...form, planId: e.target.value })}
              >
                <option value="">No plan — manual defaults</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.displayName} · {formatMoney(plan.priceInPaisa)}/
                    {billingLabel(plan.billingCycle)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            {selectedPlan ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {selectedPlan.displayName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedPlan.description ||
                      "Limits and features are managed by SuperAdmin."}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    {selectedPlan.features.slice(0, 6).map((feature) => (
                      <span key={feature} className="rounded-md bg-white px-2 py-1">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-white p-3 text-sm">
                  <p className="text-2xl font-semibold text-slate-900">
                    {formatMoney(selectedPlan.priceInPaisa)}
                    <span className="text-sm font-medium text-slate-500">
                      /{billingLabel(selectedPlan.billingCycle)}
                    </span>
                  </p>
                  <dl className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between gap-3">
                      <dt>Contacts</dt>
                      <dd>{formatNumber(selectedPlan.contactLimit)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Messages</dt>
                      <dd>{formatNumber(selectedPlan.messageQuota)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Agents</dt>
                      <dd>{formatNumber(selectedPlan.agentLimit)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Campaigns</dt>
                      <dd>{formatNumber(selectedPlan.campaignLimit)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                No plan selected. The customer will use the partner default limits.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={form.seedStarterPack}
              onChange={(e) => setForm({ ...form, seedStarterPack: e.target.checked })}
            />
            Seed starter templates, first campaign, and demo chatbot flow
          </label>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create customer"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          Showing {formatNumber(filteredCustomers.length)} of{" "}
          {formatNumber(customers.length)} customers
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter customers by status"
          >
            <option value="ALL">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={planFilter}
            onChange={(event) => setPlanFilter(event.target.value)}
            aria-label="Filter customers by plan"
          >
            <option value="ALL">All plans</option>
            <option value="NO_PLAN">No plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.displayName}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={usageFilter}
            onChange={(event) => setUsageFilter(event.target.value)}
            aria-label="Filter customers by quota usage"
          >
            <option value="ALL">All usage</option>
            <option value="AT_RISK">At risk (70%+)</option>
            <option value="OVER_LIMIT">Over limit (100%+)</option>
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={adminHealthFilter}
            onChange={(event) => setAdminHealthFilter(event.target.value)}
            aria-label="Filter customers by admin health"
          >
            <option value="ALL">All admins</option>
            <option value="ATTENTION">Needs attention</option>
            <option value="NO_ADMIN">No admin</option>
            <option value="UNVERIFIED">Admin unverified</option>
            <option value="NEVER_LOGIN">Admin never logged in</option>
          </select>
          <button
            type="button"
            onClick={exportFilteredCustomers}
            disabled={filteredCustomers.length === 0}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Usage</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((c) => {
              const activeSubscription = c.subscriptions?.[0];
              const contactPercent = usagePercent(c._count.contacts, c.contactLimit);
              const agentPercent = usagePercent(c._count.users, c.agentLimit);
              const campaignPercent = usagePercent(c._count.campaigns, c.campaignLimit);
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{c.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Created {new Date(c.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {c.primaryAdmin ? (
                      <div className="min-w-56 space-y-2">
                        <div>
                          <p className="font-medium text-slate-800">
                            {c.primaryAdmin.name}
                          </p>
                          <a
                            href={`mailto:${c.primaryAdmin.email}`}
                            className="break-all text-xs text-indigo-600 hover:text-indigo-700"
                          >
                            {c.primaryAdmin.email}
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusBadgeClass(
                              c.primaryAdmin.status,
                            )}`}
                          >
                            {c.primaryAdmin.status}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                              c.primaryAdmin.emailVerified
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-amber-50 text-amber-700 ring-amber-200"
                            }`}
                          >
                            {c.primaryAdmin.emailVerified ? "Verified" : "Unverified"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Last login: {formatDateTime(c.primaryAdmin.lastLoginAt)}
                        </p>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200">
                        No admin
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      {activeSubscription ? (
                        <div>
                          <p className="font-medium text-slate-800">
                            {activeSubscription.plan.displayName}
                          </p>
                          <p className="text-xs text-slate-500">
                            Renews{" "}
                            {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString(
                              "en-IN",
                            )}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                          No plan
                        </span>
                      )}
                      <select
                        className="w-full min-w-40 rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                        value={activeSubscription?.plan.id ?? ""}
                        disabled={plans.length === 0 || changingPlanCustomerId === c.id}
                        onChange={(e) => void changeCustomerPlan(c.id, e.target.value)}
                        aria-label={`Change plan for ${c.name}`}
                      >
                        <option value="" disabled>
                          Select plan
                        </option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.displayName} · {formatMoney(plan.priceInPaisa)}/
                            {billingLabel(plan.billingCycle)}
                          </option>
                        ))}
                      </select>
                      {changingPlanCustomerId === c.id && (
                        <p className="text-xs text-indigo-600">Applying plan…</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="min-w-56 space-y-3">
                      <UsageBar
                        label="Contacts"
                        used={c._count.contacts}
                        limit={c.contactLimit}
                        percent={contactPercent}
                      />
                      <UsageBar
                        label="Agents"
                        used={c._count.users}
                        limit={c.agentLimit}
                        percent={agentPercent}
                      />
                      <UsageBar
                        label="Campaigns"
                        used={c._count.campaigns}
                        limit={c.campaignLimit}
                        percent={campaignPercent}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${statusBadgeClass(
                          c.status,
                        )}`}
                      >
                        {c.status}
                      </span>
                      {c.status === "ACTIVE" || c.status === "SUSPENDED" ? (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            disabled={changingStatusCustomerId === c.id}
                            onClick={() =>
                              void changeCustomerStatus(
                                c,
                                c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                              )
                            }
                            className="block rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {changingStatusCustomerId === c.id
                              ? "Updating…"
                              : c.status === "ACTIVE"
                                ? "Suspend"
                                : "Reactivate"}
                          </button>
                          <button
                            type="button"
                            disabled={resettingAdminCustomerId === c.id}
                            onClick={() => void resetCustomerAdminAccess(c)}
                            className="block rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {resettingAdminCustomerId === c.id
                              ? "Resetting…"
                              : "Reset admin pwd"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {customers.length === 0
                    ? "No customers yet."
                    : "No customers match the selected filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
  percent,
}: {
  label: string;
  used: number;
  limit: number;
  percent: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-500">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${usageTone(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
