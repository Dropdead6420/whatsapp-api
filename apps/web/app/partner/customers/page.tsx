"use client";

import { useEffect, useState } from "react";
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
  const [changingPlanCustomerId, setChangingPlanCustomerId] = useState<string | null>(
    null,
  );

  async function refresh() {
    try {
      const res = await api.get<CustomerTenant[]>("/api/v1/partner/customers");
      setCustomers(res);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
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
        current.map((customer) => (customer.id === customerId ? updated : customer)),
      );
      setErr(null);
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Plan change failed");
    } finally {
      setChangingPlanCustomerId(null);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const selectedPlan = plans.find((plan) => plan.id === form.planId);

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-slate-500">
            Business accounts under your agency, provisioned from the live plan catalog.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add customer
        </button>
      </div>

      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

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

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Campaigns</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const activeSubscription = c.subscriptions?.[0];
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
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
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3">{c._count.contacts}</td>
                  <td className="px-4 py-3">{c._count.campaigns}</td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
