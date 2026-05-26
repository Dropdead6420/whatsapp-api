"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { Sparkles, Check, Plus, AlertCircle, ShoppingBag, CreditCard } from "lucide-react";

export default function PlansPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth" | "enterprise">("growth");
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);

  // Add-ons checkboxes
  const [addOns, setAddOns] = useState({
    extraAgents: false,
    extraMessages: false,
    whiteLabelBranding: false,
  });

  const plans = {
    starter: { name: "Starter", price: billingCycle === "monthly" ? 29 : 24, messages: "5,000", contacts: "1,000", agents: 2, chatbot: false },
    growth: { name: "Growth Pro", price: billingCycle === "monthly" ? 79 : 64, messages: "25,000", contacts: "10,000", agents: 5, chatbot: true },
    enterprise: { name: "Enterprise Custom", price: billingCycle === "monthly" ? 199 : 159, messages: "Unlimited", contacts: "Unlimited", agents: 20, chatbot: true },
  };

  const addOnPrices = {
    extraAgents: 15,
    extraMessages: 20,
    whiteLabelBranding: 10,
  };

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  const currentPlanObj = plans[selectedPlan];
  const basePrice = currentPlanObj.price;
  const cycleLabel = billingCycle === "monthly" ? "mo" : "yr";

  const addOnsTotal =
    (addOns.extraAgents ? addOnPrices.extraAgents : 0) +
    (addOns.extraMessages ? addOnPrices.extraMessages : 0) +
    (addOns.whiteLabelBranding ? addOnPrices.whiteLabelBranding : 0);

  const finalTotal = basePrice + addOnsTotal;

  function executeCheckout() {
    setCheckingOut(true);
    setTimeout(() => {
      setCheckingOut(false);
      setCheckedOut(true);
    }, 2000);
  }

  function resetCheckout() {
    setShowCheckout(false);
    setCheckedOut(false);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8 text-center max-w-2xl mx-auto">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
          SaaS Billing Configurations
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Upgrade Your Growth Engine
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Unlock advanced campaigns autopilot, smart segmentation scanners, visual chatbot visual builder nodes, and more.
        </p>

        {/* Toggle billing cycle */}
        <div className="mt-6 inline-flex rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              billingCycle === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle("yearly")}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              billingCycle === "yearly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Yearly (Save 20%)
          </button>
        </div>
      </header>

      {/* Pricing Matrix */}
      <section className="grid gap-6 md:grid-cols-3 mb-8 max-w-5xl mx-auto">
        {/* Starter Plan */}
        <div
          onClick={() => setSelectedPlan("starter")}
          className={`rounded-2xl border-2 p-6 transition-all bg-white cursor-pointer relative ${
            selectedPlan === "starter" ? "border-emerald-500 shadow-lg scale-105" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <h3 className="text-lg font-bold text-slate-900">Starter</h3>
          <p className="text-xs text-slate-400 mt-1">Perfect for local businesses</p>
          <div className="mt-4 flex items-baseline">
            <span className="text-3xl font-extrabold text-slate-900">${plans.starter.price}</span>
            <span className="text-xs text-slate-400 ml-1">/{cycleLabel}</span>
          </div>

          <ul className="mt-6 space-y-3 text-xs text-slate-600 border-t border-slate-100 pt-6">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.starter.messages} Campaign Messages</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.starter.contacts} CRM Contacts</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.starter.agents} Agent Access</span>
            </li>
            <li className="flex items-center gap-2 text-slate-400">
              <Check className="h-4 w-4 text-slate-300 shrink-0" />
              <span className="line-through">Visual Chatbot Builder</span>
            </li>
          </ul>
        </div>

        {/* Growth Pro Plan */}
        <div
          onClick={() => setSelectedPlan("growth")}
          className={`rounded-2xl border-2 p-6 transition-all bg-white cursor-pointer relative ${
            selectedPlan === "growth" ? "border-emerald-500 shadow-xl scale-105" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 border-2 border-white px-3.5 py-0.5 text-[9px] font-extrabold text-white uppercase tracking-wider">
            Most Popular
          </div>
          <h3 className="text-lg font-bold text-slate-900">Growth Pro</h3>
          <p className="text-xs text-slate-400 mt-1">For rapidly scaling agencies</p>
          <div className="mt-4 flex items-baseline">
            <span className="text-3xl font-extrabold text-slate-900">${plans.growth.price}</span>
            <span className="text-xs text-slate-400 ml-1">/{cycleLabel}</span>
          </div>

          <ul className="mt-6 space-y-3 text-xs text-slate-600 border-t border-slate-100 pt-6">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.growth.messages} Campaign Messages</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.growth.contacts} CRM Contacts</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.growth.agents} Agent Access</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="font-semibold text-slate-800">Visual Chatbot Builder</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>Meta Ads Integration</span>
            </li>
          </ul>
        </div>

        {/* Enterprise Plan */}
        <div
          onClick={() => setSelectedPlan("enterprise")}
          className={`rounded-2xl border-2 p-6 transition-all bg-white cursor-pointer relative ${
            selectedPlan === "enterprise" ? "border-emerald-500 shadow-lg scale-105" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <h3 className="text-lg font-bold text-slate-900">Enterprise Custom</h3>
          <p className="text-xs text-slate-400 mt-1">Custom volume solutions</p>
          <div className="mt-4 flex items-baseline">
            <span className="text-3xl font-extrabold text-slate-900">${plans.enterprise.price}</span>
            <span className="text-xs text-slate-400 ml-1">/{cycleLabel}</span>
          </div>

          <ul className="mt-6 space-y-3 text-xs text-slate-600 border-t border-slate-100 pt-6">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="font-bold text-emerald-600">{plans.enterprise.messages} Messages</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.enterprise.contacts} Contacts</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{plans.enterprise.agents} Agent Access</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>SLA Uptime Guarantee</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="font-semibold text-slate-800">White-Label DNS Mapping</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Add-ons & Invoice Builder */}
      <section className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
        {/* Add-ons checklist */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-2">Custom Upgrade Add-ons</h2>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Modify plan limits to fit precise team parameters. Checked items are appended to your active bill.
          </p>

          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50/50 cursor-pointer transition-all">
              <input
                type="checkbox"
                checked={addOns.extraAgents}
                onChange={(e) => setAddOns((prev) => ({ ...prev, extraAgents: e.target.checked }))}
                className="mt-0.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">Add 5 Extra Agent Seats</span>
                <span className="text-slate-400">Add seats to your live conversation inbox.</span>
                <span className="text-emerald-600 font-bold block mt-1">+$15 / {cycleLabel}</span>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50/50 cursor-pointer transition-all">
              <input
                type="checkbox"
                checked={addOns.extraMessages}
                onChange={(e) => setAddOns((prev) => ({ ...prev, extraMessages: e.target.checked }))}
                className="mt-0.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">Add 10,000 Campaign Messages</span>
                <span className="text-slate-400">Increase monthly broadcast capability limits.</span>
                <span className="text-emerald-600 font-bold block mt-1">+$20 / {cycleLabel}</span>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50/50 cursor-pointer transition-all">
              <input
                type="checkbox"
                checked={addOns.whiteLabelBranding}
                onChange={(e) => setAddOns((prev) => ({ ...prev, whiteLabelBranding: e.target.checked }))}
                className="mt-0.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800 block">Remove NexaFlow Branding</span>
                <span className="text-slate-400">Wipe all "Powered by NexaFlow" links from chat widgets.</span>
                <span className="text-emerald-600 font-bold block mt-1">+$10 / {cycleLabel}</span>
              </div>
            </label>
          </div>
        </div>

        {/* Invoice Summary Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-1">
              <ShoppingBag className="h-5 w-5 text-indigo-500" />
              Selected Order Summary
            </h2>
            <div className="space-y-3 text-xs border-b border-slate-100 pb-4">
              <div className="flex justify-between font-semibold">
                <span className="text-slate-600">{currentPlanObj.name} ({billingCycle})</span>
                <span className="text-slate-900">${basePrice}</span>
              </div>

              {addOns.extraAgents && (
                <div className="flex justify-between text-slate-500">
                  <span>+5 Agent Seats</span>
                  <span>+${addOnPrices.extraAgents}</span>
                </div>
              )}
              {addOns.extraMessages && (
                <div className="flex justify-between text-slate-500">
                  <span>+10,000 Messages Limit</span>
                  <span>+${addOnPrices.extraMessages}</span>
                </div>
              )}
              {addOns.whiteLabelBranding && (
                <div className="flex justify-between text-slate-500">
                  <span>No Branding Badge</span>
                  <span>+${addOnPrices.whiteLabelBranding}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-baseline pt-4">
              <span className="text-sm font-bold text-slate-800">Total Price Due:</span>
              <div className="text-right">
                <span className="text-2xl font-extrabold text-slate-900">${finalTotal}</span>
                <span className="text-xs text-slate-400">/{cycleLabel}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowCheckout(true)}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 text-xs transition-all active:scale-95 mt-6 flex items-center justify-center gap-1.5 shadow-md"
          >
            <CreditCard className="h-4 w-4" />
            Proceed to Checkout
          </button>
        </div>
      </section>

      {/* Interactive Glassmorphic Checkout Modal */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-slide-up">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold text-sm">Secure Payment Portal</h3>
              <button
                onClick={resetCheckout}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                Cancel
              </button>
            </div>

            <div className="p-6 space-y-6 text-xs text-slate-600">
              {!checkedOut ? (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-xs text-slate-800 font-bold">
                      <span>Order Subtotal:</span>
                      <span>${finalTotal}.00</span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Payment processed mockingly using Stripe. Credit limits are assigned immediately upon completion.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">Credit Card Number</label>
                      <input
                        type="text"
                        placeholder="4242 4242 4242 4242"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-slate-600 mb-1">Expiry Date</label>
                        <input
                          type="text"
                          placeholder="MM/YY"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-600 mb-1">CVC Code</label>
                        <input
                          type="password"
                          placeholder="***"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={executeCheckout}
                    disabled={checkingOut}
                    className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {checkingOut ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>Validating credentials...</span>
                      </>
                    ) : (
                      <>
                        <span>Pay ${finalTotal}.00 Now</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <div className="text-center py-6 space-y-4">
                  <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 animate-pulse">
                    <Check className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Purchase Completed!</h4>
                    <p className="mt-1 text-slate-500">
                      Your subscription is active and new add-on credits are assigned to your workspace.
                    </p>
                  </div>
                  <button
                    onClick={resetCheckout}
                    className="rounded-lg bg-slate-900 px-6 py-2 font-bold text-white hover:bg-slate-800 transition-all text-xs"
                  >
                    Back to Workspace
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
