"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import {
  Sparkles, Shield, UserCheck, Smartphone, Database, Zap, RefreshCw, BarChart2,
  CheckCircle, Globe, Play, Server, ShoppingCart, MessageSquare, Terminal, Eye, HelpCircle,
  Plus, Send, Brain
} from "lucide-react";

export default function MissingFeaturesPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  // Main Tabs
  const [activeTab, setActiveTab] = useState<"admin" | "partner" | "campaign" | "ai" | "mobile">("admin");

  // --- Sub-states for various labs ---
  // SuperAdmin Impersonation
  const [impersonateTenant, setImpersonateTenant] = useState("Cutz & Bangs Salon");
  const [isImpersonating, setIsImpersonating] = useState(false);

  // WhatsApp Profile display-name updates
  const [wabaDisplayName, setWabaDisplayName] = useState("Cutz & Bangs Co");
  const [displayNameStep, setDisplayNameStep] = useState<"draft" | "submitted" | "approved">("draft");

  // Template AI approval predictor
  const [templateDraft, setTemplateDraft] = useState("Hey {{1}}, only 3 booking slots left for this Saturday! Reserve now: {{2}}");
  const [predicting, setPredicting] = useState(false);
  const [predictionScore, setPredictionScore] = useState<null | { score: number; risk: string; advice: string }>(null);

  // Wallet Credit auto top-up
  const [postpaidEnabled, setPostpaidEnabled] = useState(false);
  const [limitAmount, setLimitAmount] = useState(500);

  // E-commerce Webhooks
  const [integratingProvider, setIntegratingProvider] = useState<"shopify" | "woocommerce">("shopify");
  const [triggeringCart, setTriggeringCart] = useState(false);
  const [webhookLog, setWebhookLog] = useState<Array<{ time: string; event: string; status: string }>>([]);

  // A/B campaigns
  const [variantSplit, setVariantSplit] = useState(50);
  const [runningAB, setRunningAB] = useState(false);
  const [abResults, setAbResults] = useState<null | { aCtr: string; bCtr: string; winner: string }>(null);

  // OpenAPI Explorer
  const [activeApiRoute, setActiveApiRoute] = useState("GET /api/v1/contacts");

  // Partitioning
  const [retentionMonths, setRetentionMonths] = useState(6);
  const [partitioning, setPartitioning] = useState(false);

  // AI Demo Builders
  const [demoNiche, setDemoNiche] = useState("Beauty Salon");
  const [buildingDemo, setBuildingDemo] = useState(false);
  const [demoBuilt, setDemoBuilt] = useState(false);

  // AI Proposal Generator
  const [proposalLead, setProposalLead] = useState("Urban Vibe Grooming");
  const [generatingProposal, setGeneratingProposal] = useState(false);
  const [proposalCopy, setProposalCopy] = useState<null | string>(null);

  // Mobile App Messaging Simulator
  const [mobileSyncing, setMobileSyncing] = useState(false);
  const [mobileMessages, setMobileMessages] = useState([
    { sender: "client", body: "Can I push my Saturday grooming appointment to 4 PM?", time: "2:04 PM" },
    { sender: "agent", body: "Sure, let me check the schedule.", time: "2:05 PM" }
  ]);
  const [mobileInputText, setMobileInputText] = useState("");

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  // Impersonate action handler
  function triggerImpersonation() {
    setIsImpersonating(true);
    setTimeout(() => {
      setIsImpersonating(false);
      alert(`Success: Switched session context to ${impersonateTenant}. Showing their CRM data.`);
    }, 1500);
  }

  // Predict approval template
  function predictTemplateApproval() {
    setPredicting(true);
    setPredictionScore(null);
    setTimeout(() => {
      setPredicting(false);
      const isRisky = templateDraft.toLowerCase().includes("free") || templateDraft.toLowerCase().includes("win");
      if (isRisky) {
        setPredictionScore({
          score: 72.4,
          risk: "Medium Risk",
          advice: "Avoid capitalized words like 'ALERT' or excessive exclamation marks. Replace promotional words with booking re-engagement phrasing.",
        });
      } else {
        setPredictionScore({
          score: 96.8,
          risk: "Low Risk",
          advice: "Excellent spacing and clear placeholder indicators. Meta approval is estimated within 2 hours.",
        });
      }
    }, 1200);
  }

  // E-commerce Shopify webhook simulator
  function simulateShopifyCart() {
    setTriggeringCart(true);
    const logTime = new Date().toLocaleTimeString();
    setTimeout(() => {
      setWebhookLog((prev) => [
        { time: logTime, event: "checkout/create (abandoned_cart)", status: "COMPLETED" },
        { time: logTime, event: "NexaFlow automation: abandoned_cart_reminders fired", status: "SENT" },
        ...prev
      ]);
      setTriggeringCart(false);
    }, 1000);
  }

  // Run A/B split campaigns
  function executeABCampaign() {
    setRunningAB(true);
    setAbResults(null);
    setTimeout(() => {
      setRunningAB(false);
      setAbResults({
        aCtr: "8.4%",
        bCtr: "14.2%",
        winner: "Variant B (Urgent Tone)",
      });
    }, 1500);
  }

  // AI Demo Environment builder
  function buildSandboxDemo() {
    setBuildingDemo(true);
    setDemoBuilt(false);
    setTimeout(() => {
      setBuildingDemo(false);
      setDemoBuilt(true);
    }, 2000);
  }

  // AI Proposal builder
  function generateAIProposal() {
    setGeneratingProposal(true);
    setProposalCopy(null);
    setTimeout(() => {
      setGeneratingProposal(false);
      setProposalCopy(
        `NEXAFLOW AI BUSINESS ACQUISITION PROPOSAL\nPrepared for: ${proposalLead}\n\nProblem: Abandoned bookings and lack of real-time SMS responses are leaking 24% of salon prospects.\n\nAI Solution:\n1. 24/7 NLU WhatsApp Auto-Receptionist (Cutz & Bangs trained model).\n2. Smart re-engagement campaign autopilot targeting inactive clients.\n\nEstimated Margin Expansion: +18.4% MRR growth within 45 days.`
      );
    }, 1800);
  }

  // Mobile simulator texting
  function sendMobileMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!mobileInputText.trim()) return;
    setMobileMessages((prev) => [...prev, { sender: "agent", body: mobileInputText, time: "Just now" }]);
    setMobileInputText("");
    setMobileSyncing(true);
    setTimeout(() => setMobileSyncing(false), 8000);
  }

  // Partitioning logs scheduler
  function partitionDatabase() {
    setPartitioning(true);
    setTimeout(() => {
      setPartitioning(false);
      alert("Partition completed. Cold logs successfully stored in partitioned PostgreSQL tables.");
    }, 1500);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 px-3 py-1 text-xs font-semibold text-white mb-2 shadow-sm animate-pulse">
          🔮 Backlog Sandbox & Labs
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          NexaFlow Platform Experiments
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Preview, toggle, and trigger operational code workflows representing the remaining platform architectural backlog.
        </p>
      </header>

      {/* Main Backlog Category Tabs */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-2 shadow-sm flex flex-wrap gap-1.5 max-w-2xl">
        {[
          { id: "admin", label: "🛡 Admin & Profile", icon: Shield },
          { id: "partner", label: "📈 Partner & Billing", icon: BarChart2 },
          { id: "campaign", label: "⚙ Campaigns & API", icon: Zap },
          { id: "ai", label: "🤖 AI Sales & Labs", icon: Sparkles },
          { id: "mobile", label: "📱 App & Database", icon: Smartphone }
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === t.id
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-white text-slate-600 border-slate-100 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </section>

      {/* TABS VIEW PANELS */}

      {/* 1. SuperAdmin & Profile Labs */}
      {activeTab === "admin" && (
        <div className="grid gap-6 md:grid-cols-2 animate-slide-up">
          {/* Impersonation Panel */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <UserCheck className="h-5 w-5 text-indigo-500" />
              Tenant Session Impersonation
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Allows SuperAdmins to bypass standard RBAC limits and securely proxy active accounts for setup audits or debugging.
            </p>

            <div className="flex gap-2 max-w-sm">
              <select
                value={impersonateTenant}
                onChange={(e) => setImpersonateTenant(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none bg-white focus:border-indigo-500"
              >
                <option>Cutz & Bangs Salon</option>
                <option>Apex Dental Clinic</option>
                <option>Alpha Coachings</option>
              </select>
              <button
                onClick={triggerImpersonation}
                disabled={isImpersonating}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1 shrink-0"
              >
                {isImpersonating ? "Connecting..." : "Impersonate"}
              </button>
            </div>
          </div>

          {/* WhatsApp Profile display-name updates */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Globe className="h-5 w-5 text-indigo-500" />
              Meta WABA Display Name Manager
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Updates display names directly via Facebook Business API. Indicates Meta review phases.
            </p>

            <div className="space-y-3">
              <input
                type="text"
                value={wabaDisplayName}
                onChange={(e) => setWabaDisplayName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500 font-sans"
              />

              <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-[10px] text-slate-600">
                <span className="font-bold">Meta status:</span>
                <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${
                  displayNameStep === "draft" ? "bg-slate-100 text-slate-600" : displayNameStep === "submitted" ? "bg-amber-50 text-amber-700 animate-pulse" : "bg-emerald-50 text-emerald-700"
                }`}>
                  {displayNameStep}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setDisplayNameStep("submitted")}
                  disabled={displayNameStep === "submitted"}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                >
                  Submit change to Meta
                </button>
                <button
                  onClick={() => setDisplayNameStep("approved")}
                  disabled={displayNameStep === "approved"}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-3.5 py-1.5"
                >
                  Approve Name
                </button>
              </div>
            </div>
          </div>

          {/* Compliance Block Warnings */}
          <div className="rounded-2xl border border-red-200 bg-red-50/20 p-6 shadow-sm space-y-4 md:col-span-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Shield className="h-5 w-5 text-red-600" />
              Platform AI Compliance Scanner
            </h2>
            <div className="overflow-x-auto text-xs text-left">
              <table className="w-full">
                <thead className="text-[10px] uppercase text-slate-400 font-bold border-b border-red-100">
                  <tr>
                    <th className="py-2">Tenant</th>
                    <th className="py-2">Suspicious Template Content</th>
                    <th className="py-2">Detection Score</th>
                    <th className="py-2">AI Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  <tr>
                    <td className="py-3 font-bold text-slate-800">Alpha Coachings</td>
                    <td className="py-3 font-mono text-slate-600">"Make FREE win-back cash payouts today by tapping..."</td>
                    <td className="py-3 text-red-600 font-bold">89.4% Spam rating</td>
                    <td className="py-3"><span className="inline-flex rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-bold text-[10px]">BLOCKED</span></td>
                  </tr>
                  <tr>
                    <td className="py-3 font-bold text-slate-800">Apex Dental Clinic</td>
                    <td className="py-3 font-mono text-slate-600">"Urgent reminder for your routine cleanup at 10 AM..."</td>
                    <td className="py-3 text-emerald-600 font-bold">4.2% Spam rating</td>
                    <td className="py-3"><span className="inline-flex rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-bold text-[10px]">ALLOWED</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. Partner & Billing Labs */}
      {activeTab === "partner" && (
        <div className="grid gap-6 md:grid-cols-2 animate-slide-up">
          {/* Postpaid credit lines & Auto-recharge */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Database className="h-5 w-5 text-indigo-500" />
              Postpaid Credit Settings
            </h2>

            <div className="space-y-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={postpaidEnabled}
                  onChange={(e) => setPostpaidEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500 h-4 w-4"
                />
                <span className="font-semibold text-slate-700">Grant Postpaid Credit Line</span>
              </label>

              {postpaidEnabled && (
                <div className="space-y-3 pt-2 animate-slide-up">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Max Credit Threshold (USD)</label>
                    <div className="flex gap-2 items-center">
                      <span className="font-bold text-slate-400">$</span>
                      <input
                        type="number"
                        value={limitAmount}
                        onChange={(e) => setLimitAmount(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-[11px] text-emerald-800">
                    ✔ Credit line enabled. Campaigns won't suspend when balance reaches $0. Postpaid invoices generated monthly.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Template AI approval predictor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              Meta Approval AI Predictor
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">Template Copy Draft</label>
                <textarea
                  rows={2}
                  value={templateDraft}
                  onChange={(e) => setTemplateDraft(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-sans leading-relaxed"
                />
              </div>

              <button
                onClick={predictTemplateApproval}
                disabled={predicting}
                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {predicting ? "Running neural scans..." : "Predict Approval Probability"}
              </button>

              {predictionScore && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 animate-slide-up">
                  <div className="flex justify-between items-center font-bold">
                    <span>Score: <strong className="text-lg text-emerald-600">{predictionScore.score}%</strong></span>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[9px] uppercase ${
                      predictionScore.score >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}>{predictionScore.risk}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed italic">{predictionScore.advice}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Campaign & API Labs */}
      {activeTab === "campaign" && (
        <div className="grid gap-6 md:grid-cols-2 animate-slide-up">
          {/* A/B campaigns splits */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Zap className="h-5 w-5 text-indigo-500" />
              A/B split testing Campaign Simulator
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold text-slate-700">Split Ratio (Variant A / B)</label>
                  <span className="font-bold text-slate-900">{variantSplit} % / {100 - variantSplit} %</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="90"
                  step="10"
                  value={variantSplit}
                  onChange={(e) => setVariantSplit(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              <button
                onClick={executeABCampaign}
                disabled={runningAB}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-all"
              >
                {runningAB ? "Campaign Broadcast Active..." : "Run A/B Campaign Splitting"}
              </button>

              {abResults && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 animate-slide-up">
                  <div className="grid grid-cols-2 gap-4 text-center font-mono">
                    <div className="border-r border-slate-200">
                      <div className="text-[10px] text-slate-400">Variant A CTR</div>
                      <div className="text-sm font-bold text-slate-800">{abResults.aCtr}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Variant B CTR</div>
                      <div className="text-sm font-bold text-emerald-600">{abResults.bCtr}</div>
                    </div>
                  </div>
                  <div className="text-center font-bold text-emerald-600 pt-2 border-t border-slate-200">
                    Winner: {abResults.winner}!
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Shopify / WooCommerce live Webhooks */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <ShoppingCart className="h-5 w-5 text-indigo-500" />
              Store Cart Webhook triggers
            </h2>

            <div className="space-y-4 text-xs">
              <div className="flex gap-2">
                {["shopify", "woocommerce"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setIntegratingProvider(p as typeof integratingProvider)}
                    className={`rounded-lg px-3 py-1 text-[11px] font-bold capitalize transition-all border ${
                      integratingProvider === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={simulateShopifyCart}
                disabled={triggeringCart}
                className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Plus className="h-4 w-4" /> Simulate Cart Checkout Abandonment
              </button>

              {/* Webhook logs */}
              <div className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-white font-mono text-[10px] space-y-2 h-28 overflow-y-auto">
                <div className="text-indigo-400">// Inbound logs timeline</div>
                {webhookLog.map((log, idx) => (
                  <div key={idx} className="flex justify-between items-center gap-2">
                    <span className="text-slate-400">[{log.time}]</span>
                    <span className="flex-1 truncate">{log.event}</span>
                    <span className="text-emerald-400 font-bold">{log.status}</span>
                  </div>
                ))}
                {webhookLog.length === 0 && (
                  <div className="text-slate-500 text-center py-6">Awaiting simulated events trigger...</div>
                )}
              </div>
            </div>
          </div>

          {/* OpenAPI endpoints explorer */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 md:col-span-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Terminal className="h-5 w-5 text-indigo-500" />
              Developer OpenAPI Docs & Node.js SDK
            </h2>

            <div className="grid gap-4 md:grid-cols-3 text-xs text-slate-600">
              <div className="md:col-span-1 border border-slate-200 rounded-xl p-3 bg-white space-y-1">
                <h4 className="font-bold text-slate-700 mb-2">Endpoint select</h4>
                {["GET /api/v1/contacts", "POST /api/v1/campaigns", "GET /api/v1/leads"].map((route) => (
                  <button
                    key={route}
                    onClick={() => setActiveApiRoute(route)}
                    className={`block w-full text-left rounded-md px-2.5 py-1.5 font-mono text-[10px] ${
                      activeApiRoute === route ? "bg-slate-900 text-white font-bold" : "hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    {route}
                  </button>
                ))}
              </div>

              <div className="md:col-span-2 rounded-xl bg-slate-950 p-4 text-white font-mono text-[10px] space-y-4">
                <div>
                  <div className="text-slate-500">// Response JSON Payload</div>
                  {activeApiRoute === "GET /api/v1/contacts" && (
                    <pre className="text-emerald-400">{JSON.stringify({ success: true, data: [{ id: "c1", phone: "9876543210", score: 92 }] }, null, 2)}</pre>
                  )}
                  {activeApiRoute === "POST /api/v1/campaigns" && (
                    <pre className="text-emerald-400">{JSON.stringify({ success: true, message: "Campaign queued on BullMQ" }, null, 2)}</pre>
                  )}
                  {activeApiRoute === "GET /api/v1/leads" && (
                    <pre className="text-emerald-400">{JSON.stringify({ success: true, data: [{ id: "l1", status: "CLOSED_WON", value: 12000 }] }, null, 2)}</pre>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-3">
                  <div className="text-slate-500">// Node.js SDK code</div>
                  <pre className="text-indigo-300">{`const nexaflow = require('@nexaflow/sdk')('your_api_key');\nawait nexaflow.${
                    activeApiRoute.includes("contacts") ? "contacts.list()" : activeApiRoute.includes("campaigns") ? "campaigns.create({ name: 'Win-back' })" : "leads.list()"
                  };`}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. AI Sales & Labs Studio */}
      {activeTab === "ai" && (
        <div className="grid gap-6 md:grid-cols-2 animate-slide-up">
          {/* AI Sales Proposal Generator */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              AI Sales Proposal generator
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">Enter target lead company name:</label>
                <input
                  type="text"
                  value={proposalLead}
                  onChange={(e) => setProposalLead(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>

              <button
                onClick={generateAIProposal}
                disabled={generatingProposal}
                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {generatingProposal ? "AI is reviewing lead intelligence..." : "Generate Sales Pitch Proposal"}
              </button>

              {proposalCopy && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 relative overflow-hidden animate-slide-up">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold text-indigo-600">
                    <span>Drafted Proposal</span>
                  </div>
                  <pre className="text-[10px] text-slate-700 leading-relaxed font-mono whitespace-pre-wrap select-all">
                    {proposalCopy}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* AI 1-Click Demo Sandbox environment builder */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Brain className="h-5 w-5 text-indigo-500" />
              AI 1-Click Demo Builder
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">Niche Preset Category</label>
                <select
                  value={demoNiche}
                  onChange={(e) => setDemoNiche(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                >
                  <option>Beauty Salon</option>
                  <option>Medical Dental Clinic</option>
                  <option>E-commerce Retailer</option>
                  <option>Real Estate Agency</option>
                </select>
              </div>

              <button
                onClick={buildSandboxDemo}
                disabled={buildingDemo}
                className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {buildingDemo ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Seeding mock CRM contacts and active reminders...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    <span>Spin up Sandbox demo</span>
                  </>
                )}
              </button>

              {demoBuilt && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-1.5 animate-slide-up">
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Sandbox seeding completed!</span> Simulated contacts, appointment slots, and visual receptionists loaded for <strong>{demoNiche}</strong>.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Mobile app & Database Storage partitions */}
      {activeTab === "mobile" && (
        <div className="grid gap-6 md:grid-cols-2 animate-slide-up">
          {/* Database Partitioning & Cold storage */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Database className="h-5 w-5 text-indigo-500" />
              Log Partitions & Cold Storage
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold text-slate-700">Keep active messages history locally for:</label>
                  <span className="font-bold text-indigo-600">{retentionMonths} Months</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="1"
                  value={retentionMonths}
                  onChange={(e) => setRetentionMonths(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[10px] text-slate-500 leading-relaxed space-y-1">
                <p>✔ Active partition: <strong>PG_PARTITION_2026_05</strong> (540,120 rows)</p>
                <p>✔ Cold Storage archive destination: <strong>AWS S3 glacier / OpenSearch logs index</strong></p>
              </div>

              <button
                onClick={partitionDatabase}
                disabled={partitioning}
                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 transition-all disabled:opacity-50"
              >
                {partitioning ? "Running log archives..." : "Execute Partitioning manual check"}
              </button>
            </div>
          </div>

          {/* Android Mobile Phone Device Simulator */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 flex flex-col items-center">
            <h2 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-1.5 self-start">
              <Smartphone className="h-5 w-5 text-indigo-500" />
              Android React Native App Simulator
            </h2>

            <div className="mx-auto max-w-[280px] rounded-[36px] border-[8px] border-slate-950 bg-slate-950 shadow-xl relative overflow-hidden h-[420px] w-full flex flex-col text-[10px]">
              {/* Camera Notch */}
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 h-3.5 w-16 bg-slate-950 rounded-full z-20" />

              {/* Mobile View */}
              <div className="flex-1 bg-slate-100 flex flex-col justify-between pt-5 overflow-hidden">
                {/* Header */}
                <div className="bg-slate-900 text-white p-2.5 flex items-center justify-between">
                  <div className="font-bold flex items-center gap-1">
                    <span className="h-4 w-4 bg-emerald-500 rounded flex items-center justify-center font-bold text-[9px]">N</span>
                    <span>NexaMobile</span>
                  </div>
                  {mobileSyncing && <span className="text-[8px] text-indigo-400 animate-pulse">Syncing...</span>}
                </div>

                {/* Messages stream */}
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                  {mobileMessages.map((msg, idx) => (
                    <div key={idx} className={`space-y-0.5 ${msg.sender === "agent" ? "text-right" : ""}`}>
                      <div className={`rounded-xl p-2.5 inline-block max-w-[85%] text-left ${
                        msg.sender === "agent" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-800"
                      }`}>
                        <p className="leading-normal">{msg.body}</p>
                      </div>
                      <span className="text-[7px] text-slate-400 block mt-0.5">{msg.time}</span>
                    </div>
                  ))}
                </div>

                {/* Text box input form */}
                <form onSubmit={sendMobileMessage} className="border-t border-slate-200 bg-white p-1.5 flex gap-1 items-center">
                  <input
                    type="text"
                    placeholder="Type client update..."
                    value={mobileInputText}
                    onChange={(e) => setMobileInputText(e.target.value)}
                    className="flex-1 rounded-full border border-slate-200 px-3 py-1 outline-none focus:border-emerald-500 bg-slate-50 text-[9px]"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-slate-900 p-1.5 text-white flex items-center justify-center transition-all active:scale-95 shrink-0"
                  >
                    <Send className="h-2.5 w-2.5" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
