"use client";

// SuperAdmin payment operations console (Claude FINAL §4 — payment
// logs + webhook logs). Read-only visibility into the recharge
// pipeline: PaymentOrders and the gateway webhooks that drive them.
// Two tabs, each with filter chips, backed by
// GET /api/v1/admin/payments/orders + /webhooks.

import { useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type Tab = "orders" | "webhooks";
type Gateway = "RAZORPAY" | "STRIPE";
type OrderStatus =
  | "CREATED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";
type SignatureStatus = "VALID" | "INVALID" | "MISSING";

interface PaymentOrderRow {
  id: string;
  tenantId: string;
  gateway: Gateway;
  amount: number;
  currency: string;
  status: OrderStatus;
  gatewayOrderId: string | null;
  ledgerTransactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  tenant: { name: string } | null;
  _count: { webhookLogs: number };
}

interface WebhookRow {
  id: string;
  gateway: Gateway;
  eventId: string;
  eventType: string;
  signatureStatus: SignatureStatus;
  paymentOrderId: string | null;
  duplicate: boolean;
  processingError: string | null;
  processedAt: string;
}

const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-50 text-amber-800",
  SUCCEEDED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-rose-50 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-500",
  EXPIRED: "bg-slate-100 text-slate-500",
};

const SIG_TONE: Record<SignatureStatus, string> = {
  VALID: "bg-emerald-50 text-emerald-700",
  INVALID: "bg-rose-50 text-rose-700",
  MISSING: "bg-amber-50 text-amber-800",
};

function money(smallestUnit: number, currency: string): string {
  const major = smallestUnit / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export default function PaymentsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [tab, setTab] = useState<Tab>("orders");
  const [gateway, setGateway] = useState<Gateway | "ALL">("ALL");
  const [orderStatus, setOrderStatus] = useState<OrderStatus | "ALL">("ALL");
  const [sigStatus, setSigStatus] = useState<SignatureStatus | "ALL">("ALL");

  const [orders, setOrders] = useState<PaymentOrderRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (tab === "orders") {
        const params = new URLSearchParams({ limit: "100" });
        if (gateway !== "ALL") params.set("gateway", gateway);
        if (orderStatus !== "ALL") params.set("status", orderStatus);
        const data = await api.get<PaymentOrderRow[]>(
          `/api/v1/admin/payments/orders?${params}`,
        );
        setOrders(data);
      } else {
        const params = new URLSearchParams({ limit: "100" });
        if (gateway !== "ALL") params.set("gateway", gateway);
        if (sigStatus !== "ALL") params.set("signatureStatus", sigStatus);
        const data = await api.get<WebhookRow[]>(
          `/api/v1/admin/payments/webhooks?${params}`,
        );
        setWebhooks(data);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load payment logs");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab, gateway, orderStatus, sigStatus]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Platform · Payments
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          Payment operations
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
          Read-only view of recharge orders and the gateway webhooks that
          drive them. Use it to trace a stuck recharge — order created →
          webhook received → signature verified → wallet credited.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
          {(["orders", "webhooks"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium ${
                tab === t
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {t === "orders" ? "Orders" : "Webhooks"}
            </button>
          ))}
        </div>

        <select
          value={gateway}
          onChange={(e) => setGateway(e.target.value as Gateway | "ALL")}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="ALL">All gateways</option>
          <option value="RAZORPAY">Razorpay</option>
          <option value="STRIPE">Stripe</option>
        </select>

        {tab === "orders" ? (
          <select
            value={orderStatus}
            onChange={(e) => setOrderStatus(e.target.value as OrderStatus | "ALL")}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">All statuses</option>
            {(
              [
                "CREATED",
                "PENDING",
                "SUCCEEDED",
                "FAILED",
                "CANCELLED",
                "EXPIRED",
              ] as OrderStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={sigStatus}
            onChange={(e) => setSigStatus(e.target.value as SignatureStatus | "ALL")}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">All signatures</option>
            <option value="VALID">Valid</option>
            <option value="INVALID">Invalid</option>
            <option value="MISSING">Missing</option>
          </select>
        )}

        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {tab === "orders" ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Gateway</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Gateway order</th>
                <th className="px-4 py-3">Hooks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {o.tenant?.name ?? "—"}
                    </div>
                    <div className="font-mono text-[10px] text-slate-400">
                      {o.tenantId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{o.gateway}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {money(o.amount, o.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ORDER_STATUS_TONE[o.status]}`}
                    >
                      {o.status}
                    </span>
                    {o.failureReason && (
                      <div className="mt-1 max-w-[200px] truncate text-[10px] text-rose-600" title={o.failureReason}>
                        {o.failureReason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                    {o.gatewayOrderId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {o._count.webhookLogs}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {busy ? "Loading…" : "No payment orders match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Gateway</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Signature</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {webhooks.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(w.processedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{w.gateway}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-900">{w.eventType}</div>
                    <div className="font-mono text-[10px] text-slate-400">
                      {w.eventId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SIG_TONE[w.signatureStatus]}`}
                    >
                      {w.signatureStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                    {w.paymentOrderId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {w.duplicate && (
                      <span className="mr-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        duplicate
                      </span>
                    )}
                    {w.processingError && (
                      <span className="text-rose-600" title={w.processingError}>
                        error
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {webhooks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    {busy ? "Loading…" : "No webhook logs match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </DashboardShell>
  );
}
