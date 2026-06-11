"use client";

// SuperAdmin payment settings + operations console.
// Credentials stay in Secret Vault/env; this page configures the operational
// enablement/copy layer and still exposes the existing payment logs below.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink, Info } from "lucide-react";
import { DashboardShell } from "../../src/components/DashboardShell";
import {
  ADMIN_SETTINGS_NAV,
  SettingsConsoleFrame,
  SettingsStatusPill,
} from "../../src/components/SettingsConsoleFrame";
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

interface PaymentGatewaySetting {
  gateway: string;
  label: string;
  description: string;
  enabled: boolean;
  mode: string;
  credentialHint: string | null;
  instructions: string | null;
  updatedAt?: string;
}

interface PaymentNotificationTemplate {
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  subject: string;
  message: string;
  updatedAt?: string;
}

interface PaymentSettingsResponse {
  gateways: PaymentGatewaySetting[];
  notifications: PaymentNotificationTemplate[];
}

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

function eventHintText() {
  return "Use :name, :email, :plan, :amount, :currency, :gateway, :transaction_id, :subscription_id, :status, :message, :app_name inside subjects and messages.";
}

export default function PaymentsPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [settings, setSettings] = useState<PaymentSettingsResponse | null>(null);
  const [expandedGateway, setExpandedGateway] = useState("RAZORPAY");
  const [expandedNotification, setExpandedNotification] = useState("PAYMENT_SUCCESS");
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<PaymentOrderRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyLogs, setBusyLogs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const enabledGatewayCount = useMemo(
    () => settings?.gateways.filter((item) => item.enabled).length ?? 0,
    [settings],
  );
  const notificationsEnabled = useMemo(
    () => settings?.notifications.some((item) => item.enabled) ?? false,
    [settings],
  );

  async function loadSettings() {
    setErr(null);
    try {
      setSettings(await api.get<PaymentSettingsResponse>("/api/v1/admin/payments/settings"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load payment settings");
    }
  }

  async function loadLogs(nextTab = tab) {
    setBusyLogs(true);
    try {
      if (nextTab === "orders") {
        setOrders(
          await api.get<PaymentOrderRow[]>("/api/v1/admin/payments/orders?limit=12"),
        );
      } else {
        setWebhooks(
          await api.get<WebhookRow[]>("/api/v1/admin/payments/webhooks?limit=12"),
        );
      }
    } catch {
      // Settings are the primary task here; log tables can stay empty on failure.
    } finally {
      setBusyLogs(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadSettings();
    void loadLogs("orders");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function patchGateway(
    gateway: string,
    patch: Partial<PaymentGatewaySetting>,
  ) {
    setBusyKey(`gateway:${gateway}`);
    setErr(null);
    setNotice(null);
    try {
      const saved = await api.patch<PaymentGatewaySetting>(
        `/api/v1/admin/payments/settings/gateways/${gateway}`,
        patch,
      );
      setSettings((current) =>
        current
          ? {
              ...current,
              gateways: current.gateways.map((item) =>
                item.gateway === saved.gateway ? saved : item,
              ),
            }
          : current,
      );
      setNotice(`${saved.label} settings saved.`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Gateway update failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function patchNotification(
    event: string,
    patch: Partial<PaymentNotificationTemplate>,
  ) {
    setBusyKey(`notification:${event}`);
    setErr(null);
    setNotice(null);
    try {
      const saved = await api.patch<PaymentNotificationTemplate>(
        `/api/v1/admin/payments/settings/notifications/${event}`,
        patch,
      );
      setSettings((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                item.event === saved.event ? saved : item,
              ),
            }
          : current,
      );
      setNotice(`${saved.label} template saved.`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Notification update failed");
    } finally {
      setBusyKey(null);
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
      <SettingsConsoleFrame activeKey="payments" navItems={ADMIN_SETTINGS_NAV}>
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Payment Notifications
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Configure customer email notifications for payment lifecycle events.
              </p>
            </div>
            <SettingsStatusPill enabled={notificationsEnabled} />
          </div>

          <div className="space-y-5 p-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <Info className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    Template placeholders
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {eventHintText()}
                  </p>
                </div>
              </div>
            </div>

            {(settings?.notifications ?? []).map((item) => {
              const open = expandedNotification === item.event;
              const saving = busyKey === `notification:${item.event}`;
              return (
                <NotificationCard
                  key={item.event}
                  item={item}
                  open={open}
                  saving={saving}
                  onToggle={() =>
                    setExpandedNotification(open ? "" : item.event)
                  }
                  onSave={(patch) => void patchNotification(item.event, patch)}
                />
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Payment Gateways
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Enable checkout options and keep gateway credentials routed through
                the existing Secret Vault and Razorpay/Stripe payment pipeline.
              </p>
            </div>
            <SettingsStatusPill
              enabled={enabledGatewayCount > 0}
              label={`${enabledGatewayCount} enabled`}
            />
          </div>

          <div className="divide-y divide-slate-100">
            {(settings?.gateways ?? []).map((item) => {
              const open = expandedGateway === item.gateway;
              const saving = busyKey === `gateway:${item.gateway}`;
              return (
                <GatewayCard
                  key={item.gateway}
                  item={item}
                  open={open}
                  saving={saving}
                  onToggle={() => setExpandedGateway(open ? "" : item.gateway)}
                  onSave={(patch) => void patchGateway(item.gateway, patch)}
                />
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Payment operations
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Existing read-only trace of recharge orders and gateway webhooks.
              </p>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 text-sm">
              {(["orders", "webhooks"] as Tab[]).map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => {
                    setTab(next);
                    void loadLogs(next);
                  }}
                  className={`px-3 py-1.5 font-semibold ${
                    tab === next
                      ? "bg-slate-950 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {next === "orders" ? "Orders" : "Webhooks"}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            {tab === "orders" ? (
              <OrdersTable busy={busyLogs} rows={orders} />
            ) : (
              <WebhooksTable busy={busyLogs} rows={webhooks} />
            )}
          </div>
        </section>
      </SettingsConsoleFrame>
    </DashboardShell>
  );
}

function NotificationCard({
  item,
  open,
  saving,
  onToggle,
  onSave,
}: {
  item: PaymentNotificationTemplate;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onSave: (patch: Partial<PaymentNotificationTemplate>) => void;
}) {
  const [enabled, setEnabled] = useState(item.enabled);
  const [subject, setSubject] = useState(item.subject);
  const [message, setMessage] = useState(item.message);

  useEffect(() => {
    setEnabled(item.enabled);
    setSubject(item.subject);
    setMessage(item.message);
  }, [item]);

  return (
    <article className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-950">
            {item.label}
          </span>
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {item.description}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <SettingsStatusPill enabled={item.enabled} />
          {open ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-700">
              Email status
            </legend>
            <div className="mt-3 flex gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={enabled}
                  onChange={() => setEnabled(true)}
                  className="h-4 w-4 accent-emerald-600"
                />
                Enable
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={!enabled}
                  onChange={() => setEnabled(false)}
                  className="h-4 w-4 accent-emerald-600"
                />
                Disable
              </label>
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">
              Email subject
            </span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">
              Email message
            </span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-emerald-500"
            />
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => onSave({ enabled, subject, message })}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save template"}
          </button>
        </div>
      )}
    </article>
  );
}

function GatewayCard({
  item,
  open,
  saving,
  onToggle,
  onSave,
}: {
  item: PaymentGatewaySetting;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onSave: (patch: Partial<PaymentGatewaySetting>) => void;
}) {
  const [enabled, setEnabled] = useState(item.enabled);
  const [mode, setMode] = useState(item.mode);
  const [instructions, setInstructions] = useState(item.instructions ?? "");

  useEffect(() => {
    setEnabled(item.enabled);
    setMode(item.mode);
    setInstructions(item.instructions ?? "");
  }, [item]);

  return (
    <article>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-950">
            {item.label}
          </span>
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {item.description}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <SettingsStatusPill enabled={item.enabled} />
          {open ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <fieldset>
              <legend className="text-sm font-semibold text-slate-700">
                Gateway status
              </legend>
              <div className="mt-3 flex gap-6 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={enabled}
                    onChange={() => setEnabled(true)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Enable
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={!enabled}
                    onChange={() => setEnabled(false)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Disable
                </label>
              </div>
            </fieldset>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">
                Mode
              </span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-emerald-500"
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            <button
              type="button"
              disabled={saving}
              onClick={() => onSave({ enabled, mode, instructions })}
              className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save gateway"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-700">
              Credential routing
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {item.credentialHint}
            </p>
            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">
                Operator instructions
              </span>
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={5}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-emerald-500"
              />
            </label>
            <Link
              href="/secret-vault"
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Open Secret Vault
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}

function OrdersTable({ rows, busy }: { rows: PaymentOrderRow[]; busy: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-3">When</th>
          <th className="px-4 py-3">Tenant</th>
          <th className="px-4 py-3">Gateway</th>
          <th className="px-4 py-3">Amount</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Hooks</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 text-xs text-slate-500">
              {new Date(row.createdAt).toLocaleString()}
            </td>
            <td className="px-4 py-3">
              <div className="font-medium text-slate-900">
                {row.tenant?.name ?? "—"}
              </div>
              <div className="font-mono text-[10px] text-slate-400">
                {row.tenantId}
              </div>
            </td>
            <td className="px-4 py-3 text-slate-700">{row.gateway}</td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              {money(row.amount, row.currency)}
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ORDER_STATUS_TONE[row.status]}`}
              >
                {row.status}
              </span>
            </td>
            <td className="px-4 py-3 text-slate-700">{row._count.webhookLogs}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
              {busy ? "Loading..." : "No payment orders yet."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function WebhooksTable({ rows, busy }: { rows: WebhookRow[]; busy: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-3">When</th>
          <th className="px-4 py-3">Gateway</th>
          <th className="px-4 py-3">Event</th>
          <th className="px-4 py-3">Signature</th>
          <th className="px-4 py-3">Order</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 text-xs text-slate-500">
              {new Date(row.processedAt).toLocaleString()}
            </td>
            <td className="px-4 py-3 text-slate-700">{row.gateway}</td>
            <td className="px-4 py-3">
              <div className="text-slate-900">{row.eventType}</div>
              <div className="font-mono text-[10px] text-slate-400">
                {row.eventId}
              </div>
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SIG_TONE[row.signatureStatus]}`}
              >
                {row.signatureStatus}
              </span>
            </td>
            <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
              {row.paymentOrderId ?? "—"}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
              {busy ? "Loading..." : "No webhook logs yet."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
