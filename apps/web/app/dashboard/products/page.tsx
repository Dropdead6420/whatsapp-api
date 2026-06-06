"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Package,
  PlusCircle,
  ShieldAlert,
} from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { useAuth } from "../../../src/hooks/useAuth";
import {
  fetchCustomerProductAccess,
  type CustomerProductAccessResponse,
  type ProductAccessItem,
} from "../../../src/lib/api";

type StatusFilter = "all" | "enabled" | "disabled";

function formatMoney(paisa: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

function categoryTone(category: string): string {
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

function visibleProducts(
  products: ProductAccessItem[],
  category: string,
  status: StatusFilter,
) {
  return products.filter((product) => {
    const categoryMatch = category === "all" || product.category === category;
    const statusMatch =
      status === "all" ||
      (status === "enabled" ? product.enabled : !product.enabled);
    return categoryMatch && statusMatch;
  });
}

export default function DashboardProductsPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [access, setAccess] =
    useState<CustomerProductAccessResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("enabled");

  async function refresh() {
    setErr(null);
    try {
      setAccess(await fetchCustomerProductAccess());
    } catch {
      setErr("Could not load your product access.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  const categories = useMemo(() => {
    const values = new Set((access?.products ?? []).map((product) => product.category));
    return Array.from(values).sort();
  }, [access?.products]);

  const filteredProducts = useMemo(
    () => visibleProducts(access?.products ?? [], category, status),
    [access?.products, category, status],
  );
  const enabledCount =
    access?.products.filter((product) => product.enabled).length ?? 0;
  const disabledCount =
    access?.products.filter((product) => !product.enabled).length ?? 0;
  const addOns =
    access?.products.flatMap((product) =>
      product.enabled
        ? (product.addOns ?? []).map((addOn) => ({
            ...addOn,
            productName: product.name,
          }))
        : [],
    ) ?? [];

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
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              My products
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Modules and add-ons currently available for your customer
              workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </header>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {err}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Enabled products" value={enabledCount} />
          <MetricCard label="Disabled products" value={disabledCount} />
          <MetricCard label="Available add-ons" value={addOns.length} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(["enabled", "all", "disabled"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize ${
                    status === item
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400"
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {filteredProducts.map((product) => (
            <ProductCard key={product.key} product={product} />
          ))}
        </section>

        {filteredProducts.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No products match this filter.
          </div>
        )}

        {addOns.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <PlusCircle className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Available add-ons
                </h2>
                <p className="text-sm text-slate-500">
                  Add-ons are priced by the SuperAdmin catalog.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {addOns.map((addOn) => (
                <div
                  key={`${addOn.productName}:${addOn.key}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="text-sm font-semibold text-slate-950">
                    {addOn.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {addOn.productName}
                  </div>
                  <div className="mt-3 font-mono text-sm font-semibold text-slate-900">
                    {formatMoney(addOn.priceInPaisa)} / {addOn.billingCycle}
                  </div>
                  {addOn.description && (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {addOn.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-slate-950">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: ProductAccessItem }) {
  const href = product.routeHref ?? "/dashboard";
  return (
    <article
      className={`rounded-lg border bg-white p-5 shadow-sm ${
        product.enabled ? "border-slate-200" : "border-slate-200 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg ${
              product.enabled
                ? "bg-slate-950 text-white"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            <Package className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">
              {product.name}
            </h2>
            <div className="mt-1 font-mono text-xs text-slate-500">
              {product.key}
            </div>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${categoryTone(product.category)}`}
        >
          {product.category}
        </span>
      </div>

      {product.description && (
        <p className="mt-4 min-h-[2.5rem] text-sm leading-6 text-slate-500">
          {product.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
            product.enabled
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {product.enabled ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" />
          )}
          {product.enabled ? "Enabled" : "Disabled"}
        </span>
        {product.enabled && product.routeHref && (
          <a
            href={href}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Open
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {!product.enabled && product.disabledReason && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {product.disabledReason}
        </div>
      )}
    </article>
  );
}
