"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const CATEGORIES = [
  "CORE",
  "AI",
  "AUTOMATION",
  "BILLING",
  "INTEGRATION",
  "SUPPORT",
  "DEVELOPER",
  "COMPLIANCE",
  "MARKETING",
] as const;

interface ProductAddOn {
  key: string;
  name: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  isActive: boolean;
}

interface ProductRow {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  routeHref: string | null;
  featureKey: string | null;
  icon: string | null;
  isGlobalEnabled: boolean;
  sortOrder: number;
  addOns: ProductAddOn[];
  _count: {
    partnerAccesses: number;
    customerAccesses: number;
  };
}

interface TenantOption {
  id: string;
  name: string;
  status: string;
  parentTenantId?: string | null;
}

interface AdminProductsResponse {
  products: ProductRow[];
  partners: TenantOption[];
  customers: TenantOption[];
}

function formatMoney(paisa: number): string {
  return `₹${(paisa / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function categoryBadge(category: string): string {
  const map: Record<string, string> = {
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
  return map[category] ?? "bg-slate-100 text-slate-700";
}

export default function ProductsAdminPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [data, setData] = useState<AdminProductsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessTarget, setAccessTarget] = useState({
    partnerId: "",
    customerId: "",
    productKey: "",
  });
  const [addOnDraft, setAddOnDraft] = useState({
    key: "",
    name: "",
    description: "",
    priceInPaisa: "0",
    billingCycle: "monthly",
  });
  const [newProduct, setNewProduct] = useState({
    key: "",
    name: "",
    category: "CORE",
    routeHref: "",
    featureKey: "",
  });

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.get<AdminProductsResponse>("/api/v1/admin/products"));
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not load product catalog.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  const selectedProductKey =
    accessTarget.productKey || data?.products[0]?.key || "";
  const selectedProduct = useMemo(
    () => data?.products.find((product) => product.key === selectedProductKey) ?? null,
    [data?.products, selectedProductKey],
  );
  const productOptions = data?.products ?? [];

  const partnerById = useMemo(
    () => new Map((data?.partners ?? []).map((partner) => [partner.id, partner])),
    [data?.partners],
  );

  async function toggleProduct(product: ProductRow) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/v1/admin/products/${product.key}`, {
        isGlobalEnabled: !product.isGlobalEnabled,
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not update product.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/admin/products", {
        key: newProduct.key.trim(),
        name: newProduct.name.trim(),
        category: newProduct.category,
        routeHref: newProduct.routeHref.trim() || null,
        featureKey: newProduct.featureKey.trim() || null,
      });
      setNewProduct({
        key: "",
        name: "",
        category: "CORE",
        routeHref: "",
        featureKey: "",
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not create product.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function patchAccess(kind: "partner" | "customer", enabled: boolean) {
    if (!selectedProductKey) return;
    const targetId =
      kind === "partner" ? accessTarget.partnerId : accessTarget.customerId;
    if (!targetId) {
      setError(`Choose a ${kind === "partner" ? "partner" : "customer"} first.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path =
        kind === "partner"
          ? `/api/v1/admin/products/partners/${targetId}/${selectedProductKey}`
          : `/api/v1/admin/products/customers/${targetId}/${selectedProductKey}`;
      await api.patch(path, { enabled });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not update access.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createAddOn(event: FormEvent) {
    event.preventDefault();
    if (!selectedProductKey) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/admin/products/${selectedProductKey}/add-ons`, {
        key: addOnDraft.key.trim(),
        name: addOnDraft.name.trim(),
        description: addOnDraft.description.trim() || null,
        priceInPaisa: Number.parseInt(addOnDraft.priceInPaisa, 10) || 0,
        billingCycle: addOnDraft.billingCycle.trim() || "monthly",
      });
      setAddOnDraft({
        key: "",
        name: "",
        description: "",
        priceInPaisa: "0",
        billingCycle: "monthly",
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not create add-on.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleAddOn(addOn: ProductAddOn) {
    if (!selectedProductKey) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        `/api/v1/admin/products/${selectedProductKey}/add-ons/${addOn.key}`,
        { isActive: !addOn.isActive },
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not update add-on.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell
      user={user}
      features={features}
      products={products}
      signOut={signOut}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">
              Product marketplace
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Manage the global catalog, add-ons, and partner/customer access.
              Customer is the public label; Tenant remains the internal record.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <form
            onSubmit={createProduct}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3">
              <h2 className="text-sm font-black text-slate-950">
                Create product
              </h2>
              <p className="text-xs text-slate-500">
                Use snake_case keys. Route and feature key can be empty for
                purely informational products.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Key
                <input
                  value={newProduct.key}
                  onChange={(event) =>
                    setNewProduct((value) => ({
                      ...value,
                      key: event.target.value,
                    }))
                  }
                  placeholder="gmb_manager"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Name
                <input
                  value={newProduct.name}
                  onChange={(event) =>
                    setNewProduct((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  placeholder="GMB AI Manager"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Category
                <select
                  value={newProduct.category}
                  onChange={(event) =>
                    setNewProduct((value) => ({
                      ...value,
                      category: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Route
                <input
                  value={newProduct.routeHref}
                  onChange={(event) =>
                    setNewProduct((value) => ({
                      ...value,
                      routeHref: event.target.value,
                    }))
                  }
                  placeholder="/gmb"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                Legacy feature key
                <input
                  value={newProduct.featureKey}
                  onChange={(event) =>
                    setNewProduct((value) => ({
                      ...value,
                      featureKey: event.target.value,
                    }))
                  }
                  placeholder="developerPortal"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !newProduct.key || !newProduct.name}
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Create product
            </button>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-slate-950">
              Access controls
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              A partner can only grant products enabled for that partner.
              Customer overrides are stored separately.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-slate-600">
                Product
                <select
                  value={selectedProductKey}
                  onChange={(event) =>
                    setAccessTarget((value) => ({
                      ...value,
                      productKey: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                >
                  {productOptions.map((product) => (
                    <option key={product.key} value={product.key}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Partner
                <select
                  value={accessTarget.partnerId}
                  onChange={(event) =>
                    setAccessTarget((value) => ({
                      ...value,
                      partnerId: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                >
                  <option value="">Choose partner</option>
                  {(data?.partners ?? []).map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void patchAccess("partner", true)}
                    disabled={busy}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Enable partner
                  </button>
                  <button
                    type="button"
                    onClick={() => void patchAccess("partner", false)}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                  >
                    Disable partner
                  </button>
                </div>
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Customer
                <select
                  value={accessTarget.customerId}
                  onChange={(event) =>
                    setAccessTarget((value) => ({
                      ...value,
                      customerId: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                >
                  <option value="">Choose customer</option>
                  {(data?.customers ?? []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.parentTenantId
                        ? ` · ${partnerById.get(customer.parentTenantId)?.name ?? "Partner"}`
                        : " · Direct"}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void patchAccess("customer", true)}
                    disabled={busy}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Enable customer
                  </button>
                  <button
                    type="button"
                    onClick={() => void patchAccess("customer", false)}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                  >
                    Disable customer
                  </button>
                </div>
              </label>
            </div>
          </section>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <form
            onSubmit={createAddOn}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3">
              <h2 className="text-sm font-black text-slate-950">
                Add-on manager
              </h2>
              <p className="text-xs text-slate-500">
                Create paid add-ons for the selected product. These appear in
                partner and customer marketplace views.
              </p>
            </div>
            <label className="block text-xs font-semibold text-slate-600">
              Product
              <select
                value={selectedProductKey}
                onChange={(event) =>
                  setAccessTarget((value) => ({
                    ...value,
                    productKey: event.target.value,
                  }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                {productOptions.map((product) => (
                  <option key={product.key} value={product.key}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Add-on key
                <input
                  value={addOnDraft.key}
                  onChange={(event) =>
                    setAddOnDraft((value) => ({
                      ...value,
                      key: event.target.value,
                    }))
                  }
                  placeholder="priority_support"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Name
                <input
                  value={addOnDraft.name}
                  onChange={(event) =>
                    setAddOnDraft((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Priority support"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Price in paisa
                <input
                  type="number"
                  min="0"
                  value={addOnDraft.priceInPaisa}
                  onChange={(event) =>
                    setAddOnDraft((value) => ({
                      ...value,
                      priceInPaisa: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Billing cycle
                <select
                  value={addOnDraft.billingCycle}
                  onChange={(event) =>
                    setAddOnDraft((value) => ({
                      ...value,
                      billingCycle: event.target.value,
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="one_time">One-time</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                Description
                <input
                  value={addOnDraft.description}
                  onChange={(event) =>
                    setAddOnDraft((value) => ({
                      ...value,
                      description: event.target.value,
                    }))
                  }
                  placeholder="What this add-on unlocks for customers."
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !selectedProductKey || !addOnDraft.key || !addOnDraft.name}
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Create add-on
            </button>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-slate-950">
                  {selectedProduct?.name ?? "Selected product"} add-ons
                </h2>
                <p className="text-xs text-slate-500">
                  Toggle add-ons active/inactive without deleting historical
                  catalog records.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                {selectedProduct?.addOns.length ?? 0} add-ons
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {!selectedProduct || selectedProduct.addOns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  No add-ons yet for this product.
                </div>
              ) : (
                selectedProduct.addOns.map((addOn) => (
                  <div
                    key={addOn.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-950">
                        {addOn.name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500">
                        {addOn.key} · {formatMoney(addOn.priceInPaisa)}/
                        {addOn.billingCycle}
                      </div>
                      {addOn.description && (
                        <div className="mt-1 text-xs text-slate-500">
                          {addOn.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAddOn(addOn)}
                      disabled={busy}
                      className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                        addOn.isActive
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      } disabled:opacity-50`}
                    >
                      {addOn.isActive ? "Active" : "Inactive"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-black text-slate-950">
              Product catalog
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3 text-right">Access rows</th>
                  <th className="px-4 py-3">Add-ons</th>
                  <th className="px-4 py-3 text-right">Global</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.products ?? []).map((product) => (
                  <tr key={product.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">
                        {product.name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500">
                        {product.key}
                      </div>
                      <span
                        className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${categoryBadge(product.category)}`}
                      >
                        {product.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {product.routeHref ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {product.featureKey ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {product._count.partnerAccesses} partner /{" "}
                      {product._count.customerAccesses} customer
                    </td>
                    <td className="px-4 py-3">
                      {product.addOns.length === 0 ? (
                        <span className="text-xs text-slate-400">No add-ons</span>
                      ) : (
                        <div className="space-y-1">
                          {product.addOns.map((addOn) => (
                            <div
                              key={addOn.key}
                              className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600"
                            >
                              <span className="font-semibold text-slate-800">
                                {addOn.name}
                              </span>{" "}
                              · {formatMoney(addOn.priceInPaisa)}/
                              {addOn.billingCycle}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void toggleProduct(product)}
                        disabled={busy}
                        className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                          product.isGlobalEnabled
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        } disabled:opacity-50`}
                      >
                        {product.isGlobalEnabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
