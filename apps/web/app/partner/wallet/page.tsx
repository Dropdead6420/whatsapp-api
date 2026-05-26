"use client";

// Partner wallet page — REAL backend integration.
//
// Previous version was a localStorage mock that faked a balance + invented
// transactions. This rewrite reads from /api/v1/wallets/:tenantId and the
// transactions endpoint so what you see is what's in Postgres.
//
// Recharge: the existing payment integration (Razorpay/Stripe) is a stub
// until T-021b lands real provider keys. Until then we show a "manual
// recharge" workflow — operator submits an adjustment which posts to the
// ledger via /api/v1/wallets/:tenantId/adjust (permission-gated to
// WALLET_MANAGE; partners typically have it on their own tenant).

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

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
  autoRechargeAmountCredits: number | null;
  autoRechargePaymentProvider: string | null;
  lastAutoRechargeAt: string | null;
  lastAutoRechargeError: string | null;
}

interface WalletResponse {
  tenant: { id: string; name: string };
  wallet: Wallet;
}

interface TxItem {
  id: string;
  type: string;
  direction: "CREDIT" | "DEBIT";
  amountCredits: number;
  balanceAfterCredits: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  actorUser: { id: string; name: string; email: string } | null;
  createdAt: string;
}

interface TxResponse {
  items: TxItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const PRESET_PACKS = [
  { credits: 1_000, label: "Starter — 1,000 credits" },
  { credits: 5_000, label: "Growth — 5,000 credits" },
  { credits: 25_000, label: "Scale — 25,000 credits" },
  { credits: 100_000, label: "Enterprise — 100,000 credits" },
];

export default function PartnerWalletPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const tenantId = user?.tenantId ?? null;

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Recharge request form
  const [rechargeCredits, setRechargeCredits] = useState<number>(5_000);
  const [rechargeNote, setRechargeNote] = useState<string>("");
  const [rechargeMode, setRechargeMode] = useState<"preset" | "custom">("preset");
  const [customCredits, setCustomCredits] = useState<string>("");

  async function refreshWallet() {
    if (!tenantId) return;
    try {
      const data = await api.get<WalletResponse>(`/api/v1/wallets/${tenantId}`);
      setWallet(data.wallet);
      setTenantName(data.tenant.name);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load wallet: ${e.message}`
          : "Failed to load wallet.",
      );
    }
  }

  async function refreshTransactions() {
    if (!tenantId) return;
    try {
      const data = await api.get<TxResponse>(
        `/api/v1/wallets/${tenantId}/transactions?limit=25`,
      );
      setTransactions(data.items);
    } catch (e) {
      // Transactions failing is not page-fatal — the balance card is what
      // matters most. Log + continue.
      console.warn("[partner-wallet] transaction load failed", e);
    }
  }

  useEffect(() => {
    if (!user || !tenantId) return;
    void refreshWallet();
    void refreshTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenantId]);

  async function submitRechargeRequest(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    const credits =
      rechargeMode === "preset"
        ? rechargeCredits
        : Math.max(100, Math.floor(Number(customCredits) || 0));
    if (credits < 100) {
      setErr("Minimum recharge is 100 credits.");
      return;
    }
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      // Until T-021b ships Razorpay/Stripe, file as a manual adjustment.
      // The endpoint exists; only operators with WALLET_MANAGE on this
      // tenant can hit it. Partners typically have it for their own tenant.
      await api.post(`/api/v1/wallets/${tenantId}/adjust`, {
        direction: "CREDIT",
        type: "MANUAL_ADJUSTMENT",
        amountCredits: credits,
        reason: rechargeNote.trim() || `Self-service recharge: ${credits} credits`,
        referenceType: "PartnerRechargeRequest",
      });
      setNotice(
        `${credits.toLocaleString()} credits posted to ledger. Once T-021b ships payment integration you'll be billed for these; until then this acts as an admin top-up.`,
      );
      setRechargeNote("");
      setCustomCredits("");
      await refreshWallet();
      await refreshTransactions();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Recharge request failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }
  if (!tenantId) {
    return (
      <PartnerShell user={user} signOut={signOut}>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your user account is not associated with a tenant. Contact a
          SuperAdmin to assign you to a tenant before using the wallet.
        </div>
      </PartnerShell>
    );
  }

