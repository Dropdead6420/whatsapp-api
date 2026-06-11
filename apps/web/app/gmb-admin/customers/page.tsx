"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Search, Users } from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { GmbAdminConsole } from "../../../src/components/GmbAdminConsole";
import { useAuth } from "../../../src/hooks/useAuth";
import { api, ApiClientError } from "../../../src/lib/api";

interface TenantRow {
  id: string;
  name: string;
  type: string;
  status: string;
  domain: string | null;
  createdAt: string;
  _count?: {
    users: number;
    contacts: number;
    campaigns: number;
  };
}

function statusTone(status: string): string {
  if (status === "ACTIVE") return "bg-emerald-50 text-emerald-700";
  if (status === "SUSPENDED") return "bg-amber-50 text-amber-700";
  if (status === "DELETED") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export default function GmbAdminCustomersPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<TenantRow[]>("/api/v1/tenants?limit=100");
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load customers.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.domain?.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q);
      const matchesType = type === "ALL" || row.type === type;
      const matchesStatus = status === "ALL" || row.status === status;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [query, rows, status, type]);

  const metrics = useMemo(
    () => ({
      customers: rows.filter((row) => row.type !== "WHITE_LABEL").length,
      partners: rows.filter((row) => row.type === "WHITE_LABEL").length,
      active: rows.filter((row) => row.status === "ACTIVE").length,
      contacts: rows.reduce((sum, row) => sum + (row._count?.contacts ?? 0), 0),
    }),
    [rows],
  );

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} products={products} signOut={signOut}>
      <GmbAdminConsole
        title="Customers"
        description="Review customer accounts, partner-owned businesses, and the operational footprint behind GMB services."
        actions={
          <Link
            href="/tenants/new"
            className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            Add customer
          </Link>
        }
      >
        <div className="space-y-5">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Customers", value: metrics.customers, icon: Users },
              { label: "Partners", value: metrics.partners, icon: Building2 },
              { label: "Active accounts", value: metrics.active, icon: Users },
              { label: "CRM contacts", value: metrics.contacts, icon: Search },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                    <Icon className="h-4 w-4 text-blue-600" />
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">
                    {metric.value.toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Customer directory</h2>
                <p className="text-xs text-slate-500">{filtered.length} accounts shown</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search customer, domain, id..."
                  className="min-w-[240px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="ALL">All types</option>
                  <option value="DIRECT">Direct</option>
                  <option value="WHITE_LABEL">Partner</option>
                  <option value="BUSINESS">Business</option>
                </select>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="DELETED">Deleted</option>
                </select>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </header>

            {filtered.length === 0 ? (
              <div className="p-8 text-sm text-slate-500">No customers match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Customer</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Users</th>
                      <th className="px-4 py-3 text-right font-semibold">Contacts</th>
                      <th className="px-4 py-3 text-right font-semibold">Campaigns</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/tenants/${row.id}`} className="font-semibold text-slate-950 hover:text-blue-700">
                            {row.name}
                          </Link>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">{row.id}</div>
                          {row.domain && <div className="mt-1 text-xs text-slate-500">{row.domain}</div>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{row.type}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">{row._count?.users ?? 0}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{row._count?.contacts ?? 0}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{row._count?.campaigns ?? 0}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(row.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </GmbAdminConsole>
    </DashboardShell>
  );
}
