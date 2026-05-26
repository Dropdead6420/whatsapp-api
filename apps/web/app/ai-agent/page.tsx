"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { Sparkles, Brain, Upload, Link2, Play, FileText, CheckCircle, RefreshCw, Send, HelpCircle, Smartphone } from "lucide-react";

export default function AiAgentPage() {
  const { user, loading, signOut } = useAuth({ required: true });

  // System Prompt settings
  const [systemPrompt, setSystemPrompt] = useState(
    "You are NexaBot, the elite booking receptionist for Cutz & Bangs Salon. Your primary goal is to guide customers to schedule appointments for hair services. Be extremely polite, professional, and clear. Avoid diagnosing medical skin issues, instead politely encourage them to book a consulting session. ALWAYS embed the booking link {{bookingLink}} whenever recommending services."
  );
  const [temperature, setTemperature] = useState(0.3);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Ingest state
  const [scrapingUrl, setScrapingUrl] = useState("https://cutzandbangs.com/services-price-list");
  const [scraping, setScraping] = useState(false);
  const [ingestedFiles, setIngestedFiles] = useState([
    { id: "f1", name: "salon-pricing-menu-2026.pdf", size: "1.2 MB", type: "PDF", date: "May 24" },
    { id: "f2", name: "salon-policies-cancellation.txt", size: "14 KB", type: "TXT", date: "May 23" },
  ]);

  // Simulator states
  const [simText, setSimText] = useState("");
  const [simMessages, setSimMessages] = useState<Array<{ sender: "user" | "bot"; text: string; source?: string }>>([
    { sender: "bot", text: "Hello! Welcome to Cutz & Bangs booking assistant. How can I help you customize your salon appointment today?" },
  ]);
  const [simulating, setSimulating] = useState(false);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setTimeout(() => {
      setSavingSettings(false);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }, 1200);
  }

  function handleScrape() {
    if (!scrapingUrl) return;
    setScraping(true);
    setTimeout(() => {
      setScraping(false);
      const newFile = {
        id: `f${ingestedFiles.length + 1}`,
        name: `Scraped: ${scrapingUrl.replace("https://", "")}.txt`,
        size: "32 KB",
        type: "SCRAPED",
        date: "Just now",
      };
      setIngestedFiles((prev) => [...prev, newFile]);
      setScrapingUrl("");
    }, 2000);
  }

  const mockSimulatorAnswers = [
    { text: "We have multiple styling openings this Saturday! You can schedule a professional Keratin Hair Conditioning slot or standard haircuts. Tap the booking link to secure your slot: {{bookingLink}}", source: "salon-pricing-menu-2026.pdf" },
    { text: "Our cancellation policy requires 24 hours notice. Late cancellations or no-shows may incur a 50% reservation charge as noted in our policies.", source: "salon-policies-cancellation.txt" },
    { text: "Yes! A classic men's styling and haircut is $35, which includes hair wash and styling wax. Let me know if you would like me to coordinate a reservation: {{bookingLink}}", source: "Scraped: cutzandbangs.com/services-price-list.txt" },
  ];

  function handleSendSimMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!simText.trim()) return;

    const userMsg = { sender: "user" as const, text: simText };
    setSimMessages((prev) => [...prev, userMsg]);
    setSimText("");
    setSimulating(true);

    setTimeout(() => {
      let ans = { text: "I'm sorry, I couldn't find details matching that query in our knowledge base. Would you like me to connect you with a live human salon agent?", source: "Fallback Routing Logic" };
      const txt = simText.toLowerCase();

      if (txt.includes("book") || txt.includes("saturday") || txt.includes("slot")) {
        ans = mockSimulatorAnswers[0];
      } else if (txt.includes("cancel") || txt.includes("policy") || txt.includes("late")) {
        ans = mockSimulatorAnswers[1];
      } else if (txt.includes("price") || txt.includes("cost") || txt.includes("how much")) {
        ans = mockSimulatorAnswers[2];
      }

      setSimMessages((prev) => [...prev, { sender: "bot" as const, text: ans.text, source: ans.source }]);
      setSimulating(false);
    }, 1200);
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
          NLU Codex Engine Setup
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          AI Agent Builder & Trainer
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Inject system instructions, upload catalog context PDFs, scrape website references, and simulate responses instantly.
        </p>
      </header>

      {/* Main Grid: Controls vs Simulator Phone */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Columns: Configs & Ingest */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prompts settings form */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Brain className="h-5 w-5 text-emerald-500" />
              Agent Prompt Architecture
            </h2>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">System Instructions Prompt</label>
                <textarea
                  rows={6}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-indigo-500 font-sans leading-relaxed"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold text-slate-700">Temperature (Creativity Control)</label>
                  <span className="font-mono font-bold text-slate-500">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>0.0 (Deterministic / Receipts)</span>
                  <span>1.0 (Creative Copywriter)</span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingSettings ? "Saving Settings..." : "Save Configuration"}
                </button>

                {savedSuccess && (
                  <span className="text-xs text-emerald-600 font-bold flex items-center gap-1 animate-slide-up">
                    <CheckCircle className="h-4 w-4" /> Agent successfully re-trained.
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* RAG Knowledge base uploader */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 mb-1">Vector Knowledge Base</h2>
              <p className="text-xs text-slate-500">Inject raw operational manuals and site structures for context lookup.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* File Drag Uploader */}
              <div className="rounded-xl border-2 border-dashed border-slate-200 hover:border-emerald-500 p-4 text-center cursor-pointer transition-all bg-slate-50/50 flex flex-col justify-center min-h-[140px]">
                <Upload className="mx-auto h-6 w-6 text-slate-400 mb-1.5" />
                <span className="font-bold text-slate-700 block text-xs">Upload Operational PDF</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Drag manuals, schedules or cancellation protocols</span>
              </div>

              {/* URL Scraper Widget */}
              <div className="rounded-xl border border-slate-200 p-4 bg-white flex flex-col justify-between min-h-[140px]">
                <div className="space-y-2">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1">
                    <Link2 className="h-4 w-4 text-indigo-500" /> Web Scraper
                  </span>
                  <input
                    type="text"
                    placeholder="https://mybusiness.com/pricing"
                    value={scrapingUrl}
                    onChange={(e) => setScrapingUrl(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleScrape}
                  disabled={scraping || !scrapingUrl}
                  className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold py-1.5 text-[11px] transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {scraping ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>Indexing site...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      <span>Scrape URL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Ingested Documents ledger */}
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-bold text-slate-700">Ingested operational context files</h4>
              <div className="grid gap-2">
                {ingestedFiles.map((file) => (
                  <div key={file.id} className="rounded-xl border border-slate-100 p-3 bg-slate-50/50 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-slate-400" />
                      </div>
                      <div>
                        <span className="font-bold text-slate-800 block truncate max-w-xs">{file.name}</span>
                        <span className="text-[10px] text-slate-400">{file.size} • Verified {file.date}</span>
                      </div>
                    </div>
                    <span className="rounded bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                      Ingested
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Agent Test Simulator Mobile device mock */}
        <div className="lg:col-span-1">
          <div className="mx-auto max-w-[320px] rounded-[36px] border-[10px] border-slate-950 bg-slate-950 shadow-2xl relative overflow-hidden h-[540px] flex flex-col">
            {/* Phone speaker / notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 h-4 w-20 bg-slate-950 rounded-full z-20" />

            {/* Simulated Chat Window */}
            <div className="flex-1 bg-slate-100 flex flex-col justify-between pt-6 text-[11px] overflow-hidden">
              {/* Header */}
              <div className="bg-slate-950 text-white p-3 flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-xs text-white">
                  ✦
                </div>
                <div>
                  <div className="font-bold">NexaBot AI Simulator</div>
                  <div className="text-[9px] text-emerald-400">Typing suggestions enabled</div>
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {simMessages.map((msg, idx) => (
                  <div key={idx} className={`space-y-1 ${msg.sender === "user" ? "text-right" : ""}`}>
                    <div className={`rounded-xl p-3 inline-block max-w-[85%] text-left ${
                      msg.sender === "user" ? "bg-slate-900 text-white" : "bg-white text-slate-800 shadow-sm"
                    }`}>
                      <p className="leading-relaxed font-sans">{msg.text}</p>
                    </div>
                    {msg.source && (
                      <div className="text-[8px] text-slate-400 italic block mt-0.5">
                        Fetched source context: <strong>{msg.source}</strong>
                      </div>
                    )}
                  </div>
                ))}

                {simulating && (
                  <div className="flex gap-1.5 items-center text-slate-400 pl-1 py-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
                  </div>
                )}
              </div>

              {/* Phone text form */}
              <form onSubmit={handleSendSimMessage} className="border-t border-slate-200 bg-white p-2 flex gap-1.5 items-center">
                <input
                  type="text"
                  placeholder="Ask receptionist simulated client questions..."
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  className="flex-1 rounded-full border border-slate-200 px-3.5 py-1.5 outline-none focus:border-emerald-500 bg-slate-50 text-[10px]"
                />
                <button
                  type="submit"
                  className="rounded-full bg-emerald-500 hover:bg-emerald-600 p-2 text-white shadow-sm flex items-center justify-center transition-all active:scale-95 shrink-0"
                >
                  <Send className="h-3 w-3" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
