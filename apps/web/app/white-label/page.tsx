"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { Globe, Shield, CheckCircle, AlertTriangle, Palette, Users, DollarSign, Upload, Plus, Search, ChevronRight } from "lucide-react";

export default function WhiteLabelPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  // Domain configs
  const [customDomain, setCustomDomain] = useState("chat.mybrand.com");
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [domainStatus, setDomainStatus] = useState<"pending" | "connected">("pending");

  // Branding states
  const [primaryColor, setPrimaryColor] = useState("#10B981");
  const [secondaryColor, setSecondaryColor] = useState("#0F172A");
  const [brandName, setBrandName] = useState("NexaGrow Marketing");

  // Client manager lists
  const [clients] = useState([
    { id: "c1", name: "Cutz & Bangs Salon", status: "ACTIVE", plan: "Growth Pro", messagesThisMonth: 14500, activeAgents: 4, markup: "20%" },
    { id: "c2", name: "Apex Dental Clinic", status: "ACTIVE", plan: "Starter Extra", messagesThisMonth: 4800, activeAgents: 2, markup: "15%" },
    { id: "c3", name: "Alpha Coachings", status: "PAST_DUE", plan: "Enterprise Tier", messagesThisMonth: 28900, activeAgents: 10, markup: "25%" },
    { id: "c4", name: "Urban Threads Retail", status: "ACTIVE", plan: "Growth Pro", messagesThisMonth: 12100, activeAgents: 3, markup: "20%" },
  ]);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  function verifyDomain() {
    setCheckingDomain(true);
    setTimeout(() => {
      setCheckingDomain(false);
      setDomainStatus("connected");
    }, 2000);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 mb-2 border border-indigo-100">
          White Label Partner Dashboard
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Agency Command Center
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure reseller settings, connect domains, audit client metrics, and track margins.
        </p>
      </header>

      {/* Margins & Billing KPI Cards */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">MRR Share</span>
            <DollarSign className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">$3,420</div>
          <div className="mt-1 text-xs text-emerald-600 font-semibold">▲ 14% vs last month</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Clients</span>
            <Users className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{clients.length} Businesses</div>
          <div className="mt-1 text-xs text-slate-500">1 pending invitation</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">SMS/WABA Costs</span>
            <Shield className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">$840.20</div>
          <div className="mt-1 text-xs text-slate-500">Gross billing cost from Meta</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Domain Status</span>
            <Globe className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${domainStatus === "connected" ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-sm font-bold text-slate-800 capitalize">{domainStatus}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate">{customDomain}</div>
        </div>
      </section>

      {/* Main Agency Tabs Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Domain & Branding */}
        <div className="lg:col-span-2 space-y-6">
          {/* Domain Connection Module */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-1.5">
              <Globe className="h-5 w-5 text-indigo-500" />
              Domain Connection Settings
            </h2>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Map your custom domain to white-label the NexaFlow interfaces. Point your DNS records and verify SSL below.
            </p>

            <div className="flex gap-2 max-w-md mb-6">
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="e.g. chat.mybrand.com"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
              <button
                onClick={verifyDomain}
                disabled={checkingDomain}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1"
              >
                {checkingDomain ? "Verifying..." : "Verify Domain"}
              </button>
            </div>

            {/* DNS Records Details */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
              <h3 className="text-xs font-bold text-slate-700">Add the following DNS records to your domain provider:</h3>
              <div className="grid gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                    <span>A Record</span>
                    <span className="text-emerald-600">Required</span>
                  </div>
                  <div className="grid grid-cols-3 text-xs gap-1">
                    <div><span className="font-semibold text-slate-500">Host:</span> @</div>
                    <div className="col-span-2 text-right"><span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">76.76.21.21</span></div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                    <span>TXT Record</span>
                    <span className="text-emerald-600">Verification</span>
                  </div>
                  <div className="grid grid-cols-3 text-xs gap-1">
                    <div><span className="font-semibold text-slate-500">Host:</span> _nexaflow</div>
                    <div className="col-span-2 text-right truncate"><span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded" title="nxf-verification=4b8c9d0a2f">nxf-verification=4b8c...</span></div>
                  </div>
                </div>
              </div>

              {domainStatus === "connected" ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-2 animate-slide-up">
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">SSL Certificate active!</span> Your white label domain is securely connected and routing properly.
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Awaiting Verification</span>. It may take up to 24 hours for DNS record updates to propagate globally.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Client Manager List */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                  <Users className="h-5 w-5 text-indigo-500" />
                  Client Onboarding Manager
                </h2>
                <p className="text-xs text-slate-500">Onboard new businesses and set dynamic pricing markups.</p>
              </div>
              <button className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 flex items-center gap-1 transition-all active:scale-95">
                <Plus className="h-4 w-4" />
                Add Client
              </button>
            </div>

            {/* Clients Listing */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 uppercase text-slate-400 font-bold tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Business</th>
                    <th className="px-4 py-3">Plan Info</th>
                    <th className="px-4 py-3">Monthly Messages</th>
                    <th className="px-4 py-3">Markup</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clients.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 cursor-pointer transition-all">
                      <td className="px-4 py-3 font-semibold text-slate-950">{c.name}</td>
                      <td className="px-4 py-3 text-slate-600">{c.plan} ({c.activeAgents} agents)</td>
                      <td className="px-4 py-3 text-slate-700 font-mono">{c.messagesThisMonth.toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-700 font-bold text-emerald-600">{c.markup} markup</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Custom Branding Configuration */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Palette className="h-5 w-5 text-indigo-500" />
              Brand Stylings & Identity
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">White-Label Brand Name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Primary Color</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-8 w-8 rounded border border-slate-200 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] uppercase text-slate-500">{primaryColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-600 mb-1">Secondary Color</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="h-8 w-8 rounded border border-slate-200 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] uppercase text-slate-500">{secondaryColor}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-600 mb-1">Upload Brand Logo</label>
                <div className="rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-500 p-4 text-center cursor-pointer transition-all bg-slate-50/50">
                  <Upload className="mx-auto h-6 w-6 text-slate-400 mb-1.5" />
                  <span className="font-bold text-slate-700 block">Click to upload logo PNG</span>
                  <span className="text-[10px] text-slate-400">Recommends 512x512 with transparent background</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 text-center">
                <button className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-all active:scale-95">
                  Save Brand Settings
                </button>
              </div>
            </div>
          </div>

          {/* Quick Reseller Preview Mockup */}
          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 h-40 w-40 bg-radial-glow opacity-30" />
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">Live UI Brand Preview</h3>
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mt-3 space-y-3">
              <div className="flex items-center gap-1.5">
                <div className="h-6 w-6 rounded bg-emerald-500 flex items-center justify-center font-bold text-xs" style={{ backgroundColor: primaryColor }}>
                  {brandName[0]}
                </div>
                <span className="text-xs font-bold">{brandName}</span>
              </div>
              <div className="space-y-1">
                <div className="h-2 bg-slate-800 rounded w-5/6" />
                <div className="h-2 bg-slate-800 rounded w-1/2" />
              </div>
              <button className="h-7 w-full rounded bg-emerald-500 text-[10px] font-bold text-white uppercase tracking-wider transition-all" style={{ backgroundColor: primaryColor }}>
                Log in to workspace
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
