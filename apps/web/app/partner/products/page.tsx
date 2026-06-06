"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface PartnerProduct {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  routeHref: string | null;
  featureKey: string | null;
  enabledForPartner: boolean;
  globalEnabled: boolean;
  limits: unknown | null;
  source: string;
  addOns: Array<{
    key: string;
    name: string;
    priceInPaisa: number;
    billingCycle: string;
  }>;
}

interface CustomerProductState {
  enabled: boolean;
  explicitEnabled: boolean;
  source: string;
  limits: unknown | null;
}

interface PartnerCustomer {
  id: string;
  name: string;
  status: string;
  products: Record<string, CustomerProductState>;
}

interface PartnerAccessResponse {
  products: PartnerProduct[];
  customers: PartnerCustomer[];
}

interface TenantCount {
  tenantId: string;
  tenantName: string;
  count: number;
}

interface TemplateItem {
  id: string;
  tenantName: string;
  name: string;
  category: string;
  language: string;
  status: string;
  messageCount: number;
  updatedAt: string;
}

interface FlowItem {
  id: string;
  tenantName: string;
  name: string;
  isActive: boolean;
  trigger: string;
  aiIntentEnabled: boolean;
  updatedAt: string;
}

interface ServiceItem {
  id: string;
  tenantName: string;
  name: string;
  durationMinutes: number;
  priceInPaisa: number;
  isActive: boolean;
  updatedAt: string;
}

interface CatalogResponse {
  templates: { total: number; byTenant: TenantCount[]; items: TemplateItem[] };
  flows: { total: number; byTenant: TenantCount[]; items: FlowItem[] };
  services: { total: number; byTenant: TenantCount[]; items: ServiceItem[] };
}

type Tab = "access" | "inventory";
type InventoryTab = "templates" | "flows" | "services";

