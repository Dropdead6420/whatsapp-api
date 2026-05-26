"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { Layers, MessageSquare, PhoneCall, RefreshCw, Radio, Check, Eye, ExternalLink, Settings2, ShieldCheck } from "lucide-react";

export default function ChannelsPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  const [activeSetupChannel, setActiveSetupChannel] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [wabaConnected, setWabaConnected] = useState(true);

  // WABA configuration parameters mockup
  const [wabaConfig, setWabaConfig] = useState({
    wabaId: "89045612301",
    phoneNumberId: "105674321908543",
    verifiedNumber: "+91 98765 43210",
    webhookToken: "nxf_webhook_secret_99824",
  });

  // SMS Gateway config mockup
  const [smsConfig, setSmsConfig] = useState({
    provider: "Twilio",
    sid: "AC4b8c9d0a2f1e...",
    authToken: "••••••••••••••••••••••••",
    fallbackEnabled: true,
  });

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  function executeConnection() {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setWabaConnected(true);
      setActiveSetupChannel(null);
    }, 1500);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
          Messaging Hub & Cloud Gateways
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          Omnichannel Manager
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Map Meta WABA Cloud APIs, verify Twilio SMS gateways, and set up live website chat integration blocks.
        </p>
      </header>

      {/* Main Omnichannel Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Meta WABA Primary Channel */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/5 rounded-bl-full pointer-events-none" />
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2 text-emerald-600">
                <MessageSquare className="h-6 w-6" />
              </div>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${
                wabaConnected ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-amber-50 text-amber-700 border border-amber-100"
              }`}>
                {wabaConnected ? "Verified Connection" : "Needs Config"}
              </span>
            </div>

            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">Meta WhatsApp Cloud API</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Connect your Meta WABA account directly using Facebook Developer credentials. Supports templates approvals and automation nodes.
              </p>
            </div>

            {wabaConnected && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-[10px] text-slate-600 font-mono">
                <div><span className="font-bold text-slate-400">WABA ID:</span> {wabaConfig.wabaId}</div>
                <div><span className="font-bold text-slate-400">Phone ID:</span> {wabaConfig.phoneNumberId}</div>
                <div><span className="font-bold text-slate-400">Number:</span> {wabaConfig.verifiedNumber}</div>
              </div>
            )}
          </div>

          <button
            onClick={() => setActiveSetupChannel("waba")}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 text-xs transition-all active:scale-95 mt-6 flex items-center justify-center gap-1.5"
          >
            <Settings2 className="h-4 w-4" />
            <span>Configure settings</span>
          </button>
        </div>

        {/* Twilio SMS fallback gateway */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-red-500/5 rounded-bl-full pointer-events-none" />
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="rounded-xl bg-red-50 border border-red-100 p-2 text-red-600">
                <Radio className="h-6 w-6" />
              </div>
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">
                Fallback Option
              </span>
            </div>

            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">SMS Gateway Fallback</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Configure Twilio or Plivo gateways. Active whenever WhatsApp template delivery fails or customer goes offline.
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-[10px] text-slate-600 font-mono">
              <div><span className="font-bold text-slate-400">Provider:</span> {smsConfig.provider}</div>
              <div><span className="font-bold text-slate-400">Auth Token:</span> {smsConfig.authToken}</div>
              <div className="flex items-center gap-1"><span className="font-bold text-slate-400">Fallback:</span> <Check className="h-3 w-3 text-emerald-600" /> Active</div>
            </div>
          </div>

          <button
            onClick={() => setActiveSetupChannel("sms")}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 text-xs transition-all active:scale-95 mt-6 flex items-center justify-center gap-1.5"
          >
            <Settings2 className="h-4 w-4" />
            <span>Configure settings</span>
          </button>
        </div>

        {/* Website chat widget embed */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-indigo-500/5 rounded-bl-full pointer-events-none" />
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-2 text-indigo-600">
                <PhoneCall className="h-6 w-6" />
              </div>
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">
                Embed Widget
              </span>
            </div>

            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">Website Live Chat Widget</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Generate embeddable chat bubble scripts. Captures website leads and routes threads instantly into NexaFlow inbox.
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1 text-[10px] text-slate-500">
              <p>✔ Sleek custom bubble widget</p>
              <p>✔ Synchronizes offline intent logs</p>
              <p>✔ Real-time agent typing alerts</p>
            </div>
          </div>

          <button
            onClick={() => setActiveSetupChannel("widget")}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 text-xs transition-all active:scale-95 mt-6 flex items-center justify-center gap-1.5"
          >
            <Settings2 className="h-4 w-4" />
            <span>Configure settings</span>
          </button>
        </div>
      </div>

      {/* Interactive Setup Wizard Modals */}
      {activeSetupChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-slide-up">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold text-sm">
                {activeSetupChannel === "waba" && "Meta WABA Connection Wizard"}
                {activeSetupChannel === "sms" && "SMS Fallback Gateway settings"}
                {activeSetupChannel === "widget" && "Website Widget setup"}
              </h3>
              <button
                onClick={() => setActiveSetupChannel(null)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                Close
              </button>
            </div>

            {activeSetupChannel === "waba" && (
              <div className="p-6 space-y-4 text-xs text-slate-600">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1">
                  <span className="font-bold text-slate-800 block">Pre-requisite:</span>
                  <p className="text-[10px] text-slate-500">
                    You need a Meta Developer Account, a verified Business Manager ID, and a valid Phone Number to map.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">WhatsApp Business Account ID (WABA ID)</label>
                    <input
                      type="text"
                      value={wabaConfig.wabaId}
                      onChange={(e) => setWabaConfig((prev) => ({ ...prev, wabaId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Phone Number ID</label>
                    <input
                      type="text"
                      value={wabaConfig.phoneNumberId}
                      onChange={(e) => setWabaConfig((prev) => ({ ...prev, phoneNumberId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Webhook Secret Verification Token</label>
                    <input
                      type="text"
                      value={wabaConfig.webhookToken}
                      onChange={(e) => setWabaConfig((prev) => ({ ...prev, webhookToken: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono bg-slate-50"
                      disabled
                    />
                  </div>
                </div>

                <button
                  onClick={executeConnection}
                  disabled={connecting}
                  className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {connecting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Validating secrets with Meta Graph...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      <span>Verify Meta Cloud settings</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {activeSetupChannel === "sms" && (
              <div className="p-6 space-y-4 text-xs text-slate-600">
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Select Provider</label>
                    <select
                      value={smsConfig.provider}
                      onChange={(e) => setSmsConfig((prev) => ({ ...prev, provider: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 outline-none focus:border-indigo-500 bg-white"
                    >
                      <option>Twilio</option>
                      <option>Plivo</option>
                      <option>Msg91</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Account SID</label>
                    <input
                      type="text"
                      value={smsConfig.sid}
                      onChange={(e) => setSmsConfig((prev) => ({ ...prev, sid: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">Auth Token</label>
                    <input
                      type="password"
                      value={smsConfig.authToken}
                      onChange={(e) => setSmsConfig((prev) => ({ ...prev, authToken: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                <button
                  onClick={executeConnection}
                  disabled={connecting}
                  className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 transition-all active:scale-95"
                >
                  Save Gateway configuration
                </button>
              </div>
            )}

            {activeSetupChannel === "widget" && (
              <div className="p-6 space-y-4 text-xs text-slate-600">
                <div className="space-y-3">
                  <span className="font-bold text-slate-800">HTML embed code:</span>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Copy the following script tag and paste it inside the <code>&lt;head&gt;</code> section of your site.
                  </p>
                  <textarea
                    rows={4}
                    readOnly
                    value={`<!-- NexaFlow bubble widget -->\n<script src="https://cdn.nexaflow.ai/widget.js" data-tenant-id="${wabaConfig.wabaId}" defer></script>`}
                    className="w-full rounded-lg border border-slate-200 p-2.5 outline-none font-mono text-[10px] bg-slate-50 select-all"
                  />
                </div>

                <button
                  onClick={() => setActiveSetupChannel(null)}
                  className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
