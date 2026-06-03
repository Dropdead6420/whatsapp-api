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

type WalletType = "WHATSAPP_USAGE" | "AI_CREDIT" | "PARTNER_CREDIT";

interface Wallet {
  id: string;
  tenantId: string;
  type: WalletType;
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
  wallets?: Wallet[];
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

interface CustomerWalletsResponse {
  wallets: Wallet[];
  primaryWallet: Wallet;
  aiWallet: Wallet | null;
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
  wallet?: { id: string; type: WalletType } | null;
}

interface TransactionResponse {
  items: WalletTransaction[];
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  amountInPaisa: number;
  subtotalInPaisa: number;
  taxInPaisa: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  paymentOrderId: string | null;
  rechargeRequestId: string | null;
  paidAt: string | null;
  createdAt: string;
}

type WalletUsageCategory = "messaging" | "ai" | "workflow" | "other";
type UsageWindowDays = 7 | 30 | 90;

interface WalletUsageDay {
  day: string;
  messaging: number;
  ai: number;
  workflow: number;
  other: number;
  total: number;
}

interface WalletUsageSummary {
  windowDays: number;
  windowStartIso: string;
  totalDebited: number;
  byCategory: Record<WalletUsageCategory, number>;
  days: WalletUsageDay[];
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatDayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const STRIPE_JS_SRC = "https://js.stripe.com/v3/";

// Single-flight loaders so concurrent recharge clicks don't append
// duplicate <script> tags.
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

let stripeJsPromise: Promise<void> | null = null;
function loadStripeJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { Stripe?: unknown }).Stripe) {
    return Promise.resolve();
  }
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      stripeJsPromise = null;
      reject(new Error("Failed to load Stripe.js"));
    };
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}

type Gateway = "RAZORPAY" | "STRIPE";

const PRESET_RECHARGE_RUPEES = [500, 1000, 2000, 5000];
const USAGE_WINDOWS: UsageWindowDays[] = [7, 30, 90];
const CUSTOMER_WALLET_TYPES: Array<{
  key: Extract<WalletType, "WHATSAPP_USAGE" | "AI_CREDIT">;
  label: string;
  shortLabel: string;
  description: string;
  accent: string;
}> = [
  {
    key: "WHATSAPP_USAGE",
    label: "WhatsApp Usage Wallet",
    shortLabel: "WhatsApp",
    description: "Broadcasts, chat replies, templates, and Meta message spend.",
    accent: "from-emerald-500 to-teal-500",
  },
  {
    key: "AI_CREDIT",
    label: "AI Credit Wallet",
    shortLabel: "AI Credit",
    description: "AI agents, reply suggestions, scoring, and creative generation.",
    accent: "from-violet-500 to-indigo-500",
  },
];
const USAGE_CATEGORIES: Array<{
  key: WalletUsageCategory;
  label: string;
  barClass: string;
  badgeClass: string;
}> = [
  {
    key: "messaging",
    label: "Messaging",
    barClass: "bg-emerald-500",
    badgeClass: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "ai",
    label: "AI",
    barClass: "bg-violet-500",
    badgeClass: "bg-violet-50 text-violet-700",
  },
  {
    key: "workflow",
    label: "Workflow",
    barClass: "bg-sky-500",
    badgeClass: "bg-sky-50 text-sky-700",
  },
  {
    key: "other",
    label: "Other",
    barClass: "bg-slate-400",
    badgeClass: "bg-slate-100 text-slate-700",
  },
];

function statusClass(status: string) {
  return status === "ACTIVE"
    ? "bg-emerald-50 text-emerald-700"
    : "bg-red-50 text-red-700";
}

function walletLabel(type: WalletType) {
  return (
    CUSTOMER_WALLET_TYPES.find((wallet) => wallet.key === type)?.label ??
    type.replace(/_/g, " ")
  );
}

function shortWalletLabel(type: WalletType) {
  return (
    CUSTOMER_WALLET_TYPES.find((wallet) => wallet.key === type)?.shortLabel ??
    type.replace(/_/g, " ")
  );
}

