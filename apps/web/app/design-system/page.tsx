"use client";

import { useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { Sparkles, AlertCircle, AlertOctagon, HelpCircle, Inbox, RefreshCw, Layers, Layout, ShieldAlert } from "lucide-react";

export default function DesignSystemPage() {
  const { user, loading, signOut } = useAuth({ required: true });
  const [demoState, setDemoState] = useState<"default" | "loading" | "empty" | "error">("default");

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-10 animate-fade-in">
        <span className="inline-flex rounded-full bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-3">
          Visual Identity Guide
        </span>
        <h1 className="text-3xl font-extrabold tracking-wide text-white text-glow-emerald">
          NexaFlow Design System
        </h1>
        <p className="mt-1.5 text-xs font-medium text-slate-500 tracking-wide">
          Component guidelines, custom styles, premium layout definitions, and development protocols.
        </p>
      </header>

      {/* State Switcher Controls */}
      <section className="mb-8 rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden animate-slide-up glass-card-dark-hover">
        <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-25 pointer-events-none filter blur-xl" />
        <h3 className="text-[10px] font-extrabold text-slate-450 uppercase tracking-widest mb-4">Interactive Page States</h3>
        <div className="flex flex-wrap gap-2.5">
          {["default", "loading", "empty", "error"].map((s) => (
            <button
              key={s}
              onClick={() => setDemoState(s as typeof demoState)}
              className={`rounded-xl px-4.5 py-2.5 text-xs font-bold capitalize transition-all duration-300 border ${
                demoState === s
                  ? "bg-emerald-500 text-white border-emerald-400/25 shadow-md shadow-emerald-500/10"
                  : "bg-white/5 text-slate-350 border-white/10 hover:bg-white/10 hover:text-white"
              }`}
            >
              {s} State
            </button>
          ))}
        </div>
      </section>

      {demoState === "default" && (
        <div className="space-y-8 animate-slide-up">
          {/* Typography & Colors */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden glass-card-dark-hover">
              <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-20 pointer-events-none filter blur-xl" />
              <h2 className="text-sm font-extrabold text-slate-200 mb-5 flex items-center gap-2 border-b border-white/5 pb-3.5">
                <Layers className="h-4.5 w-4.5 text-emerald-400" />
                Theme Colors
              </h2>
              <div className="grid grid-cols-2 gap-3.5">
                <div className="rounded-xl bg-slate-950 p-4 text-white border border-white/5">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">Emerald Glow</div>
                  <div className="mt-1 font-mono text-[9px] text-slate-500">rgb(16 185 129)</div>
                </div>
                <div className="rounded-xl bg-slate-900/80 p-4 text-white border border-white/5">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">Cosmic Dark</div>
                  <div className="mt-1 font-mono text-[9px] text-slate-500">rgb(3 7 18)</div>
                </div>
                <div className="rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-500 p-4 text-white shadow-md border border-emerald-400/10">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-100">Cosmic Teal</div>
                  <div className="mt-1 font-mono text-[9px] text-emerald-200">Gradient Blend</div>
                </div>
                <div className="rounded-xl bg-white/5 backdrop-blur-md p-4 border border-white/10">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-200">Glassmorphic</div>
                  <div className="mt-1 font-mono text-[9px] text-slate-450">Blur 20px / Border 10%</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden glass-card-dark-hover">
              <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-20 pointer-events-none filter blur-xl" />
              <h2 className="text-sm font-extrabold text-slate-200 mb-5 flex items-center gap-2 border-b border-white/5 pb-3.5">
                <Layout className="h-4.5 w-4.5 text-indigo-400" />
                Interactive Buttons
              </h2>
              <div className="flex flex-wrap gap-3">
                <button className="rounded-xl bg-emerald-500 px-4.5 py-2.5 text-xs font-bold text-white hover:bg-emerald-400 active:scale-95 shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/25 transition-all duration-350 border border-emerald-450/20">
                  Primary Action
                </button>
                <button className="rounded-xl bg-slate-950 px-4.5 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-900 active:scale-95 transition-all duration-350 border border-white/5">
                  Slate Action
                </button>
                <button className="rounded-xl border border-white/10 bg-white/5 px-4.5 py-2.5 text-xs font-bold text-white hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all duration-350">
                  Secondary Action
                </button>
                <button className="rounded-xl bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 hover:text-red-300 px-4.5 py-2.5 text-xs font-bold active:scale-95 transition-all duration-350 shadow-sm shadow-red-500/5">
                  Destructive Action
                </button>
                <button className="rounded-xl bg-slate-950/40 backdrop-blur-md text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-slate-900/60 px-4.5 py-2.5 text-xs font-bold active:scale-95 transition-all duration-350">
                  Glassmorphism
                </button>
              </div>
            </div>
          </div>

          {/* Gemini Development Guidelines */}
          <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden glass-card-dark-hover">
            <h2 className="text-sm font-extrabold text-slate-200 mb-5 flex items-center gap-2 border-b border-white/5 pb-3.5">
              <Sparkles className="h-4.5 w-4.5 text-emerald-400" />
              Gemini-Only UI Development Rules
            </h2>
            <div className="space-y-5 text-xs text-slate-400">
              <div className="flex gap-4">
                <div className="h-6 w-6 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center font-bold shrink-0 text-[10px]">1</div>
                <div>
                  <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Rich Visual Aesthetics Only</h4>
                  <p className="mt-1 leading-relaxed text-slate-400">
                    Always use harmonious HSL customized background cards, ambient glows, and soft backdrops. Avoid boring standard layouts. Ensure interactive elements float, hover, and scale clicks to create premium depth.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-6 w-6 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center font-bold shrink-0 text-[10px]">2</div>
                <div>
                  <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Mock Data Fallbacks Always</h4>
                  <p className="mt-1 leading-relaxed text-slate-400">
                    Never leave pages broken. If database queries or fetch calls fail due to missing local backend instances, fall back to high-fidelity mocks so portals remain interactive and previewable instantly.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-6 w-6 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 flex items-center justify-center font-bold shrink-0 text-[10px]">3</div>
                <div>
                  <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Micro-animations & Interactive Feedbacks</h4>
                  <p className="mt-1 leading-relaxed text-slate-400">
                    Every transaction, modal toggle, and tab switcher must animate cleanly. Include smooth transitions, scale clicks, and sliding menus to make components feel responsive and alive.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Frontend Build Order Guidelines */}
          <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl relative overflow-hidden glass-card-dark-hover bg-radial-glow">
            <h2 className="text-sm font-extrabold text-slate-200 mb-5 flex items-center gap-2 border-b border-white/5 pb-3.5">
              <AlertCircle className="h-4.5 w-4.5 text-emerald-400" />
              Developer Onboarding & Build Order
            </h2>
            <div className="relative border-l border-white/10 pl-5 ml-2.5 space-y-6 text-xs text-slate-450">
              <div className="relative">
                <div className="absolute -left-[25.5px] h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
                <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Phase 1: Component Registration & Assets Setup</h4>
                <p className="mt-1 leading-relaxed">
                  Design base layout schemas, styling definitions in tailwind and CSS, and import necessary assets.
                </p>
              </div>
              <div className="relative">
                <div className="absolute -left-[25.5px] h-2.5 w-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20" />
                <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Phase 2: Navigation Mapping & Global Overlays</h4>
                <p className="mt-1 leading-relaxed">
                  Integrate path structures in the central DashboardShell and register floating utilities like the AI Copilot.
                </p>
              </div>
              <div className="relative">
                <div className="absolute -left-[25.5px] h-2.5 w-2.5 rounded-full bg-slate-600" />
                <h4 className="font-extrabold text-slate-200 uppercase tracking-wider text-[10px]">Phase 3: Interactive Portals & Mock Integration</h4>
                <p className="mt-1 leading-relaxed">
                  Develop core portals (Agency settings, wallet ledgers, checkouts, and agent dashboards) powered by fallback mocks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Skeletons / Loaders */}
      {demoState === "loading" && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl space-y-6 animate-pulse glass-card-dark-hover">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-white/5" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-white/5 rounded w-1/4" />
              <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="h-3.5 bg-white/5 rounded" />
            <div className="h-3.5 bg-white/5 rounded w-5/6" />
            <div className="h-3.5 bg-white/5 rounded w-2/3" />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/5">
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
            <div className="h-8 bg-white/5 rounded" />
          </div>
        </div>
      )}

      {/* Premium Empty State */}
      {demoState === "empty" && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-12 text-center shadow-xl max-w-xl mx-auto animate-fade-in glass-card-dark-hover relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-radial-glow opacity-25 pointer-events-none filter blur-xl" />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-5 border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
            <Inbox className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-extrabold text-slate-200 tracking-wide uppercase">No active campaigns scheduled</h3>
          <p className="mt-2.5 text-xs text-slate-450 max-w-sm mx-auto leading-relaxed font-medium">
            Your broadcast campaign list is currently empty. Tap Campaign Autopilot to have our AI generate your first client win-back flow.
          </p>
          <button className="mt-5 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-400 active:scale-95 transition-all shadow-md shadow-emerald-500/10">
            ✦ Open Autopilot
          </button>
        </div>
      )}

      {/* Premium Connection/Error State */}
      {demoState === "error" && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-7 shadow-xl max-w-xl mx-auto flex gap-4.5 items-start animate-slide-up glass-card-dark-hover">
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-red-400 shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-2.5 flex-1">
            <h3 className="text-sm font-extrabold text-slate-200 tracking-wide uppercase">API Connection Lost</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              We encountered a network timeout while query-syncing your Meta WABA cloud connection. Check Facebook API Status or refresh your credentials.
            </p>
            <div className="flex gap-2.5 pt-2">
              <button className="rounded-xl bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-400 active:scale-95 transition-all shadow-md shadow-red-500/10">
                Retry Connection
              </button>
              <button className="rounded-xl border border-red-500/25 bg-white/5 text-slate-250 hover:bg-white/10 hover:border-red-550/40 px-4 py-2 text-xs font-bold active:scale-95 transition-all">
                WABA Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
