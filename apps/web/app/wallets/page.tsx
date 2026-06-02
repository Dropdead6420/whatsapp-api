"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface TenantSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  parentTenantId?: string | null;
}

interface Wallet {
  id: string;
  tenantId: string;
  status: "ACTIVE" | "SUSPENDED";
  billingMode: "PREPAID" | "POSTPAID";
  balanceCredits: number;
  reservedCredits: number;
  creditLimit: number;
  lowBalanceThreshold: number;
  autoRechargeEnabled: boolean;
  autoRechargeAmountCredits?: number;
  autoRechargePaymentProvider?: "razorpay" | "stripe" | null;
  autoRechargePaymentMethodToken?: string | null;
  updatedAt: string;
}

type AutoRechargeProvider = "razorpay" | "stripe" | "";

interface WalletRow {
  tenant: TenantSummary;
  wallet: Wallet;
}

interface WalletListResponse {
  items: WalletRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface WalletTransaction {
  id: string;
  type: string;
  direction: "CREDIT" | "DEBIT";
  amountCredits: number;
  balanceAfterCredits: number;
  reason: string;
  createdAt: string;
  actorUser?: { name: string; email: string } | null;
  counterpartyWallet?: {
    tenant: { id: string; name: string; type: string };
  } | null;
}

interface TransactionResponse {
  items: WalletTransaction[];
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Single-flight loader: subsequent calls return the same promise so
// concurrent recharge clicks don't append duplicate <script> tags.
let razorpayCheckoutPromise: Promise<void> | null = null;
function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) {
    return Promise.resolve();
  }
  if (razorpayCheckoutPromise) return razorpayCheckoutPromise;
  razorpayCheckoutPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayCheckoutPromise = null;
      reject(new Error("Failed to load Razorpay Checkout"));
    };
    document.head.appendChild(script);
  });
  return razorpayCheckoutPromise;
}

const PRESET_RECHARGE_RUPEES = [500, 1000, 2000, 5000];

function statusClass(status: string) {
  return status === "ACTIVE"
    ? "bg-emerald-50 text-emerald-700"
    : "bg-red-50 text-red-700";
}

