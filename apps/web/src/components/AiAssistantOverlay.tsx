"use client";

import { useState } from "react";
import { Sparkles, X, Copy, Check, MessageSquare, Send, BarChart2 } from "lucide-react";

export function AiAssistantOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("Professional");
  const [generating, setGenerating] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mockCopyOptions: Record<string, string[]> = {
    Professional: [
      "Hello {{contactName}}, we noticed you haven't visited Cutz & Bangs in a while. Book your next grooming session today and receive a complimentary hair conditioning treatment. Reserve here: {{bookingLink}}",
      "Dear {{contactName}}, secure your exclusive spot for our premium automation workshop. Seats are filling fast. Register now: {{bookingLink}} - NexaFlow team.",
    ],
    Witty: [
      "Hey {{contactName}}! Your hair called... it misses us. 💇‍♂️ Book a salon slot this weekend and get 15% off before your mirror starts complaining! {{bookingLink}}",
      "Is your WhatsApp inbox looking a bit lonely? 📱 Spice it up with NexaFlow campaigns that actually convert. Tap to start free: {{bookingLink}}",
    ],
    Casual: [
      "Hi {{contactName}}! Just checking in to see if you wanted to grab an appointment this week. We have a few slots open on Saturday! Let us know or book here: {{bookingLink}}",
      "Hey there! Ready to scale your salon's bookings? Let's get those reminders automated. Click here to check it out: {{bookingLink}}",
    ],
    Urgent: [
      "ALERT {{contactName}}: Only 3 slots remaining for this Saturday at Cutz & Bangs! Don't miss out. Claim your appointment now: {{bookingLink}}",
      "FINAL HOURS: Grab your NexaFlow lifetime deal add-on before price doubles tonight! Lock it in: {{bookingLink}}",
    ],
  };

  function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGeneratedCopy(null);
    setTimeout(() => {
      const options = mockCopyOptions[tone] || mockCopyOptions.Professional;
      const index = Math.floor(Math.random() * options.length);
      setGeneratedCopy(options[index]);
      setGenerating(false);
    }, 1200);
  }

  function handleCopy() {
    if (!generatedCopy) return;
    navigator.clipboard.writeText(generatedCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {/* Floating Sparkle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-lg shadow-emerald-500/25 hover:scale-105 hover:shadow-emerald-500/35 active:scale-95 transition-all duration-300 animate-float border border-emerald-400/30"
        title="AI Copy & Assistant"
      >
        <Sparkles className="h-6 w-6 text-white animate-pulse" />
      </button>

      {/* Slide-out Sidebar Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          {/* Overlay click to close */}
          <div className="flex-1" onClick={() => setIsOpen(false)} />

          {/* Drawer container */}
          <div className="w-full max-w-md h-full bg-slate-950/95 border-l border-white/5 shadow-2xl flex flex-col animate-slide-up backdrop-blur-xl relative z-30">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 bg-slate-950/90 p-5 text-white">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-emerald-400 text-glow-emerald" />
                <div>
                  <h3 className="font-bold text-sm tracking-wide">NexaFlow AI Copilot</h3>
                  <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Campaign helper & Copywriter</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 text-slate-300">
              {/* Campaign Brief Summary */}
              <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 p-5 border border-white/5 relative overflow-hidden glass-card-dark-hover">
                <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-25 pointer-events-none filter blur-xl" />
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-2">
                  <BarChart2 className="h-4.5 w-4.5 text-emerald-400" />
                  Quick Campaign Radar
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Based on active flows, your booking reminders have a <strong className="text-emerald-450">92.4% open rate</strong>.
                  We recommend launching a <em>Weekend Win-Back campaign</em> targeting clients inactive for 30+ days.
                </p>
              </div>

              {/* AI Creative Studio Draft Form */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-extrabold text-slate-455 uppercase tracking-widest">
                  AI Copywriting Assistant
                </h4>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    What is your campaign goal?
                  </label>
                  <textarea
                    rows={3}
                    placeholder="e.g., win back customers who haven't booked in a month, or offer discount slots for Saturday afternoon"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 text-xs text-slate-200 outline-none focus:border-emerald-500 transition-all placeholder:text-slate-650 shadow-inner"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tone of Voice</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs text-slate-250 outline-none focus:border-emerald-500 transition-all"
                    >
                      <option className="bg-slate-950 text-slate-250">Professional</option>
                      <option className="bg-slate-950 text-slate-250">Witty</option>
                      <option className="bg-slate-950 text-slate-250">Casual</option>
                      <option className="bg-slate-950 text-slate-250">Urgent</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !prompt.trim()}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-450 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all h-[38px] shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 border border-emerald-450/20"
                    >
                      {generating ? (
                        <>
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Drafting...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Generate Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Output pane */}
              {generatedCopy && (
                <div className="rounded-2xl border border-white/5 bg-slate-950/80 p-5 space-y-4 relative overflow-hidden animate-slide-up shadow-inner">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 uppercase tracking-wider">
                      ✦ Ready Draft
                    </span>
                    <button
                      onClick={handleCopy}
                      className="rounded-xl p-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/5 transition-all"
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-mono select-all bg-slate-900/60 p-4 rounded-xl border border-white/5">
                    {generatedCopy}
                  </p>
                  <p className="text-[10px] text-slate-500 font-semibold tracking-wide uppercase">
                    Tip: Double click inside copy area to select all variables easily.
                  </p>
                </div>
              )}
            </div>

            {/* Quick action footer */}
            <div className="border-t border-white/5 bg-slate-950 p-5 text-center">
              <p className="text-[10px] text-slate-500 font-semibold tracking-wide">
                AI uses Anthropic Codex to generate context-optimized copy versions.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