  const isLow =
    wallet !== null && wallet.balanceCredits <= wallet.lowBalanceThreshold;
  const isEmpty = wallet !== null && wallet.balanceCredits <= 0;

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
        <p className="mt-1 text-sm text-slate-600">
          {tenantName ? `${tenantName} · ` : ""}credits, ledger, and recharge.
          All numbers are live from your Postgres ledger.
        </p>
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            err
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      {/* Balance card */}
      <section
        className={`mb-6 rounded-lg border p-5 shadow-sm ${
          isEmpty
            ? "border-red-300 bg-red-50"
            : isLow
              ? "border-amber-300 bg-amber-50"
              : "border-slate-200 bg-white"
        }`}
      >
        {!wallet && <div className="text-sm text-slate-500">Loading balance…</div>}
        {wallet && (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Available balance
                </div>
                <div
                  className={`mt-1 font-mono text-3xl font-semibold ${
                    isEmpty
                      ? "text-red-900"
                      : isLow
                        ? "text-amber-900"
                        : "text-slate-900"
                  }`}
                >
                  {wallet.balanceCredits.toLocaleString()}{" "}
                  <span className="text-base text-slate-500">credits</span>
                </div>
                {wallet.reservedCredits > 0 && (
                  <div className="mt-1 text-xs text-slate-600">
                    {wallet.reservedCredits.toLocaleString()} credits reserved
                    (in-flight sends)
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-slate-600">
                <div>
                  Threshold:{" "}
                  <span className="font-mono">
                    {wallet.lowBalanceThreshold.toLocaleString()}
                  </span>
                </div>
                <div>
                  Status:{" "}
                  <span
                    className={
                      wallet.status === "ACTIVE"
                        ? "font-semibold text-emerald-700"
                        : "font-semibold text-red-700"
                    }
                  >
                    {wallet.status}
                  </span>
                </div>
                <div>
                  Mode: <span className="font-mono">{wallet.billingMode}</span>
                </div>
              </div>
            </div>
            {isLow && (
              <div className="mt-3 rounded-md bg-white/50 px-3 py-2 text-xs">
                <strong>
                  {isEmpty
                    ? "Wallet is empty."
                    : "Wallet balance is below your low-balance threshold."}
                </strong>{" "}
                {wallet.autoRechargeEnabled
                  ? `Auto-recharge is on (${(wallet.autoRechargeAmountCredits ?? 0).toLocaleString()} credits per top-up via ${wallet.autoRechargePaymentProvider ?? "—"}).`
                  : "Auto-recharge is off — submit a recharge below."}
              </div>
            )}
            {wallet.lastAutoRechargeError && (
              <div className="mt-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700">
                <strong>Last auto-recharge attempt failed:</strong>{" "}
                {wallet.lastAutoRechargeError}
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        {/* Recharge form */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">
            Submit recharge
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Razorpay / Stripe integration ships in T-021b. Until then,
            submitted recharges post to your ledger as a manual adjustment for
            audit. You&apos;ll be billed when the payment integration is wired.
          </p>

          <form onSubmit={submitRechargeRequest} className="mt-4 space-y-4">
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setRechargeMode("preset")}
                className={`rounded px-3 py-1.5 font-medium ${
                  rechargeMode === "preset"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Preset
              </button>
              <button
                type="button"
                onClick={() => setRechargeMode("custom")}
                className={`rounded px-3 py-1.5 font-medium ${
                  rechargeMode === "custom"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Custom amount
              </button>
            </div>

            {rechargeMode === "preset" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {PRESET_PACKS.map((p) => (
                  <label
                    key={p.credits}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition ${
                      rechargeCredits === p.credits
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="pack"
                      value={p.credits}
                      checked={rechargeCredits === p.credits}
                      onChange={() => setRechargeCredits(p.credits)}
                      className="h-3 w-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{p.label}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {p.credits.toLocaleString()} credits
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <label className="block text-xs font-medium text-slate-700">
                Credits (minimum 100)
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={customCredits}
                  onChange={(e) => setCustomCredits(e.target.value)}
                  placeholder="10000"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
            )}

            <label className="block text-xs font-medium text-slate-700">
              Note (optional, shown in the ledger)
              <input
                value={rechargeNote}
                onChange={(e) => setRechargeNote(e.target.value)}
                placeholder="Top-up for Q2 sales push"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit recharge"}
            </button>
          </form>
        </section>

        {/* Recent transactions */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Recent ledger
            </h2>
            <button
              type="button"
              onClick={() => void refreshTransactions()}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Refresh
            </button>
          </div>
          {transactions.length === 0 && (
            <div className="rounded border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
              No transactions yet
            </div>
          )}
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto text-xs">
            {transactions.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      t.direction === "CREDIT"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {t.direction === "CREDIT" ? "+" : "−"}
                    {t.amountCredits.toLocaleString()}
                  </span>
                  <span className="font-mono text-[9px] text-slate-400">
                    {t.type}
                  </span>
                </div>
                <div className="mt-1 truncate text-slate-700">{t.reason}</div>
                <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-slate-500">
                  <span>
                    {new Date(t.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="font-mono">
                    bal {t.balanceAfterCredits.toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PartnerShell>
  );
}