export default function WalletsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN"],
  });
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [amountCredits, setAmountCredits] = useState("1000");
  const [reason, setReason] = useState("Manual wallet adjustment");

  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("PREPAID");
  const [status, setStatus] = useState<"ACTIVE" | "SUSPENDED">("ACTIVE");
  const [creditLimit, setCreditLimit] = useState("0");
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState("100");

  // Auto-recharge config (T-021). The back-end already runs the
  // scheduled scanAutoRecharge worker on these fields; this UI gives
  // the tenant a way to turn it on without filing a SuperAdmin ticket.
  const [autoRechargeEnabled, setAutoRechargeEnabled] = useState(false);
  const [autoRechargeAmount, setAutoRechargeAmount] = useState("0");
  const [autoRechargeProvider, setAutoRechargeProvider] =
    useState<AutoRechargeProvider>("");
  const [autoRechargeToken, setAutoRechargeToken] = useState("");
  const [savingAutoRecharge, setSavingAutoRecharge] = useState(false);

  const [toTenantId, setToTenantId] = useState("");
  const [transferAmount, setTransferAmount] = useState("500");
  const [transferReason, setTransferReason] = useState("Credit transfer");

  // Customer self-recharge (Claude FINAL §4). Amount is held in INR
  // (display units) and converted to paise before POSTing.
  const [rechargeAmount, setRechargeAmount] = useState("500");
  const [recharging, setRecharging] = useState(false);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "WHITE_LABEL_ADMIN";
  const selected = useMemo(
    () => rows.find((row) => row.tenant.id === selectedTenantId) ?? rows[0],
    [rows, selectedTenantId],
  );

  async function loadWallets() {
    setErr(null);
    try {
      const data = await api.get<WalletListResponse>("/api/v1/wallets?limit=100");
      setRows(data.items);
      const first = data.items[0];
      setSelectedTenantId((current) => current || first?.tenant.id || "");
      if (first && !selectedTenantId) {
        syncSettings(first.wallet);
      }
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Failed to load wallets");
    }
  }

  async function loadTransactions(tenantId: string) {
    if (!tenantId) return;
    try {
      const data = await api.get<TransactionResponse>(
        `/api/v1/wallets/${tenantId}/transactions?limit=25`,
      );
      setTransactions(data.items);
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Failed to load transactions");
    }
  }

  function syncSettings(wallet: Wallet) {
    setBillingMode(wallet.billingMode);
    setStatus(wallet.status);
    setCreditLimit(String(wallet.creditLimit));
    setLowBalanceThreshold(String(wallet.lowBalanceThreshold));
    setAutoRechargeEnabled(wallet.autoRechargeEnabled);
    setAutoRechargeAmount(String(wallet.autoRechargeAmountCredits ?? 0));
    setAutoRechargeProvider(
      (wallet.autoRechargePaymentProvider ?? "") as AutoRechargeProvider,
    );
    setAutoRechargeToken(wallet.autoRechargePaymentMethodToken ?? "");
  }

  useEffect(() => {
    if (!user) return;
    void loadWallets();
  }, [user]);

  useEffect(() => {
    if (!selected) return;
    setSelectedTenantId(selected.tenant.id);
    syncSettings(selected.wallet);
    void loadTransactions(selected.tenant.id);
  }, [selected?.tenant.id]);

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/wallets/${selected.tenant.id}/adjust`, {
        direction,
        amountCredits: Number(amountCredits),
        reason,
      });
      setNotice("Wallet adjusted and transaction recorded.");
      await loadWallets();
      await loadTransactions(selected.tenant.id);
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Adjustment failed");
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setErr(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/wallets/${selected.tenant.id}/settings`, {
        status,
        billingMode,
        creditLimit: Number(creditLimit),
        lowBalanceThreshold: Number(lowBalanceThreshold),
      });
      setNotice("Wallet settings saved.");
      await loadWallets();
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Settings update failed");
    }
  }

  async function saveAutoRecharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setErr(null);
    setNotice(null);

    // When the operator turns auto-recharge on, validate they've
    // filled the dependent fields. The back-end accepts partial
    // saves (each field is optional on the PATCH), but enabling
    // without an amount/provider would silently no-op every scan
    // — easy to miss, so we surface it here instead.
    if (autoRechargeEnabled) {
      const amount = Number(autoRechargeAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setErr("Recharge amount must be greater than 0 when auto-recharge is on.");
        return;
      }
      if (!autoRechargeProvider) {
        setErr("Pick a payment provider before turning auto-recharge on.");
        return;
      }
      if (!autoRechargeToken.trim()) {
        setErr("Add a saved payment method token before turning auto-recharge on.");
        return;
      }
    }

    setSavingAutoRecharge(true);
    try {
      await api.patch(`/api/v1/wallets/${selected.tenant.id}/settings`, {
        autoRechargeEnabled,
        autoRechargeAmountCredits: Number(autoRechargeAmount),
        autoRechargePaymentProvider: autoRechargeProvider || null,
        autoRechargePaymentMethodToken: autoRechargeToken.trim() || null,
      });
      setNotice("Auto-recharge config saved.");
      await loadWallets();
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Save failed");
    } finally {
      setSavingAutoRecharge(false);
    }
  }

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/wallets/transfer", {
        fromTenantId: selected.tenant.id,
        toTenantId,
        amountCredits: Number(transferAmount),
        reason: transferReason,
      });
      setNotice("Credits transferred and both ledgers updated.");
      await loadWallets();
      await loadTransactions(selected.tenant.id);
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Transfer failed");
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  /**
   * Customer self-recharge. Always targets the *current user's*
   * tenant — the server pins tenantId via JWT, so the selected row
   * in the sidebar is irrelevant for the request itself.
   *
   * Razorpay Checkout.js is loaded on demand the first time a user
   * clicks Recharge so we don't bloat every page load with their
   * script tag.
   */
  async function recharge(rupees: number) {
    setErr(null);
    setNotice(null);
    if (!Number.isFinite(rupees) || rupees < 1) {
      setErr("Pick a valid amount (minimum ₹1).");
      return;
    }
    setRecharging(true);
    try {
      const amountPaise = Math.round(rupees * 100);
      const idempotencyKey = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const result = await api.post<{
        orderId: string;
        status: string;
        replayed: boolean;
        init: {
          gatewayOrderId: string;
          keyId: string | null;
          amount: number;
          currency: string;
          stubMode: boolean;
        };
      }>("/api/v1/customer/wallets/recharge", {
        amount: amountPaise,
        currency: "INR",
        idempotencyKey,
        gateway: "RAZORPAY",
      });

      if (result.init.stubMode || !result.init.keyId) {
        // Dev / test env — no real Razorpay keys configured. The
        // PaymentOrder is created but no checkout happens; an
        // operator would simulate a payment.captured webhook by hand.
        setNotice(
          `Stub-mode recharge created (order ${result.init.gatewayOrderId}). Configure RAZORPAY_KEY_ID + RAZORPAY_WEBHOOK_SECRET to enable real payments.`,
        );
        return;
      }

      // Load Razorpay Checkout.js on demand. Resolves immediately if
      // already loaded.
      await loadRazorpayCheckout();
      const win = window as unknown as {
        Razorpay?: new (opts: Record<string, unknown>) => {
          open(): void;
        };
      };
      if (!win.Razorpay) {
        setErr("Could not load Razorpay Checkout. Refresh and try again.");
        return;
      }
      const checkout = new win.Razorpay({
        key: result.init.keyId,
        order_id: result.init.gatewayOrderId,
        amount: result.init.amount,
        currency: result.init.currency,
        name: "Wallet recharge",
        description: `${rupees} ${result.init.currency} credit`,
        handler: () => {
          setNotice(
            "Payment captured. Wallet will update once the webhook is processed (usually a few seconds).",
          );
          // The webhook is the source of truth; we just refetch a
          // few seconds later so the balance reflects the credit
          // without forcing a page reload.
          window.setTimeout(() => {
            void loadWallets();
            if (selected) void loadTransactions(selected.tenant.id);
          }, 4000);
        },
        modal: {
          ondismiss: () => {
            setNotice("Checkout dismissed. No payment was captured.");
          },
        },
      });
      checkout.open();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Recharge could not be initiated.",
      );
    } finally {
      setRecharging(false);
    }
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Wallets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage partner and customer credits with a complete transaction ledger.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          {rows.map((row) => (
            <button
              key={row.wallet.id}
              type="button"
              onClick={() => {
                setSelectedTenantId(row.tenant.id);
                syncSettings(row.wallet);
                void loadTransactions(row.tenant.id);
              }}
              className={`w-full rounded-lg border p-4 text-left text-sm ${
                selected?.tenant.id === row.tenant.id
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{row.tenant.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.tenant.type}</div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(row.wallet.status)}`}
                >
                  {row.wallet.status}
                </span>
              </div>
              <div className="mt-4 text-2xl font-semibold">
                {formatCredits(row.wallet.balanceCredits)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.wallet.billingMode} · limit {formatCredits(row.wallet.creditLimit)}
              </div>
            </button>
          ))}
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No wallets found.
            </div>
          )}
        </aside>

        <main className="space-y-6">
          {selected && (
            <>
              <section className="grid gap-4 md:grid-cols-4">
                <StatCard label="Balance" value={formatCredits(selected.wallet.balanceCredits)} />
                <StatCard label="Reserved" value={formatCredits(selected.wallet.reservedCredits)} />
                <StatCard label="Credit line" value={formatCredits(selected.wallet.creditLimit)} />
                <StatCard label="Low balance" value={formatCredits(selected.wallet.lowBalanceThreshold)} />
              </section>

              <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-emerald-900">Add balance</h2>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Recharge via Razorpay. Funds credit to your wallet once
                      the payment is captured.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_RECHARGE_RUPEES.map((rupees) => (
                    <button
                      key={rupees}
                      type="button"
                      onClick={() => setRechargeAmount(String(rupees))}
                      className={`rounded-full px-3 py-1 text-sm font-medium ${
                        Number(rechargeAmount) === rupees
                          ? "bg-emerald-700 text-white"
                          : "border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"
                      }`}
                      disabled={recharging}
                    >
                      ₹{rupees.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-900">
                      Custom amount (₹)
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={rechargeAmount}
                      onChange={(e) => setRechargeAmount(e.target.value)}
                      className="mt-1 w-40 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                      disabled={recharging}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void recharge(Number(rechargeAmount))}
                    disabled={recharging || !rechargeAmount}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {recharging ? "Starting…" : "Recharge"}
                  </button>
                  <p className="text-xs text-emerald-800">
                    Each ₹1 → 100 wallet credits.
                  </p>
                </div>
              </section>

              {canManage && (
                <section className="grid gap-6 lg:grid-cols-3">
                  <form onSubmit={adjust} className="rounded-lg border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-semibold">Manual adjustment</h2>
                    <select
                      value={direction}
                      onChange={(event) => setDirection(event.target.value as "CREDIT" | "DEBIT")}
                      className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="CREDIT">Credit</option>
                      <option value="DEBIT">Debit</option>
                    </select>
                    <input
                      value={amountCredits}
                      onChange={(event) => setAmountCredits(event.target.value)}
                      type="number"
                      min={1}
                      className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className="mt-3 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                      Record adjustment
                    </button>
                  </form>

                  <form onSubmit={saveSettings} className="rounded-lg border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-semibold">Settings</h2>
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value as "ACTIVE" | "SUSPENDED")}
                      className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                    <select
                      value={billingMode}
                      onChange={(event) => setBillingMode(event.target.value as "PREPAID" | "POSTPAID")}
                      className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="PREPAID">Prepaid</option>
                      <option value="POSTPAID">Postpaid</option>
                    </select>
                    <input
                      value={creditLimit}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      type="number"
                      min={0}
                      className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Credit limit"
                    />
                    <input
                      value={lowBalanceThreshold}
                      onChange={(event) => setLowBalanceThreshold(event.target.value)}
                      type="number"
                      min={0}
                      className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Low balance alert"
                    />
                    <button className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                      Save settings
                    </button>
                  </form>

                  <form
                    onSubmit={saveAutoRecharge}
                    className="rounded-lg border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold">Auto-recharge</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          Top up automatically when the balance drops below the
                          low-balance alert above.
                        </p>
                      </div>
                      <label className="inline-flex shrink-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={autoRechargeEnabled}
                          onChange={(event) =>
                            setAutoRechargeEnabled(event.target.checked)
                          }
                          disabled={!canManage}
                          className="h-4 w-4"
                        />
                        <span className="text-xs font-medium text-slate-700">
                          {autoRechargeEnabled ? "On" : "Off"}
                        </span>
                      </label>
                    </div>

                    <label className="mt-4 block text-xs text-slate-600">
                      Top-up amount (credits)
                      <input
                        value={autoRechargeAmount}
                        onChange={(event) => setAutoRechargeAmount(event.target.value)}
                        type="number"
                        min={0}
                        disabled={!canManage}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="e.g. 5000"
                      />
                    </label>

                    <label className="mt-3 block text-xs text-slate-600">
                      Payment provider
                      <select
                        value={autoRechargeProvider}
                        onChange={(event) =>
                          setAutoRechargeProvider(
                            event.target.value as AutoRechargeProvider,
                          )
                        }
                        disabled={!canManage}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">— select —</option>
                        <option value="razorpay">Razorpay</option>
                        <option value="stripe">Stripe</option>
                      </select>
                    </label>

                    <label className="mt-3 block text-xs text-slate-600">
                      Saved payment method token
                      <input
                        value={autoRechargeToken}
                        onChange={(event) => setAutoRechargeToken(event.target.value)}
                        type="text"
                        disabled={!canManage}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-xs"
                        placeholder="e.g. pm_xxx (Stripe) / token_xxx (Razorpay)"
                      />
                    </label>

                    <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                      The token is opaque to NexaFlow — your payment provider
                      generates and validates it. Live charge integrations
                      (T-021b) are stubs today; the scheduler will log a charge
                      attempt and record the result without actually billing
                      until the integration ships.
                    </p>

                    <button
                      disabled={!canManage || savingAutoRecharge}
                      className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {savingAutoRecharge ? "Saving..." : "Save auto-recharge"}
                    </button>
                  </form>

                  <form onSubmit={transfer} className="rounded-lg border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-semibold">Transfer credits</h2>
                    <select
                      value={toTenantId}
                      onChange={(event) => setToTenantId(event.target.value)}
                      required
                      className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Send to...</option>
                      {rows
                        .filter((row) => row.tenant.id !== selected.tenant.id)
                        .map((row) => (
                          <option key={row.tenant.id} value={row.tenant.id}>
                            {row.tenant.name}
                          </option>
                        ))}
                    </select>
                    <input
                      value={transferAmount}
                      onChange={(event) => setTransferAmount(event.target.value)}
                      type="number"
                      min={1}
                      className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <textarea
                      value={transferReason}
                      onChange={(event) => setTransferReason(event.target.value)}
                      className="mt-3 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                      Transfer
                    </button>
                  </form>
                </section>
              )}

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
                  Transaction ledger
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{tx.type.replace(/_/g, " ")}</div>
                          {tx.counterpartyWallet && (
                            <div className="text-xs text-slate-500">
                              {tx.counterpartyWallet.tenant.name}
                            </div>
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 font-semibold ${
                            tx.direction === "CREDIT" ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {tx.direction === "CREDIT" ? "+" : "-"}
                          {formatCredits(tx.amountCredits)}
                        </td>
                        <td className="px-4 py-3">{formatCredits(tx.balanceAfterCredits)}</td>
                        <td className="px-4 py-3 text-slate-600">{tx.reason}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </main>
      </div>
    </DashboardShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}
