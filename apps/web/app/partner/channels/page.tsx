"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface SyncLog {
  time: string;
  type: "INFO" | "SUCCESS" | "ERROR";
  message: string;
}

interface WabaChannel {
  id: string;
  wabaId: string;
  name: string;
  phoneNumber: string;
  status: "CONNECTED" | "DISCONNECTED" | "PENDING";
  qualityRating: "GREEN" | "YELLOW" | "RED";
  limitTier: "Tier 1 (1k/day)" | "Tier 2 (10k/day)" | "Tier 3 (100k/day)" | "Tier 4 (Unlimited)";
  webhookUrl: string;
  webhookStatus: "ACTIVE" | "INACTIVE";
}

export default function ChannelManagerPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [channels, setChannels] = useState<WabaChannel[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  
  // Creation form states
  const [formName, setFormName] = useState("");
  const [formWabaId, setFormWabaId] = useState("");
  const [formPhone, setFormPhone] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("nexaflow_channels");
    if (stored) {
      try {
        setChannels(JSON.parse(stored));
      } catch (e) {}
    } else {
      const initial: WabaChannel[] = [
        {
          id: "waba-01",
          wabaId: "84501259109285",
          name: "Cutz & Bangs WABA Business",
          phoneNumber: "+91 98765 43210",
          status: "CONNECTED",
          qualityRating: "GREEN",
          limitTier: "Tier 2 (10k/day)",
          webhookUrl: "https://api.youragency.com/api/v1/webhook/waba-01",
          webhookStatus: "ACTIVE",
        },
        {
          id: "waba-02",
          wabaId: "90125810294102",
          name: "PixelCraft Marketing WABA",
          phoneNumber: "+91 99999 88888",
          status: "CONNECTED",
          qualityRating: "GREEN",
          limitTier: "Tier 1 (1k/day)",
          webhookUrl: "https://api.youragency.com/api/v1/webhook/waba-02",
          webhookStatus: "ACTIVE",
        },
      ];
      setChannels(initial);
      localStorage.setItem("nexaflow_channels", JSON.stringify(initial));
    }

    setLogs([
      { time: "15:10:00", type: "INFO", message: "WABA Channel sync engine initialized." },
      { time: "15:10:05", type: "SUCCESS", message: "Webhook endpoints online and listening to Meta events." },
    ]);
  }, []);

  const saveChannels = (updated: WabaChannel[]) => {
    setChannels(updated);
    localStorage.setItem("nexaflow_channels", JSON.stringify(updated));
  };

  const handleConnectWaba = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formWabaId || !formPhone) return;

    const newChan: WabaChannel = {
      id: `waba-${Math.floor(10 + Math.random() * 90)}`,
      wabaId: formWabaId,
      name: formName,
      phoneNumber: formPhone,
      status: "CONNECTED",
      qualityRating: "GREEN",
      limitTier: "Tier 1 (1k/day)",
      webhookUrl: `https://api.youragency.com/api/v1/webhook/waba-${Math.floor(100 + Math.random() * 900)}`,
      webhookStatus: "ACTIVE",
    };

    const updated = [...channels, newChan];
    saveChannels(updated);
    
    // Add logs
    const newLog: SyncLog = {
      time: new Date().toLocaleTimeString(),
      type: "SUCCESS",
      message: `Successfully connected new WABA: ${formName} (${formPhone})`,
    };
    setLogs([newLog, ...logs]);

    setFormName("");
    setFormWabaId("");
    setFormPhone("");
    setShowConnectForm(false);
    alert("WhatsApp Business Account connected securely to reseller instance!");
  };

  // Sync log progress simulator
  const handleSyncTemplates = () => {
    setSyncing(true);
    
    const timestamp = () => new Date().toLocaleTimeString();
    
    const step1: SyncLog = { time: timestamp(), type: "INFO", message: "Connecting to Meta Graph API WABA endpoints..." };
    setLogs((prev) => [step1, ...prev]);

    setTimeout(() => {
      const step2: SyncLog = { time: timestamp(), type: "INFO", message: "Verifying approved template parameters schemas..." };
      setLogs((prev) => [step2, ...prev]);

      setTimeout(() => {
        const step3: SyncLog = { time: timestamp(), type: "SUCCESS", message: "Synchronized 18 Meta templates with 0 validation warnings." };
        setLogs((prev) => [step3, ...prev]);
        setSyncing(false);
        alert("All WhatsApp Business Account templates synchronized successfully.");
      }, 1500);

    }, 1000);
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Channels Manager…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">WhatsApp Channels (Meta WABA)</h1>
          <p className="text-sm text-slate-400">
            Connect Meta WABA credentials, check phone numbers health quality, verify webhooks, and sync message templates.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSyncTemplates}
            disabled={syncing}
            className="rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-900/60 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync WABA Templates"}
          </button>
          
          <button
            onClick={() => setShowConnectForm(!showConnectForm)}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all duration-300"
          >
            {showConnectForm ? "Cancel Connect" : "+ Connect WABA"}
          </button>
        </div>
      </div>

      {showConnectForm && (
        <form onSubmit={handleConnectWaba} className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md space-y-4">
          <h2 className="text-sm font-bold text-white">Connect Client WABA Account</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs text-slate-400">
              Account Display Name
              <input
                required
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Cutz & Bangs WABA"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Meta WABA ID (15 Digit)
              <input
                required
                type="text"
                pattern="\d{15}"
                value={formWabaId}
                onChange={(e) => setFormWabaId(e.target.value)}
                placeholder="84501259109285"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-slate-400">
              WhatsApp Display Number
              <input
                required
                type="text"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="submit"
            className="rounded bg-emerald-600 px-4 py-1.5 text-xs text-white hover:bg-emerald-500 font-semibold"
          >
            Authorize Connect
          </button>
        </form>
      )}

      {/* Grid: Active channels cards & logs */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] mb-6">
        
        {/* WABA Active Channels */}
        <section className="space-y-4">
          <h2 className="text-base font-bold text-white">Active Meta WABA Portals</h2>
          
          <div className="space-y-4">
            {channels.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md space-y-4 hover:border-slate-700 transition-all duration-300">
                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div>
                    <h3 className="font-bold text-sm text-slate-200">{c.name}</h3>
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">WABA ID: {c.wabaId} · Number: {c.phoneNumber}</div>
                  </div>

                  <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold border ${
                    c.status === "CONNECTED"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                  }`}>
                    {c.status}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 border-t border-slate-800/60 pt-3 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-500">Quality Rating</div>
                    <div className="font-bold text-emerald-400 mt-0.5 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500"></span> {c.qualityRating}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Messaging Limit</div>
                    <div className="font-bold text-indigo-400 mt-0.5">{c.limitTier}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Meta Webhooks</div>
                    <div className="font-bold text-slate-200 mt-0.5">{c.webhookStatus}</div>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800 text-[10px] font-mono text-slate-400 truncate">
                  Endpoint: {c.webhookUrl}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sync logs terminal */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white mb-2">Sync Progress Terminals</h2>
            <p className="text-xs text-slate-400 mb-4">Meta Graph API handshakes verification logging output.</p>
            
            <div className="rounded-lg bg-slate-950 p-4 font-mono text-[10px] leading-relaxed text-slate-400 h-64 overflow-y-auto space-y-2 border border-slate-800">
              {logs.map((log, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-slate-500 select-none">[{log.time}]</span>
                  <span className={log.type === "SUCCESS" ? "text-emerald-400" : log.type === "ERROR" ? "text-rose-400" : "text-indigo-400"}>
                    {log.type}:
                  </span>
                  <span className="text-slate-300">{log.message}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 text-[10px] text-slate-500 leading-relaxed">
            Meta API connections are polled automatically every 15m. Custom webhook events route with HMAC signature protections.
          </div>
        </section>

      </div>
    </PartnerShell>
  );
}