function formatMoney(paisa: number): string {
  return `₹${(paisa / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function badge(category: string): string {
  const styles: Record<string, string> = {
    CORE: "bg-slate-100 text-slate-700",
    AI: "bg-violet-100 text-violet-800",
    AUTOMATION: "bg-cyan-100 text-cyan-800",
    BILLING: "bg-emerald-100 text-emerald-800",
    INTEGRATION: "bg-blue-100 text-blue-800",
    SUPPORT: "bg-amber-100 text-amber-800",
    DEVELOPER: "bg-indigo-100 text-indigo-800",
    COMPLIANCE: "bg-red-100 text-red-800",
    MARKETING: "bg-pink-100 text-pink-800",
  };
  return styles[category] ?? "bg-slate-100 text-slate-700";
}

export default function PartnerProductsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [tab, setTab] = useState<Tab>("access");
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>("templates");
  const [access, setAccess] = useState<PartnerAccessResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const [accessData, catalogData] = await Promise.all([
        api.get<PartnerAccessResponse>("/api/v1/partner/products/access"),
        api.get<CatalogResponse>("/api/v1/partner/catalog"),
      ]);
      setAccess(accessData);
      setCatalog(catalogData);
    } catch (error) {
      setErr(
        error instanceof ApiClientError
          ? error.message
          : "Failed to load partner products.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  const enabledProducts = useMemo(
    () => (access?.products ?? []).filter((product) => product.enabledForPartner),
    [access?.products],
  );
  const inventory = catalog?.[inventoryTab];

  async function toggleCustomer(
    customer: PartnerCustomer,
    product: PartnerProduct,
    enabled: boolean,
  ) {
    setBusy(true);
    setErr(null);
    try {
      await api.patch(
        `/api/v1/partner/customers/${customer.id}/products/${product.key}`,
        { enabled },
      );
      await refresh();
    } catch (error) {
      setErr(
        error instanceof ApiClientError
          ? error.message
          : "Could not update customer access.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Product access
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Control which NexaFlow modules each customer can use. SuperAdmin
              controls the master catalog; partners can only grant products
              enabled for their partner account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
          {(["access", "inventory"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                tab === item
                  ? "bg-white text-slate-950"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              {item === "access" ? "Access matrix" : "Asset inventory"}
            </button>
          ))}
        </div>

        {tab === "access" && (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Partner products" value={enabledProducts.length} />
              <Stat
                label="Customers"
                value={access?.customers.length ?? 0}
              />
              <Stat
                label="Global catalog"
                value={access?.products.length ?? 0}
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] shadow-xl">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="min-w-[18rem] px-4 py-3">Product</th>
                      {(access?.customers ?? []).map((customer) => (
                        <th key={customer.id} className="min-w-[11rem] px-4 py-3">
                          {customer.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {(access?.products ?? []).map((product) => (
                      <tr key={product.id} className="align-top hover:bg-white/[0.03]">
                        <td className="px-4 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-white">
                                {product.name}
                              </div>
                              <div className="mt-1 font-mono text-xs text-slate-500">
                                {product.key}
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge(product.category)}`}
                            >
                              {product.category}
                            </span>
                          </div>
                          <p className="mt-2 max-w-md text-xs text-slate-400">
                            {product.description}
                          </p>
                          <div className="mt-2 text-xs">
                            {product.enabledForPartner ? (
                              <span className="text-emerald-300">
                                Enabled for partner
                              </span>
                            ) : (
                              <span className="text-red-300">
                                Disabled by SuperAdmin
                              </span>
                            )}
                          </div>
                          {product.addOns.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {product.addOns.map((addOn) => (
                                <span
                                  key={addOn.key}
                                  className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-300"
                                >
                                  {addOn.name} · {formatMoney(addOn.priceInPaisa)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        {(access?.customers ?? []).map((customer) => {
                          const state = customer.products[product.key];
                          const effectiveEnabled = Boolean(state?.enabled);
                          return (
                            <td key={customer.id} className="px-4 py-4">
                              <button
                                type="button"
                                disabled={busy || !product.enabledForPartner}
                                onClick={() =>
                                  void toggleCustomer(
                                    customer,
                                    product,
                                    !effectiveEnabled,
                                  )
                                }
                                className={`rounded-lg px-3 py-2 text-xs font-bold ${
                                  effectiveEnabled
                                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                                    : "bg-white/5 text-slate-300 ring-1 ring-white/10"
                                } disabled:cursor-not-allowed disabled:opacity-40`}
                              >
                                {effectiveEnabled ? "Enabled" : "Disabled"}
                              </button>
                              <div className="mt-2 text-[11px] text-slate-500">
                                Source: {state?.source ?? "GLOBAL"}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(access?.customers.length ?? 0) === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-400">
                  No customers are attached to this partner yet.
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "inventory" && (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <InventoryCard
                label="Templates"
                value={catalog?.templates.total ?? 0}
                active={inventoryTab === "templates"}
                onClick={() => setInventoryTab("templates")}
              />
              <InventoryCard
                label="Flows"
                value={catalog?.flows.total ?? 0}
                active={inventoryTab === "flows"}
                onClick={() => setInventoryTab("flows")}
              />
              <InventoryCard
                label="Services"
                value={catalog?.services.total ?? 0}
                active={inventoryTab === "services"}
                onClick={() => setInventoryTab("services")}
              />
            </div>

            {inventory && inventory.byTenant.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <h2 className="text-sm font-semibold text-white">By customer</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {inventory.byTenant.map((row) => (
                    <div
                      key={row.tenantId}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-slate-300">
                        {row.tenantName}
                      </span>
                      <span className="font-mono text-slate-100">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <InventoryTable tab={inventoryTab} catalog={catalog} />
          </section>
        )}
      </div>
    </PartnerShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-white">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function InventoryCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active
          ? "border-indigo-400/60 bg-indigo-500/15"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-white">
        {value.toLocaleString()}
      </div>
    </button>
  );
}

function InventoryTable({
  tab,
  catalog,
}: {
  tab: InventoryTab;
  catalog: CatalogResponse | null;
}) {
  const active = catalog?.[tab];
  if (!active || active.items.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-sm text-slate-400">
        No {tab} created across your customers yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04]">
      <table className="min-w-full text-sm">
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Detail</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {tab === "templates" &&
            (active.items as TemplateItem[]).map((item) => (
              <tr key={item.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-white">{item.name}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.tenantName}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.category} · {item.language} · {item.messageCount} msgs
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {item.status}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">
                  {formatDate(item.updatedAt)}
                </td>
              </tr>
            ))}
          {tab === "flows" &&
            (active.items as FlowItem[]).map((item) => (
              <tr key={item.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-white">{item.name}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.tenantName}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.trigger} · AI intent {item.aiIntentEnabled ? "on" : "off"}
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {item.isActive ? "Active" : "Inactive"}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">
                  {formatDate(item.updatedAt)}
                </td>
              </tr>
            ))}
          {tab === "services" &&
            (active.items as ServiceItem[]).map((item) => (
              <tr key={item.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium text-white">{item.name}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.tenantName}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.durationMinutes} min · {formatMoney(item.priceInPaisa)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {item.isActive ? "Active" : "Inactive"}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">
                  {formatDate(item.updatedAt)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
