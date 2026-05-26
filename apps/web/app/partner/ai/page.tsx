"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface AiVariant {
  tone: string;
  copy: string;
  imagePrompt: string;
}

export default function AiGrowthCenterPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  // Autopilot Predictor states
  const [goal, setGoal] = useState("Get more appointments for haircut next weekend");
  const [predicting, setPredicting] = useState(false);
  const [predictionResult, setPredictionResult] = useState<any>(null);

  // Creative Studio copywriting states
  const [selectedTone, setSelectedTone] = useState("Professional");
  const [studioQuery, setStudioQuery] = useState("Season Sale: 20% discount on all spa massages.");
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [variants, setVariants] = useState<AiVariant[]>([]);

  // Reply Suggestion states
  const [chatInput, setChatInput] = useState("Can I cancel my haircut slot booked for Friday?");
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [generatingReplies, setGeneratingReplies] = useState(false);

  // Autopilot goal analyzer
  const handleAnalyzeGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal) return;

    setPredicting(true);
    setPredictionResult(null);

    setTimeout(() => {
      setPredicting(false);
      setPredictionResult({
        targetAudience: "1,250 Contacts (Salon regulars + Churn risks)",
        readRate: "96.4% (Meta Verified)",
        CTR: "14.2% Estimated",
        conversions: "45-60 bookings expected",
        bestTime: "Friday afternoon between 2:00 PM and 4:30 PM",
        summaryText: "Goal: High intent booking drive. Autopilot segments regular clients who haven't visited in 30 days and triggers reminder drafts containing slot links."
      });
    }, 2000);
  };

  // Copy variant generator
  const handleGenerateVariants = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studioQuery) return;

    setGeneratingVariants(true);
    setVariants([]);

    setTimeout(() => {
      setGeneratingVariants(false);
      setVariants([
        {
          tone: "Professional",
          copy: "Unwind and rejuvenate. Treat yourself to a premium spa massage this weekend with an exclusive 20% savings. Book your session: [link]",
          imagePrompt: "Close-up of therapeutic hot massage stones, peaceful spa candle flames, serene wooden table backdrop, cinematic lighting."
        },
        {
          tone: "Urgent",
          copy: "Time is ticking! ⏳ Snag 20% off all luxurious spa massages this weekend only. Limited slots remaining—grab yours now: [link]",
          imagePrompt: "Glowing digital clock overlay, soft warm water massage therapy environment, luxury aromatherapy diffuse focus."
        },
        {
          tone: "Empathetic / Friendly",
          copy: "You've worked hard all week, and you deserve a peaceful break. ❤️ Enjoy a cozy spa massage today for 20% off. Let us take care of you: [link]",
          imagePrompt: "Smiling calm individual relaxing under soft warm towels, steam aroma mist, high resolution photorealistic render."
        }
      ]);
    }, 2000);
  };

  // Chat replies suggestions
  const handleSuggestReplies = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput) return;

    setGeneratingReplies(true);
    setSuggestedReplies([]);

    setTimeout(() => {
      setGeneratingReplies(false);
      setSuggestedReplies([
        "Hi! Yes, you can cancel or reschedule. Simply click here: [link] or let me know the new slot and I will update it immediately.",
        "No problem! Cancellations are free up to 24 hours in advance. Should we shift your slot to Saturday instead?",
        "Sure, I can cancel that slot for you. You will receive a WhatsApp confirmation link in a moment."
      ]);
    }, 1500);
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading AI growth suite…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">AI Additions Growth Center</h1>
        <p className="text-sm text-slate-400">
          Showcase interactive, high-fidelity playgrounds for Autopilot campaign predictor, Copy variant studios, and Reply Assist tools.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        {/* Campaign Autopilot Predictor */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white mb-2">✦ AI Campaign Autopilot Predictor</h2>
            <p className="text-xs text-slate-400 mb-4">
              Enter a marketing objective, and let AI forecast segments size, CTRs, best send-times, and booking outcomes.
            </p>

            <form onSubmit={handleAnalyzeGoal} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-400">
                Marketing Target / Goal
                <input
                  required
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. increase salon haircut bookings this weekend"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={predicting}
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 transition-all duration-300 disabled:opacity-50"
              >
                {predicting ? "Analyzing objective parameters..." : "Predict Campaign Outcomes"}
              </button>
            </form>
          </div>

          {predicting && (
            <div className="mt-4 py-8 flex flex-col items-center justify-center text-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-800 border-t-indigo-500"></div>
              <div className="text-[10px] text-slate-400">Autopilot segment analyzer online...</div>
            </div>
          )}

          {predictionResult && (
            <div className="mt-4 rounded-lg bg-slate-950/60 p-4 border border-slate-800 text-xs space-y-2 animate-fade-in">
              <div className="font-bold text-indigo-400">Autopilot Forecast Report:</div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Audience Scope:</span>
                <span className="text-slate-200 font-medium">{predictionResult.targetAudience}</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Read Probability:</span>
                <span className="text-emerald-400 font-semibold">{predictionResult.readRate}</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Predicted CTR:</span>
                <span className="text-slate-200 font-medium">{predictionResult.CTR}</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Conversion Rate:</span>
                <span className="text-indigo-300 font-bold">{predictionResult.conversions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Best Send Time:</span>
                <span className="text-amber-400 font-medium">{predictionResult.bestTime}</span>
              </div>
              <p className="mt-3 text-[10px] text-slate-400 border-t border-slate-900 pt-2 leading-relaxed">
                {predictionResult.summaryText}
              </p>
            </div>
          )}
        </section>

        {/* Reply Assistant Simulator */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white mb-2">✦ AI Reply Assistant Playground</h2>
            <p className="text-xs text-slate-400 mb-4">
              Inspect how the AI assistant suggests quick reply variants inside live agent chats.
            </p>

            <form onSubmit={handleSuggestReplies} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-400">
                Inbound Customer Inquiry Text
                <input
                  required
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="e.g. how much is a styling session?"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={generatingReplies}
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all duration-300 disabled:opacity-50"
              >
                {generatingReplies ? "Drafting responses..." : "Suggest Live Answers"}
              </button>
            </form>
          </div>

          {generatingReplies && (
            <div className="mt-4 py-8 flex flex-col items-center justify-center text-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-800 border-t-indigo-500"></div>
              <div className="text-[10px] text-slate-400">Analyzing conversation history context...</div>
            </div>
          )}

          {suggestedReplies.length > 0 && (
            <div className="mt-4 space-y-2 animate-fade-in">
              <div className="text-xs font-semibold text-indigo-400">Reply suggestions list:</div>
              {suggestedReplies.map((reply, idx) => (
                <div
                  key={idx}
                  onClick={() => alert(`Replied: ${reply}`)}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300 cursor-pointer hover:bg-slate-900 transition-all"
                >
                  <div className="text-[9px] text-slate-505 font-bold mb-1">Option #{idx + 1} (Click to Send)</div>
                  {reply}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* AI Creative Copywriter Studio */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md mb-6">
        <h2 className="text-base font-bold text-white mb-2">✦ AI Creative Studio (Copywriting & Prompts Generator)</h2>
        <p className="text-xs text-slate-400 mb-6">
          Write a campaign briefing description, and get instant multi-tone copy alternatives paired with matching image generation prompts.
        </p>

        <form onSubmit={handleGenerateVariants} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs font-semibold text-slate-400 sm:col-span-2">
              Campaign Theme / Discount Briefing
              <input
                required
                type="text"
                value={studioQuery}
                onChange={(e) => setStudioQuery(e.target.value)}
                placeholder="e.g. 20% off luxurious body massage for weekend"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-400">
              Creative Tone Selector
              <select
                value={selectedTone}
                onChange={(e) => setSelectedTone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
              >
                <option value="Professional">Professional Standard</option>
                <option value="Urgent">Urgent Countdown</option>
                <option value="Empathetic">Friendly / Personal</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={generatingVariants}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition-all duration-300 disabled:opacity-50"
          >
            {generatingVariants ? "Generating variant suggestions..." : "Generate Creative Asset Variants"}
          </button>
        </form>

        {generatingVariants && (
          <div className="mt-6 py-12 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-800 border-t-indigo-500"></div>
            <div className="text-xs text-slate-400">Stable Diffusion & Anthropic Codex API active...</div>
          </div>
        )}

        {variants.length > 0 && (
          <div className="grid gap-4 md:grid-cols-3 mt-6 animate-fade-in">
            {variants.map((v, idx) => (
              <div key={idx} className="rounded-lg bg-slate-950/60 p-4 border border-slate-800 space-y-4 hover:border-slate-700 transition-all duration-300">
                <div className="flex justify-between items-center text-[10px] font-bold">
                  <span className="text-indigo-400 uppercase">{v.tone}</span>
                  <span className="text-slate-500">Option #{idx + 1}</span>
                </div>
                <div className="text-xs text-slate-300 leading-relaxed italic">
                  "{v.copy}"
                </div>
                <div className="border-t border-slate-900 pt-3 text-[10px] text-slate-400">
                  <div className="font-semibold text-white mb-1">Image Generation Prompt:</div>
                  "{v.imagePrompt}"
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PartnerShell>
  );
}
