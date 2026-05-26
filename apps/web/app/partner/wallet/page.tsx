"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  date: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  method: string;
  notes: string;
}

export default function PartnerWalletPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  // Local state persisted in localStorage
  const [balance, setBalance] = useState<number>(4520);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  // Custom Pricing & Currency states
  const [currency, setCurrency] = useState<string>("INR");
  const [markup, setMarkup] = useState<number>(15);
  const [costPerCredit, setCostPerCredit] = useState<number>(0.15); // Base cost in reselled currency

  // Dynamic Recharge States
  const [selectedPack, setSelectedPack] = useState<number>(1000);
  const [customCredits, setCustomCredits] = useState<string>("");
  const [rechargeMethod, setRechargeMethod] = useState<"razorpay" | "manual">("razorpay");

  // Manual payment states
  const [refId, setRefId] = useState<string>("");
  const [slipName, setSlipName] = useState<string>("");
  
  // Modals & triggers
  const [showRazorpayModal, setShowRazorpayModal] = useState<boolean>(false);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [processingPayment, setProcessingPayment] = useState<boolean>(false);

  // Load and save localStorage variables
  useEffect(() => {
    const savedBalance = localStorage.getItem("nexaflow_wallet_balance");
    if (savedBalance) setBalance(Number(savedBalance));

    const savedCurrency = localStorage.getItem("nexaflow_currency") || "INR";
    setCurrency(savedCurrency);

    const savedMarkup = localStorage.getItem("nexaflow_markup") || "15";
    setMarkup(Number(savedMarkup));

    const savedCost = localStorage.getItem("nexaflow_cost_credit") || "0.15";
    setCostPerCredit(Number(savedCost));

    const savedTx = localStorage.getItem("nexaflow_wallet_transactions");
    if (savedTx) {
      try {
        setTransactions(JSON.parse(savedTx));
      } catch (e) {}
    } else {
      // Mock initial transaction ledger
      const mockLedger: Transaction[] = [
        { id: "TXN-9082", type: "CREDIT", amount: 12000, currency: "Credits", date: "2026-05-20 14:22", status: "COMPLETED", method: "Razorpay Gateway", notes: "₹1,000 Recharge Package" },
        { id: "TXN-8812", type: "DEBIT", amount: 5000, currency: "Credits", date: "2026-05-18 10:15", status: "COMPLETED", method: "Internal Transfer", notes: "Allocated to Cutz & Bangs Salon" },
        { id: "TXN-8541", type: "CREDIT", amount: 10000, currency: "Credits", date: "2026-05-01 09:00", status: "COMPLETED", method: "Manual Gateway", notes: "Welcome Reseller Bonus Credits" },
      ];
      setTransactions(mockLedger);
      localStorage.setItem("nexaflow_wallet_transactions", JSON.stringify(mockLedger));
    }
  }, []);

  const saveBalance = (newBal: number) => {
    setBalance(newBal);
    localStorage.setItem("nexaflow_wallet_balance", String(newBal));
  };

  const getCurrencySymbol = (cur: string) => {
    switch (cur) {
      case "USD": return "$";
      case "EUR": return "€";
      case "AED": return "AED ";
      case "INR":
      default:
        return "₹";
    }
  };

  // Convert packaging rates based on active currency
  const getPackagePrice = (credits: number) => {
    const baseInINR = credits === 5000 ? 500 : credits === 12000 ? 1000 : 5000;
    switch (currency) {
      case "USD": return (baseInINR / 85).toFixed(2);
      case "EUR": return (baseInINR / 92).toFixed(2);
      case "AED": return (baseInINR / 23).toFixed(2);
      case "INR":
      default:
        return baseInINR.toString();
    }
  };

  // Razorpay Checkout flow simulation
  const handleRazorpayCheckout = () => {
    setShowRazorpayModal(true);
    setProcessingPayment(true);
    setPaymentSuccess(false);

    // Simulate validation and checkout progress
    setTimeout(() => {
      setProcessingPayment(false);
      setPaymentSuccess(true);
      
      // Calculate credits to credit
      const creditsToAdd = selectedPack === 0 ? Number(customCredits) : selectedPack;
      const newBal = balance + creditsToAdd;
      saveBalance(newBal);

      // Add to transaction list
      const newTx: Transaction = {
        id: `TXN-${Math.floor(1000 + Math.random() * 9000)}`,
        type: "CREDIT",
        amount: creditsToAdd,
        currency: "Credits",
        date: new Date().toISOString().replace("T", " ").substring(0, 16),
        status: "COMPLETED",
        method: "Razorpay Gateway",
        notes: `Recharged package through simulated Razorpay gateway.`
      };
      const updatedTx = [newTx, ...transactions];
      setTransactions(updatedTx);
      localStorage.setItem("nexaflow_wallet_transactions", JSON.stringify(updatedTx));

      // Auto close success alert after 2 seconds
      setTimeout(() => {
        setShowRazorpayModal(false);
      }, 2500);

    }, 3000);
  };

  // Manual payment submission flow
  const handleManualSubmission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refId) return;

    const creditsToAdd = selectedPack === 0 ? Number(customCredits) : selectedPack;

    const newTx: Transaction = {
      id: `TXN-${Math.floor(1000 + Math.random() * 9000)}`,
      type: "CREDIT",
      amount: creditsToAdd,
      currency: "Credits",
      date: new Date().toISOString().replace("T", " ").substring(0, 16),
      status: "PENDING",
      method: "Manual Wire Transfer",
      notes: `Ref: ${refId}. Slip: ${slipName || "uploaded_receipt.png"}. Awaiting SuperAdmin verification.`
    };

    const updatedTx = [newTx, ...transactions];
    setTransactions(updatedTx);
    localStorage.setItem("nexaflow_wallet_transactions", JSON.stringify(updatedTx));

    // Clear forms
    setRefId("");
    setSlipName("");
    alert("Manual payment reference submitted successfully. Once the bank transfer is confirmed by our billing team, the credits will reflect in your balance.");
  };

  // Pricing settings update
  const savePricingSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("nexaflow_currency", currency);
    localStorage.setItem("nexaflow_markup", String(markup));
    localStorage.setItem("nexaflow_cost_credit", String(costPerCredit));
    alert("Reseller customized pricing structures and currency configurations applied.");
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Wallet Manager…</div>;
  }

  const symbol = getCurrencySymbol(currency);

  return (
    <PartnerShell user={user} signOut={signOut}>
      {/* Page Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Wallet & Recharge System</h1>
        <p className="text-sm text-slate-400">
          Monitor prepaid balances, simulate Razorpay recharges, upload wire details, and set reseller client pricing.
        </p>
      </header>

      {/* Overview balances & details */}
      <div className="grid gap-6 md:grid-cols-3 mb-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Prepaid balance</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-white">{balance.toLocaleString()}</span>
            <span className="text-xs font-semibold text-slate-400">Credits</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Estimated value: {symbol}{(balance * costPerCredit).toFixed(2)}</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monthly Usage Rates</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-indigo-400">12,500</span>
            <span className="text-xs font-semibold text-slate-400">Cr Used</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Across 12 sub-tenant business accounts</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Reseller margin</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-emerald-400">+{markup}%</span>
            <span className="text-xs font-semibold text-slate-400">Markup</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Customized markup per client broadcast</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        {/* Recharge controls */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <h2 className="text-lg font-bold text-white mb-4">Recharge Credits Balance</h2>

          {/* Credits Packages selector */}
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            <button
              onClick={() => { setSelectedPack(5000); setCustomCredits(""); }}
              className={`rounded-lg border p-4 text-center transition-all duration-300 ${
                selectedPack === 5000
                  ? "border-indigo-500 bg-indigo-500/10 text-white"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60"
              }`}
            >
              <div className="font-bold text-base">5,000 Cr</div>
              <div className="text-xs mt-1 text-slate-400">{symbol}{getPackagePrice(5000)}</div>
            </button>

            <button
              onClick={() => { setSelectedPack(12000); setCustomCredits(""); }}
              className={`rounded-lg border p-4 text-center transition-all duration-300 ${
                selectedPack === 12000
                  ? "border-indigo-500 bg-indigo-500/10 text-white"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60"
              }`}
            >
              <div className="font-bold text-base">12,000 Cr</div>
              <div className="text-xs mt-1 text-indigo-400">{symbol}{getPackagePrice(12000)} (Best)</div>
            </button>

            <button
              onClick={() => { setSelectedPack(65000); setCustomCredits(""); }}
              className={`rounded-lg border p-4 text-center transition-all duration-300 ${
                selectedPack === 65000
                  ? "border-indigo-500 bg-indigo-500/10 text-white"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900/60"
              }`}
            >
              <div className="font-bold text-base">65,000 Cr</div>
              <div className="text-xs mt-1 text-slate-400">{symbol}{getPackagePrice(65000)}</div>
            </button>
          </div>

          {/* Custom Package option */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Or Enter Custom Credits</label>
            <input
              type="number"
              value={customCredits}
              onChange={(e) => {
                setCustomCredits(e.target.value);
                setSelectedPack(0);
              }}
              placeholder="e.g. 20000"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Method selector */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-400 mb-2">Billing Gateway Method</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="radio"
                  checked={rechargeMethod === "razorpay"}
                  onChange={() => setRechargeMethod("razorpay")}
                  className="accent-indigo-500"
                />
                Razorpay Checkout (Simulated)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="radio"
                  checked={rechargeMethod === "manual"}
                  onChange={() => setRechargeMethod("manual")}
                  className="accent-indigo-500"
                />
                Manual / Wire Transfer Bank Receipt
              </label>
            </div>
          </div>

          {/* Checkout triggers */}
          {rechargeMethod === "razorpay" ? (
            <button
              onClick={handleRazorpayCheckout}
              className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all duration-300"
            >
              Pay Securely with Razorpay Gateway
            </button>
          ) : (
            <form onSubmit={handleManualSubmission} className="space-y-3.5 border-t border-slate-800 pt-4">
              <div className="rounded-lg bg-slate-950/60 p-4 border border-slate-800 text-xs text-slate-300 space-y-1">
                <div className="font-bold text-white">NexaFlow Platform Bank wire accounts:</div>
                <div>Bank Name: HDFC Bank India Limited</div>
                <div>Account No: 50200084512591</div>
                <div>IFSC Code: HDFC0000125</div>
                <div>Swift Routing: HDFCINBBXXX</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-400">
                  Transaction reference No.
                  <input
                    required
                    type="text"
                    placeholder="e.g. TXN1234567"
                    value={refId}
                    onChange={(e) => setRefId(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Upload Receipt Slip
                  <input
                    type="file"
                    onChange={(e) => setSlipName(e.target.files?.[0]?.name || "")}
                    className="mt-1 w-full text-xs text-slate-400 file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-slate-800 file:text-indigo-400 cursor-pointer"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 transition-all duration-300"
              >
                Submit Payment Receipt for Approval
              </button>
            </form>
          )}
        </section>

        {/* Pricing rules and markups */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white mb-4">Custom Pricing & Currencies</h2>
            <p className="text-xs text-slate-400 mb-6">
              Configure how much you charge your sub-client accounts per broadcast credits. You can add pricing margins and choose billing currencies.
            </p>

            <form onSubmit={savePricingSettings} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-400">
                Reseller Agency Currency Code
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="INR">INR (₹) Indian Rupee</option>
                  <option value="USD">USD ($) United States Dollar</option>
                  <option value="EUR">EUR (€) Euro Zone</option>
                  <option value="AED">AED (د.إ) UAE Dirham</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-slate-400">
                Prepaid Broadcast Margin Markup (%)
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="1"
                    value={markup}
                    onChange={(e) => setMarkup(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <span className="text-sm font-bold text-white min-w-[3rem] text-right">{markup}%</span>
                </div>
              </label>

              <label className="block text-xs font-semibold text-slate-400">
                Custom Target Cost Per Credit ({symbol})
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={costPerCredit}
                  onChange={(e) => setCostPerCredit(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </label>

              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600/20 border border-indigo-500/30 py-2.5 text-xs font-semibold text-indigo-400 hover:bg-indigo-600/40 transition-all duration-300"
              >
                Apply Custom Pricing Strategy
              </button>
            </form>
          </div>

          <div className="mt-6 rounded-lg bg-slate-950/40 p-4 border border-slate-800 text-xs text-slate-400 space-y-1">
            <span className="font-semibold text-white">Conversion Rule Summary:</span>
            <div>Client SMS Broadcast costs <span className="text-white font-medium">{costPerCredit} {symbol}</span> per credits.</div>
            <div>Your direct billing margin: <span className="text-emerald-400 font-bold">{(costPerCredit * (markup / 100)).toFixed(3)} {symbol}</span> profit per message!</div>
          </div>
        </section>
      </div>

      {/* Ledger transactions list */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
        <h2 className="text-lg font-bold text-white mb-4">Transaction Ledgers & Billings</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold">Transaction ID</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Action Type</th>
                <th className="px-4 py-3 font-semibold">Amount Credits</th>
                <th className="px-4 py-3 font-semibold">Payment Gateway</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
                <th className="px-4 py-3 font-semibold">Verify Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-900/20">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-200">{tx.id}</td>
                  <td className="px-4 py-3 text-slate-400">{tx.date}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${tx.type === "CREDIT" ? "text-emerald-400" : "text-rose-400"}`}>
                      {tx.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-100">{tx.amount.toLocaleString()} Cr</td>
                  <td className="px-4 py-3 text-slate-300">{tx.method}</td>
                  <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{tx.notes}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold border ${
                      tx.status === "COMPLETED"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : tx.status === "PENDING"
                        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* RAZORPAY CHEKOUT ANIMATED MODAL SIMULATION */}
      {showRazorpayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl p-6">
            
            {/* Header branding */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">💳</span>
                <div>
                  <h3 className="text-sm font-bold text-white">Razorpay Secure Checkout</h3>
                  <p className="text-[10px] text-slate-400">NexaFlow Agency Ref: #5020-0082</p>
                </div>
              </div>
              <span className="text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                DEMO SANDBOX
              </span>
            </div>

            {/* Payment states */}
            {processingPayment ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-800 border-t-indigo-500"></div>
                <div className="text-xs text-slate-300">
                  Connecting to payment services...
                  <p className="text-[10px] text-slate-500 mt-1">Processing credit card details securely.</p>
                </div>
              </div>
            ) : paymentSuccess ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-2xl">
                  ✓
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Payment Authorized!</h4>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Credits have been instantly added to your partner account balance.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Amount details */}
            <div className="mt-4 rounded-lg bg-slate-950/60 p-3 border border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400">Amount payable:</span>
              <span className="text-base font-extrabold text-white">
                {symbol}
                {getPackagePrice(selectedPack === 0 ? Number(customCredits) : selectedPack)}
              </span>
            </div>
            
            <div className="mt-4 text-[10px] text-center text-slate-500">
              Secured by Razorpay. Industry standard 256-bit encryption routing.
            </div>
          </div>
        </div>
      )}
    </PartnerShell>
  );
}
