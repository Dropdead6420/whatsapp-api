"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { CreditCard, ArrowUpRight, ArrowDownLeft, Shield, DollarSign, Percent, History, Sliders, CheckCircle } from "lucide-react";

export default function WalletPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  const [balance, setBalance] = useState(240.50);
  const [recharging, setRecharging] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [autoRecharge, setAutoRecharge] = useState(true);
  const [threshold, setThreshold] = useState(20);
  const [topUpAmount, setTopUpAmount] = useState(100);
  const [showNotice, setShowNotice] = useState(false);

  // Transactions ledger list
  const [transactions, setTransactions] = useState([
    { id: "tx_0192a", date: "2026-05-24", type: "RECHARGE", label: "Credit Purchase (Stripe)", amount: 150.00, status: "SUCCESS" },
    { id: "tx_0191b", date: "2026-05-22", type: "EXPENSE", label: "Broadcast Broadcast: Weekend Special", amount: -42.20, status: "SUCCESS" },
    { id: "tx_0190c", date: "2026-05-20", type: "EXPENSE", label: "AI Creative Studio Variant Generation", amount: -8.50, status: "SUCCESS" },
    { id: "tx_0189d", date: "2026-05-18", type: "RECHARGE", label: "Auto-Topup triggered", amount: 100.00, status: "SUCCESS" },
    { id: "tx_0188e", date: "2026-05-15", type: "EXPENSE", label: "Meta Cloud API Session charge", amount: -12.80, status: "SUCCESS" },
  ]);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  function handleRecharge(amount: number) {
    setSelectedAmount(amount);
    setRecharging(true);
    setTimeout(() => {
      setBalance((prev) => prev + amount);
      setRecharging(false);
      setSelectedAmount(null);
      const newTx = {
        id: `tx_${Math.random().toString(36).substr(2, 5)}`,
        date: new Date().toISOString().split("T")[0],
        type: "RECHARGE",
        label: "Manual Credit Purchase (Mock Payment)",
        amount: amount,
        status: "SUCCESS",
      };
      setTransactions((prev) => [newTx, ...prev]);
    }, 1500);
  }

  function saveAutoTopup(e: React.FormEvent) {
    e.preventDefault();
    setShowNotice(true);
    setTimeout(() => setShowNotice(false), 3000);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
          Billing & Wallet Controls
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Prepaid Credit Wallet
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Top up messaging credits, audit cost ledger lists, and set automatic low-balance rules.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Columns: Wallet Balances & Quick Top Up */}
        <div className="lg:col-span-2 space-y-6">
          {/* Wallet Balance Visual Card */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-xl relative overflow-hidden border border-slate-800">
            <div className="absolute top-0 right-0 h-40 w-40 bg-radial-glow opacity-30 pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Balance</span>
                <div className="text-4xl font-extrabold mt-1 text-emerald-400">${balance.toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-slate-900/60 p-2.5 border border-slate-800 backdrop-blur-md">
                <CreditCard className="h-6 w-6 text-indigo-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-8 pt-6 border-t border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 font-medium block">Spent this Month</span>
                <span className="text-sm font-bold text-slate-200 mt-0.5">$63.50</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">WABA Sessions Charged</span>
                <span className="text-sm font-bold text-slate-200 mt-0.5">4,210 sessions</span>
              </div>
            </div>
          </div>

          {/* Quick Recharge Increment Grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-2">Buy Prepaid Credits</h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Select credit amount to top up immediately. Transactions are processed via mock Stripe channels.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[50, 100, 250, 500].map((amt) => (
                <button
                  key={amt}
                  disabled={recharging}
                  onClick={() => handleRecharge(amt)}
                  className="rounded-xl border border-slate-200 hover:border-emerald-500 p-4 hover:bg-slate-50/50 transition-all font-bold text-slate-800 text-center hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  <span className="text-xs text-slate-400 block font-normal">Add</span>
                  <span className="text-lg font-extrabold text-slate-900">${amt}</span>
                </button>
              ))}
            </div>

            {recharging && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex items-center justify-center gap-2 text-xs text-slate-600 animate-pulse">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                <span>Processing mock checkout for <strong>${selectedAmount}</strong>...</span>
              </div>
            )}
          </div>

          {/* Cost History ledger */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-1.5 pb-3 border-b border-slate-100">
              <History className="h-5 w-5 text-indigo-500" />
              Prepaid Credit Ledger
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 uppercase text-slate-400 font-bold tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Tx ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/30 transition-all">
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{tx.id}</td>
                      <td className="px-4 py-3 text-slate-600">{tx.date}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950 flex items-center gap-1.5">
                        {tx.type === "RECHARGE" ? (
                          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <ArrowDownLeft className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        {tx.label}
                      </td>
                      <td className={`px-4 py-3 font-mono font-bold ${tx.amount > 0 ? "text-emerald-600" : "text-slate-800"}`}>
                        {tx.amount > 0 ? `+$${tx.amount.toFixed(2)}` : `-$${Math.abs(tx.amount).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 border border-emerald-100">
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Threshold Auto-Billing settings */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Sliders className="h-5 w-5 text-indigo-500" />
              Auto-Topup Configurations
            </h2>

            <form onSubmit={saveAutoTopup} className="space-y-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRecharge}
                  onChange={(e) => setAutoRecharge(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500 h-4 w-4"
                />
                <span className="font-semibold text-slate-700">Enable Automatic Recharge</span>
              </label>

              {autoRecharge && (
                <div className="space-y-4 pt-2 animate-slide-up">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      If wallet balance falls below:
                    </label>
                    <div className="flex gap-2 items-center">
                      <span className="font-bold text-slate-400">$</span>
                      <input
                        type="number"
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Automatically recharge wallet with:
                    </label>
                    <div className="flex gap-2 items-center">
                      <span className="font-bold text-slate-400">$</span>
                      <input
                        type="number"
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-all active:scale-95"
                >
                  Save Recharge Rules
                </button>
              </div>

              {showNotice && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-800 flex items-start gap-1.5 animate-slide-up mt-3">
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>Auto-recharge options successfully saved.</div>
                </div>
              )}
            </form>
          </div>

          {/* Secure details */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 space-y-3">
            <h4 className="font-bold text-slate-800">Secure Payment Vault</h4>
            <p className="leading-relaxed">
              All transactions are secured using bank-level AES-256 encryption hashes. NexaFlow complies with PCI-DSS guidelines.
            </p>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
