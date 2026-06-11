"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Receipt, WalletCards } from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { GmbAdminConsole } from "../../../src/components/GmbAdminConsole";
import { useAuth } from "../../../src/hooks/useAuth";
import { api, ApiClientError } from "../../../src/lib/api";

type InvoiceStatus = "ALL" | "draft" | "sent" | "paid" | "failed";

interface InvoiceRow {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  amountInPaisa: number;
  subtotalInPaisa: number;
  taxInPaisa: number;
  currency: string;
  status: string;
  paymentOrderId: string | null;
  rechargeRequestId: string | null;
  razorpayInvoiceId: string | null;
  stripeInvoiceId: string | null;
  pdfUrl: string | null;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
  tenant: {
    name: string;
    type: string;
    status: string;
  } | null;
  currencySnapshot: {
    displayCurrency: string;
    displayAmountMinor: number;
    exchangeRateMicros: string | number;
  } | null;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toLocaleString("en-IN")}`;
  }
}

function statusTone(status: string): string {
  if (status === "paid") return "bg-emerald-50 text-emerald-700";
  if (status === "sent") return "bg-blue-50 text-blue-700";
  if (status === "draft") return "bg-amber-50 text-amber-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export default function GmbAdminInvoicesPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [status, setStatus] = useState<InvoiceStatus>("ALL");
  const [tenantQuery, setTenantQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (status !== "ALL") params.set("status", status);
      const data = await api.get<InvoiceRow[]>(
        `/api/v1/admin/payments/invoices?${params}`,
      );
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load invoices.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user, status]);

  const filtered = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.tenant?.name.toLowerCase().includes(q) ||
        row.invoiceNumber.toLowerCase().includes(q) ||
        row.tenantId.toLowerCase().includes(q),
    );
  }, [rows, tenantQuery]);

  const metrics = useMemo(
    () => ({
      invoices: filtered.length,
      paid: filtered.filter((row) => row.status === "paid").length,
      total: filtered.reduce((sum, row) => sum + row.amountInPaisa, 0),
      tax: filtered.reduce((sum, row) => sum + row.taxInPaisa, 0),
    }),
    [filtered],
  );

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} products={products} signOut={signOut}>
      <GmbAdminConsole
        title="Transaction Invoice"
        description="Track invoice rows generated from successful recharge orders and approved manual recharge requests."
      >
        <div className="space-y-5">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Invoices", value: metrics.invoices.toLocaleString(), icon: Receipt },
              { label: "Paid", value: metrics.paid.toLocaleString(), icon: FileText },
              { label: "Total value", value: money(metrics.total, "INR"), icon: WalletCards },
              { label: "Tax booked", value: money(metrics.tax, "INR"), icon: FileText },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                    <Icon className="h-4 w-4 text-blue-600" />
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{metric.value}</p>
                </div>
              );
            })}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Invoices</h2>
                <p className="text-xs text-slate-500">{filtered.length} rows shown</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={tenantQuery}
                  onChange={(event) => setTenantQuery(event.target.value)}
                  placeholder="Search tenant or invoice..."
                  className="min-w-[240px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as InvoiceStatus)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="ALL">All statuses</option>
                  <option value="paid">Paid</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
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
              <div className="p-8 text-sm text-slate-500">No invoices match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Invoice</th>
                      <th className="px-4 py-3 font-semibold">Customer</th>
                      <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                      <th className="px-4 py-3 text-right font-semibold">Tax</th>
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Source</th>
                      <th className="px-4 py-3 font-semibold">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-950">{row.invoiceNumber}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {new Date(row.createdAt).toLocaleString()}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">{row.id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{row.tenant?.name ?? "Unknown tenant"}</div>
                          <div className="mt-1 text-xs text-slate-500">{row.tenant?.type ?? "unknown"}</div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">{row.tenantId}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {money(row.subtotalInPaisa, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {money(row.taxInPaisa, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-950">
                          {money(row.amountInPaisa, row.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
                            {row.status}
                          </span>
                          <div className="mt-1 text-xs text-slate-500">
                            Due {new Date(row.dueAt).toLocaleDateString()}
                          </div>
                          {row.paidAt && (
                            <div className="text-xs text-emerald-700">
                              Paid {new Date(row.paidAt).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {row.paymentOrderId ? (
                            <>
                              Payment order
                              <div className="mt-1 font-mono text-[10px] text-slate-400">{row.paymentOrderId}</div>
                            </>
                          ) : row.rechargeRequestId ? (
                            <>
                              Manual recharge
                              <div className="mt-1 font-mono text-[10px] text-slate-400">{row.rechargeRequestId}</div>
                            </>
                          ) : (
                            "Subscription"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.pdfUrl ? (
                            <a
                              href={row.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">Not generated</span>
                          )}
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
