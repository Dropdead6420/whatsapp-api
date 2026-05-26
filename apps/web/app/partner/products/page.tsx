"use client";

// Partner catalog inventory — REAL backend integration.
//
// The Gemini /partner/products page faked a "build once, distribute to
// every client" library backed by localStorage. That doesn't reflect
// reality: Meta requires per-WABA template submission, and Service /
// ChatbotFlow rows are tenant-scoped — partners can't push a template
// into all customer accounts in one click.
//
// Honest read: a portfolio inventory. GET /api/v1/partner/catalog
// aggregates WhatsApp templates, chatbot flows, and salon-style
// services across the partner's child tenants and surfaces who has
// what.

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface TenantCount {
  tenantId: string;
  tenantName: string;
  count: number;
}

interface TemplateItem {
  id: string;
  tenantId: string;
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
  tenantId: string;
  tenantName: string;
  name: string;
  isActive: boolean;
  trigger: string;
  aiIntentEnabled: boolean;
  updatedAt: string;
}

interface ServiceItem {
  id: string;
  tenantId: string;
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
  services: {
    total: number;
    byTenant: TenantCount[];
    items: ServiceItem[];
  };
}

type Tab = "templates" | "flows" | "services";

function rupees(paisa: number): string {
  return `₹${(paisa / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
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

function statusBadge(status: string): string {
  const s = status.toUpperCase();
  if (s === "APPROVED" || s === "ACTIVE") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (s === "PENDING" || s === "SUBMITTED") {
    return "bg-amber-100 text-amber-800";
  }
  if (s === "REJECTED" || s === "FAILED" || s === "DISABLED") {
    return "bg-red-100 text-red-800";
  }
  return "bg-slate-100 text-slate-700";
}

export default function PartnerCatalogPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("templates");

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<CatalogResponse>("/api/v1/partner/catalog");
      setCatalog(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load catalog: ${e.message}`
          : "Failed to load catalog.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const active = catalog?.[tab];

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Portfolio catalog
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Reusable assets across every customer tenant — WhatsApp templates,
            chatbot flows, and service bundles. Each asset is created inside a
            specific customer&apos;s workspace; this view aggregates them so
            you can spot gaps and standards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Totals */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="WhatsApp templates"
          value={catalog?.templates.total ?? 0}
          accent={tab === "templates" ? "emerald" : "slate"}
          onClick={() => setTab("templates")}
        />
        <StatCard
          label="Chatbot flows"
          value={catalog?.flows.total ?? 0}
          accent={tab === "flows" ? "emerald" : "slate"}
          onClick={() => setTab("flows")}
        />
        <StatCard
          label="Service bundles"
          value={catalog?.services.total ?? 0}
          accent={tab === "services" ? "emerald" : "slate"}
          onClick={() => setTab("services")}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 text-xs">
        {(["templates", "flows", "services"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 font-medium ${
              tab === t
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t === "templates"
              ? "Templates"
              : t === "flows"
                ? "Flows"
                : "Services"}
          </button>
        ))}
      </div>

      {/* Distribution: count per tenant */}
      {active && active.byTenant.length > 0 && (
        <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            By tenant
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {active.byTenant.map((row) => (
              <li
                key={row.tenantId}
                className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <span className="truncate font-medium text-slate-700">
                  {row.tenantName}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Asset table */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {active && active.items.length === 0 && !busy && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No {tab} created across your portfolio yet.
          </div>
        )}
        {active && active.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                {tab === "templates" && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Tenant</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 font-semibold">Language</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Messages
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Updated
                    </th>
                  </tr>
                )}
                {tab === "flows" && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Tenant</th>
                    <th className="px-3 py-2 font-semibold">Trigger</th>
                    <th className="px-3 py-2 font-semibold">AI intent</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Updated
                    </th>
                  </tr>
                )}
                {tab === "services" && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Tenant</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Duration
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Price
                    </th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Updated
                    </th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tab === "templates" &&
                  (active.items as TemplateItem[]).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {t.name}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {t.tenantName}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {t.category}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {t.language}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge(t.status)}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {t.messageCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">
                        {formatDate(t.updatedAt)}
                      </td>
                    </tr>
                  ))}
                {tab === "flows" &&
                  (active.items as FlowItem[]).map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {f.name}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {f.tenantName}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {f.trigger}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {f.aiIntentEnabled ? (
                          <span className="text-emerald-700">Enabled</span>
                        ) : (
                          <span className="text-slate-400">Off</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            f.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {f.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">
                        {formatDate(f.updatedAt)}
                      </td>
                    </tr>
                  ))}
                {tab === "services" &&
                  (active.items as ServiceItem[]).map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {s.name}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {s.tenantName}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {s.durationMinutes} min
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {rupees(s.priceInPaisa)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            s.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {s.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">
                        {formatDate(s.updatedAt)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Note:</strong> Each asset lives inside one customer&apos;s
        workspace. Meta requires per-WABA template submission so partners
        can&apos;t broadcast a template to every customer in one click; the
        same applies to chatbot flows (tenant-scoped) and service bundles
        (priced per-business). Use this view to spot gaps and standardize
        across your portfolio.
      </div>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald";
  onClick?: () => void;
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200",
  } as const;
  const numColor = {
    slate: "text-slate-900",
    emerald: "text-emerald-800",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition hover:shadow ${accents[accent]}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-2xl font-semibold ${numColor[accent]}`}
      >
        {value.toLocaleString()}
      </div>
    </button>
  );
}