function walletFor(row: WalletRow | undefined, type: WalletType) {
  if (!row) return null;
  return (
    row.wallets?.find((wallet) => wallet.type === type) ??
    (row.wallet.type === type ? row.wallet : null)
  );
}

export default function WalletsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN"],
  });
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedWalletType, setSelectedWalletType] =
    useState<WalletType>("WHATSAPP_USAGE");
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
  const [gateway, setGateway] = useState<Gateway>("RAZORPAY");

  // Manual bank transfer request (Claude FINAL §4 slice 6).
  const [manualAmount, setManualAmount] = useState("");
  const [manualProofUrl, setManualProofUrl] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [filingManual, setFilingManual] = useState(false);

  // Customer invoices (Claude FINAL §4 slice 9). Auto-issued on
  // every successful recharge — PDF URL is null until the PDF
  // generation worker fills it in.
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [usageWindow, setUsageWindow] = useState<UsageWindowDays>(30);
  const [usage, setUsage] = useState<WalletUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "WHITE_LABEL_ADMIN";
  const canSelfRecharge = user?.role === "BUSINESS_ADMIN";
  const selected = useMemo(
    () => rows.find((row) => row.tenant.id === selectedTenantId) ?? rows[0],
    [rows, selectedTenantId],
  );
  const selectedWallet = useMemo(
    () => walletFor(selected, selectedWalletType) ?? selected?.wallet ?? null,
    [selected, selectedWalletType],
  );

  async function loadWallets() {
    setErr(null);
    try {
      const data = await api.get<WalletListResponse>("/api/v1/wallets?limit=100");
      let items = data.items;
      if (canSelfRecharge && items[0]) {
        const customerWallets =
          await api.get<CustomerWalletsResponse>("/api/v1/customer/wallets");
        items = items.map((item, index) =>
          index === 0
            ? {
                ...item,
                wallet:
                  customerWallets.primaryWallet ??
                  customerWallets.wallets[0] ??
                  item.wallet,
                wallets: customerWallets.wallets,
              }
            : item,
        );
      }
      setRows(items);
      const first = items[0];
      setSelectedTenantId((current) => current || first?.tenant.id || "");
      if (first && !selectedTenantId) {
        syncSettings(walletFor(first, "WHATSAPP_USAGE") ?? first.wallet);
      }
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Failed to load wallets");
    }
  }

  async function loadTransactions(
    tenantId: string,
    walletType: WalletType = selectedWalletType,
  ) {
    if (!tenantId) return;
    try {
      const endpoint = canSelfRecharge
        ? `/api/v1/customer/wallets/ledger?limit=25&walletType=${walletType}`
        : `/api/v1/wallets/${tenantId}/transactions?limit=25&walletType=${walletType}`;
      const data = await api.get<TransactionResponse>(endpoint);
      setTransactions(data.items);
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Failed to load transactions");
    }
  }

  /**
   * Loads the customer's auto-issued invoices. Uses the customer
   * endpoint (server enforces tenant scope) so this works even for
   * BUSINESS_ADMIN users who can't hit the SuperAdmin /api/v1/wallets
   * paths. Silently swallows errors — the rest of the page is more
   * important than this list, and the UI degrades to an empty
   * "No invoices yet" gracefully.
   */
  async function loadInvoices() {
    try {
      const data = await api.get<Invoice[]>(
        `/api/v1/customer/wallets/invoices`,
      );
      setInvoices(data);
    } catch {
      setInvoices([]);
    }
  }

  /**
   * Loads the current tenant's debit-only usage graph. This intentionally
   * uses the customer endpoint, so only BUSINESS_ADMIN users call it.
   * Platform admins still have the full ledger through the selected
   * tenant management routes.
   */
  async function loadUsage(days: UsageWindowDays = usageWindow) {
    if (!canSelfRecharge) return;
    setUsageLoading(true);
    try {
      const data = await api.get<WalletUsageSummary>(
        `/api/v1/customer/wallets/usage?sinceDays=${days}&walletType=${selectedWalletType}`,
      );
      setUsage(data);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
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
    syncSettings(selectedWallet ?? selected.wallet);
    void loadTransactions(selected.tenant.id, selectedWalletType);
    if (canSelfRecharge) void loadInvoices();
  }, [
    selected?.tenant.id,
    selectedWalletType,
    selectedWallet?.id,
    canSelfRecharge,
  ]);

  useEffect(() => {
    if (!user || !canSelfRecharge) {
      setUsage(null);
      return;
    }
    void loadUsage(usageWindow);
  }, [user?.id, canSelfRecharge, usageWindow, selectedWalletType]);

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/wallets/${selected.tenant.id}/adjust`, {
        walletType: selectedWalletType,
        direction,
        amountCredits: Number(amountCredits),
        reason,
      });
      setNotice("Wallet adjusted and transaction recorded.");
      await loadWallets();
      await loadTransactions(selected.tenant.id, selectedWalletType);
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
        walletType: selectedWalletType,
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
        walletType: selectedWalletType,
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

  /**
   * Customer (BUSINESS_ADMIN) self-serve settings save. Hits the
   * tenant-scoped customer endpoint — which whitelists low-balance +
   * auto-recharge and rejects admin-only fields server-side — instead
   * of the SuperAdmin /wallets/:tenantId/settings PATCH.
   */
  async function saveCustomerSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSelfRecharge) return;
    setErr(null);
    setNotice(null);

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
      await api.put(`/api/v1/customer/wallets/settings`, {
        lowBalanceThreshold: Number(lowBalanceThreshold),
        autoRechargeEnabled,
        autoRechargeAmountCredits: Number(autoRechargeAmount),
        autoRechargePaymentProvider: autoRechargeProvider || null,
        autoRechargePaymentMethodToken: autoRechargeToken.trim() || null,
      });
      setNotice("Wallet settings saved.");
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
        walletType: selectedWalletType,
        amountCredits: Number(transferAmount),
        reason: transferReason,
      });
      setNotice("Credits transferred and both ledgers updated.");
      await loadWallets();
      await loadTransactions(selected.tenant.id, selectedWalletType);
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
      setErr("Pick a valid amount.");
      return;
    }
    setRecharging(true);
    try {
      // Smallest currency unit. INR/USD both use 1/100 — paise + cents.
      const amountSmallest = Math.round(rupees * 100);
      const idempotencyKey = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      // Stripe operates in USD on the customer-portal side by default;
      // Razorpay is INR-first. Either backend service ignores currency
      // if it's the wrong shape — server-side validation handles that.
      const currency = gateway === "STRIPE" ? "USD" : "INR";
      const result = await api.post<{
        orderId: string;
        status: string;
        replayed: boolean;
        init: {
          gatewayOrderId: string;
          amount: number;
          currency: string;
          stubMode: boolean;
          // Razorpay shape
          keyId?: string | null;
          // Stripe shape
          publishableKey?: string | null;
          clientSecret?: string | null;
        };
      }>("/api/v1/customer/wallets/recharge", {
        amount: amountSmallest,
        currency,
        idempotencyKey,
        gateway,
        walletType: selectedWalletType,
      });

      if (result.init.stubMode) {
        setNotice(
          `Stub-mode recharge created (order ${result.init.gatewayOrderId}). Configure ${
            gateway === "STRIPE"
              ? "STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY + STRIPE_WEBHOOK_SECRET"
              : "RAZORPAY_KEY_ID + RAZORPAY_WEBHOOK_SECRET"
          } to enable real payments.`,
        );
        return;
      }

      if (gateway === "STRIPE") {
        await handleStripeCheckout({ rupees, currency, result });
        return;
      }

      // ---- Razorpay path (default) ----
      if (!result.init.keyId) {
        setErr("Razorpay key not returned by server.");
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
            if (selected) void loadTransactions(selected.tenant.id, selectedWalletType);
            void loadInvoices();
            void loadUsage(usageWindow);
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

  /**
   * Stripe.js confirmPayment branch. Loads Stripe.js on demand,
   * mounts a minimal redirect-based flow via stripe.confirmPayment.
   * The webhook is the source of truth — we just kick off the
   * client-side confirmation and refresh after.
   */
  async function handleStripeCheckout(args: {
    rupees: number;
    currency: string;
    result: {
      init: {
        gatewayOrderId: string;
        publishableKey?: string | null;
        clientSecret?: string | null;
      };
    };
  }) {
    const { publishableKey, clientSecret } = args.result.init;
    if (!publishableKey || !clientSecret) {
      setErr("Stripe keys not returned by server.");
      return;
    }
    await loadStripeJs();
    const win = window as unknown as {
      Stripe?: (
        key: string,
      ) => {
        confirmPayment: (opts: {
          clientSecret: string;
          confirmParams: { return_url: string };
        }) => Promise<{ error?: { message?: string } }>;
      };
    };
    if (!win.Stripe) {
      setErr("Could not load Stripe.js. Refresh and try again.");
      return;
    }
    const stripe = win.Stripe(publishableKey);
    const ret = await stripe.confirmPayment({
      clientSecret,
      confirmParams: { return_url: window.location.href },
    });
    if (ret.error) {
      setErr(ret.error.message ?? "Stripe checkout failed.");
      return;
    }
    setNotice(
      "Payment submitted. Wallet will update once the webhook is processed (usually a few seconds).",
    );
    window.setTimeout(() => {
      void loadWallets();
      if (selected) void loadTransactions(selected.tenant.id, selectedWalletType);
      void loadInvoices();
      void loadUsage(usageWindow);
    }, 4000);
  }

  /**
   * File a manual bank-transfer recharge request. Customer pastes
   * the proof URL + UTR; SuperAdmin reviews + approves to credit the
   * wallet. The request is rate-limited by good sense — there's no
   * server-side rate cap because each request requires admin action
   * anyway.
   */
  async function fileManualRecharge() {
    setErr(null);
    setNotice(null);
    const rupees = Number(manualAmount);
    if (!Number.isFinite(rupees) || rupees < 1) {
      setErr("Pick a valid amount (minimum ₹1).");
      return;
    }
    setFilingManual(true);
    try {
      const body: Record<string, unknown> = {
        amount: Math.round(rupees * 100),
        currency: "INR",
        walletType: selectedWalletType,
      };
      const proof = manualProofUrl.trim();
      if (proof) body.proofUrl = proof;
      const ref = manualReference.trim();
      if (ref) body.reference = ref;
      const note = manualNote.trim();
      if (note) body.customerNote = note;
      await api.post("/api/v1/customer/wallets/recharge-requests", body);
      setNotice(
        "Bank transfer recorded. A SuperAdmin will review your proof and credit the wallet within 24 hours.",
      );
      setManualAmount("");
      setManualProofUrl("");
      setManualReference("");
      setManualNote("");
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Could not file the recharge request.",
      );
    } finally {
      setFilingManual(false);
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
              key={row.tenant.id}
              type="button"
              onClick={() => {
                setSelectedTenantId(row.tenant.id);
                syncSettings(walletFor(row, selectedWalletType) ?? row.wallet);
                void loadTransactions(row.tenant.id, selectedWalletType);
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
              <div className="mt-4 grid gap-2">
                {CUSTOMER_WALLET_TYPES.map((meta) => {
                  const wallet = walletFor(row, meta.key);
                  return (
                    <div
                      key={meta.key}
                      className="flex items-center justify-between rounded-md bg-white/70 px-2 py-1.5"
                    >
                      <span className="text-xs text-slate-500">
                        {meta.shortLabel}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatCredits(wallet?.balanceCredits ?? 0)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-slate-500">
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
              <section className="grid gap-4 md:grid-cols-2">
                {CUSTOMER_WALLET_TYPES.map((meta) => {
                  const wallet = walletFor(selected, meta.key);
                  const isActive = selectedWalletType === meta.key;
                  return (
                    <button
                      key={meta.key}
                      type="button"
                      onClick={() => setSelectedWalletType(meta.key)}
                      className={`overflow-hidden rounded-lg border bg-white text-left transition ${
                        isActive
                          ? "border-slate-900 shadow-sm"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className={`h-1.5 bg-gradient-to-r ${meta.accent}`} />
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-950">
                              {meta.label}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">
                              {meta.description}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              isActive
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isActive ? "Selected" : "View"}
                          </span>
                        </div>
                        <div className="mt-5 flex items-end justify-between gap-3">
                          <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Available credits
                            </div>
                            <div className="mt-1 text-3xl font-semibold text-slate-950">
                              {formatCredits(wallet?.balanceCredits ?? 0)}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(
                              wallet?.status ?? "ACTIVE",
                            )}`}
                          >
                            {wallet?.status ?? "ACTIVE"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </section>

              <section className="grid gap-4 md:grid-cols-4">
                <StatCard label="Balance" value={formatCredits(selectedWallet?.balanceCredits ?? 0)} />
                <StatCard label="Reserved" value={formatCredits(selectedWallet?.reservedCredits ?? 0)} />
                <StatCard label="Credit line" value={formatCredits(selectedWallet?.creditLimit ?? 0)} />
                <StatCard label="Low balance" value={formatCredits(selectedWallet?.lowBalanceThreshold ?? 0)} />
              </section>

              {canSelfRecharge && (
                <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-5">
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-emerald-900">
                        Add balance to {shortWalletLabel(selectedWalletType)}
                      </h2>
                      <p className="mt-0.5 text-xs text-emerald-800">
                        Recharge with Razorpay or Stripe. Funds credit to your
                        {` ${shortWalletLabel(selectedWalletType)} wallet once the payment webhook is captured.`}
                      </p>
                    </div>
                  </div>
                  <div className="mb-4 grid gap-2 sm:grid-cols-2">
                    {(["RAZORPAY", "STRIPE"] as Gateway[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setGateway(item)}
                        disabled={recharging}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                          gateway === item
                            ? "border-emerald-700 bg-white text-emerald-900 shadow-sm"
                            : "border-emerald-200 bg-white/70 text-emerald-800 hover:bg-white"
                        }`}
                      >
                        <span className="block font-semibold">
                          {item === "RAZORPAY" ? "Razorpay" : "Stripe"}
                        </span>
                        <span className="mt-0.5 block text-xs opacity-80">
                          {item === "RAZORPAY"
                            ? "INR checkout for India payments"
                            : "USD card checkout via PaymentIntent"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_RECHARGE_RUPEES.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setRechargeAmount(String(amount))}
                        className={`rounded-full px-3 py-1 text-sm font-medium ${
                          Number(rechargeAmount) === amount
                            ? "bg-emerald-700 text-white"
                            : "border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"
                        }`}
                        disabled={recharging}
                      >
                        {gateway === "STRIPE" ? "$" : "₹"}
                        {amount.toLocaleString("en-IN")}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-900">
                        Custom amount ({gateway === "STRIPE" ? "$" : "₹"})
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
                      {gateway === "STRIPE"
                        ? "Stripe amounts are sent in USD cents."
                        : "Each ₹1 → 100 wallet credits."}
                    </p>
                  </div>
                </section>
              )}

              {canSelfRecharge && (
                <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-5">
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold text-sky-900">
                      File a manual bank transfer for {shortWalletLabel(selectedWalletType)}
                    </h2>
                    <p className="mt-0.5 text-xs text-sky-800">
                      Already paid by NEFT/IMPS/UPI? Paste your proof and the
                      transaction reference — a SuperAdmin will credit your
                      selected wallet after reviewing (typically within 24 hours).
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-900">
                        Amount (₹)
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value)}
                        className="mt-1 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
                        disabled={filingManual}
                        placeholder="1000"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-900">
                        Reference (UTR / txn id)
                      </span>
                      <input
                        type="text"
                        value={manualReference}
                        onChange={(e) => setManualReference(e.target.value)}
                        className="mt-1 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
                        disabled={filingManual}
                        placeholder="UTR1234567890"
                        maxLength={80}
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-900">
                        Proof URL (link to receipt / screenshot)
                      </span>
                      <input
                        type="url"
                        value={manualProofUrl}
                        onChange={(e) => setManualProofUrl(e.target.value)}
                        className="mt-1 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
                        disabled={filingManual}
                        placeholder="https://files.example.com/receipt.pdf"
                        maxLength={1024}
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-900">
                        Note (optional — bank, payer name, etc.)
                      </span>
                      <textarea
                        value={manualNote}
                        onChange={(e) => setManualNote(e.target.value)}
                        className="mt-1 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
                        rows={2}
                        maxLength={1024}
                        disabled={filingManual}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void fileManualRecharge()}
                      disabled={filingManual || !manualAmount}
                      className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                    >
                      {filingManual ? "Filing…" : "File request"}
                    </button>
                    <p className="text-xs text-sky-800">
                      You can also check the status of past requests with your
                      account manager.
                    </p>
                  </div>
                </section>
              )}

              {canSelfRecharge && (
                <WalletUsageCard
                  usage={usage}
                  loading={usageLoading}
                  windowDays={usageWindow}
                  walletLabel={walletLabel(selectedWalletType)}
                  onWindowChange={setUsageWindow}
                />
              )}

              {canSelfRecharge && selectedWalletType === "WHATSAPP_USAGE" && (
                <section className="rounded-lg border border-slate-200 bg-white p-5">
                  <h2 className="text-sm font-semibold">Wallet settings</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Set your low-balance alert and (optionally) auto-recharge so
                    you never run out mid-campaign.
                  </p>
                  <form
                    onSubmit={saveCustomerSettings}
                    className="mt-4 grid gap-4 md:grid-cols-2"
                  >
                    <label className="block text-xs text-slate-600">
                      Low-balance alert (credits)
                      <input
                        value={lowBalanceThreshold}
                        onChange={(e) => setLowBalanceThreshold(e.target.value)}
                        type="number"
                        min={0}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex items-end">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={autoRechargeEnabled}
                          onChange={(e) => setAutoRechargeEnabled(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-xs font-medium text-slate-700">
                          Auto-recharge {autoRechargeEnabled ? "on" : "off"}
                        </span>
                      </label>
                    </div>
                    <label className="block text-xs text-slate-600">
                      Top-up amount (credits)
                      <input
                        value={autoRechargeAmount}
                        onChange={(e) => setAutoRechargeAmount(e.target.value)}
                        type="number"
                        min={0}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="e.g. 5000"
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      Payment provider
                      <select
                        value={autoRechargeProvider}
                        onChange={(e) =>
                          setAutoRechargeProvider(
                            e.target.value as AutoRechargeProvider,
                          )
                        }
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">— Select —</option>
                        <option value="razorpay">Razorpay</option>
                        <option value="stripe">Stripe</option>
                      </select>
                    </label>
                    <label className="block text-xs text-slate-600 md:col-span-2">
                      Saved payment method token
                      <input
                        value={autoRechargeToken}
                        onChange={(e) => setAutoRechargeToken(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Provider's saved-method reference"
                      />
                    </label>
                    <div className="md:col-span-2">
                      <button
                        type="submit"
                        disabled={savingAutoRecharge}
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {savingAutoRecharge ? "Saving…" : "Save wallet settings"}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {canManage && (
                <section className="grid gap-6 lg:grid-cols-3">
                  <form onSubmit={adjust} className="rounded-lg border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-semibold">
                      Manual adjustment
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Applies to {walletLabel(selectedWalletType)}.
                    </p>
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
                    <p className="mt-1 text-xs text-slate-500">
                      Applies to {walletLabel(selectedWalletType)}.
                    </p>
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
                          Top up {shortWalletLabel(selectedWalletType)} when the
                          balance drops below the low-balance alert above.
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
                    <p className="mt-1 text-xs text-slate-500">
                      Transfers {walletLabel(selectedWalletType)} credits.
                    </p>
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
                  {walletLabel(selectedWalletType)} ledger
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

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">
                      Invoices
                    </h2>
                    <p className="text-xs text-slate-500">
                      Auto-issued for every successful recharge. Download the
                      PDF once it's generated.
                    </p>
                  </div>
                </header>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv) => {
                      const major = inv.amountInPaisa / 100;
                      const amountLabel = (() => {
                        try {
                          return new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency: inv.currency,
                            maximumFractionDigits: 0,
                          }).format(major);
                        } catch {
                          return `${inv.currency} ${major.toLocaleString("en-IN")}`;
                        }
                      })();
                      return (
                        <tr key={inv.id}>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">
                            {inv.invoiceNumber}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {new Date(
                              inv.paidAt ?? inv.createdAt,
                            ).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {amountLabel}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                inv.status === "paid"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : inv.status === "failed"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {inv.pdfUrl ? (
                              <a
                                href={inv.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-700 underline hover:text-sky-900"
                              >
                                Download
                              </a>
                            ) : (
                              <span className="italic text-slate-400">
                                Generating…
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No invoices yet. They'll appear after your first
                          recharge.
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

function WalletUsageCard({
  usage,
  loading,
  windowDays,
  walletLabel,
  onWindowChange,
}: {
  usage: WalletUsageSummary | null;
  loading: boolean;
  windowDays: UsageWindowDays;
  walletLabel: string;
  onWindowChange: (days: UsageWindowDays) => void;
}) {
  const days = usage?.days ?? [];
  const maxTotal = Math.max(1, ...days.map((day) => day.total));
  const totalDebited = usage?.totalDebited ?? 0;
  const labelEvery = windowDays > 45 ? 14 : windowDays > 14 ? 7 : 1;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">
            {walletLabel} usage
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Daily debit breakdown across messaging, AI, workflow, and other
            wallet spend.
          </p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-1">
          {USAGE_WINDOWS.map((daysOption) => (
            <button
              key={daysOption}
              type="button"
              onClick={() => onWindowChange(daysOption)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                windowDays === daysOption
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {daysOption}d
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="rounded-lg bg-slate-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Debited in window
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {loading ? "..." : formatCredits(totalDebited)}
          </div>
          <div className="mt-3 grid gap-2">
            {USAGE_CATEGORIES.map((cat) => {
              const value = usage?.byCategory[cat.key] ?? 0;
              const percent =
                totalDebited > 0 ? Math.round((value / totalDebited) * 100) : 0;
              return (
                <div
                  key={cat.key}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${cat.badgeClass}`}
                  >
                    {cat.label}
                  </span>
                  <span className="font-semibold text-slate-700">
                    {formatCredits(value)} · {percent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-slate-100 p-4">
          {loading && !usage ? (
            <div className="flex h-36 items-center justify-center text-sm text-slate-500">
              Loading usage...
            </div>
          ) : days.length === 0 ? (
            <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-500">
              No usage yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex min-w-[520px] items-end gap-1.5 pb-1">
                {days.map((day, index) => {
                  const height = day.total
                    ? Math.max(8, Math.round((day.total / maxTotal) * 100))
                    : 2;
                  const showLabel =
                    index === 0 ||
                    index === days.length - 1 ||
                    index % labelEvery === 0;

                  return (
                    <div
                      key={day.day}
                      className="flex min-w-0 flex-1 flex-col items-center gap-2"
                      title={`${formatDayLabel(day.day)}: ${formatCredits(
                        day.total,
                      )} credits`}
                    >
                      <div className="flex h-36 w-full max-w-5 items-end rounded-full bg-slate-100">
                        <div
                          className="flex w-full flex-col-reverse overflow-hidden rounded-full"
                          style={{ height: `${height}%` }}
                        >
                          {USAGE_CATEGORIES.map((cat) => {
                            const value = day[cat.key];
                            if (!value || !day.total) return null;
                            return (
                              <span
                                key={cat.key}
                                className={cat.barClass}
                                style={{
                                  height: `${(value / day.total) * 100}%`,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <span
                        className={`h-4 whitespace-nowrap text-[10px] text-slate-400 ${
                          showLabel ? "" : "opacity-0"
                        }`}
                      >
                        {formatDayLabel(day.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
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
