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
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl hover:scale-105 hover:bg-slate-800 active:scale-95 transition-all animate-float border border-slate-700/50"
        title="AI Copy & Assistant"
      >
        <Sparkles className="h-6 w-6 text-emerald-400" />
      </button>

      {/* Slide-out Sidebar Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          {/* Overlay click to close */}
          <div className="flex-1" onClick={() => setIsOpen(false)} />

          {/* Drawer container */}
          <div className="w-full max-w-md h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-950 p-4 text-white">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-400" />
                <div>
                  <h3 className="font-semibold text-sm">NexaFlow AI Copilot</h3>
                  <p className="text-[10px] text-slate-400">Campaign helper & Copywriter</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Campaign Brief Summary */}
              <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 p-4 border border-emerald-500/15">
                <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 mb-2">
                  <BarChart2 className="h-4 w-4 text-emerald-600" />
                  Quick Campaign Radar
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Based on active flows, your booking reminders have a <strong>92.4% open rate</strong>.
                  We recommend launching a <em>Weekend Win-Back campaign</em> targeting clients inactive for 30+ days.
                </p>
              </div>

              {/* AI Creative Studio Draft Form */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                  AI Copywriting Assistant
                </h4>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    What is your campaign campaign goal?
                  </label>
                  <textarea
                    rows={3}
                    placeholder="e.g., win back customers who haven't booked in a month, or offer discount slots for Saturday afternoon"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2.5 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Tone of Voice</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-emerald-500 transition-all bg-white"
                    >
                      <option>Professional</option>
                      <option>Witty</option>
                      <option>Casual</option>
                      <option>Urgent</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleGenerate}
                      disabled={generating || !prompt.trim()}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all h-[36px]"
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 relative overflow-hidden animate-slide-up">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                      ✦ Ready Draft
                    </span>
                    <button
                      onClick={handleCopy}
                      className="rounded-lg p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 border border-transparent hover:border-slate-100 transition-all"
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-mono select-all">
                    {generatedCopy}
                  </p>
                  <p className="text-[10px] text-slate-400 italic">
                    Tip: Double click inside copy area to select all variables easily.
                  </p>
                </div>
              )}
            </div>

            {/* Quick action footer */}
            <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
              <p className="text-[11px] text-slate-500">
                AI uses Anthropic Codex to generate context-optimized copy versions.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
