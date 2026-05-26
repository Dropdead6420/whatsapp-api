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
      <header className="mb-8">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 mb-2 border border-emerald-100">
          Visual Identity Guide
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
          NexaFlow Design System
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Component guidelines, custom styles, premium layout definitions, and development protocols.
        </p>
      </header>

      {/* State Switcher Controls */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Interactive Page States</h3>
        <div className="flex gap-2">
          {["default", "loading", "empty", "error"].map((s) => (
            <button
              key={s}
              onClick={() => setDemoState(s as typeof demoState)}
              className={`rounded-lg px-4 py-2 text-xs font-bold capitalize transition-all border ${
                demoState === s
                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
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
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                <Layers className="h-4 w-4 text-emerald-500" />
                Theme Colors
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-950 p-4 text-white border border-slate-800">
                  <div className="text-xs font-bold text-emerald-400">Emerald Glow</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400">#10B981 | brand-500</div>
                </div>
                <div className="rounded-xl bg-slate-900 p-4 text-white">
                  <div className="text-xs font-bold">Deep Slate</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400">#0F172A | slate-900</div>
                </div>
                <div className="rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-500 p-4 text-white shadow-md">
                  <div className="text-xs font-bold">Cosmic Teal</div>
                  <div className="mt-1 font-mono text-[10px] text-emerald-100">Premium Gradient</div>
                </div>
                <div className="rounded-xl glass-card p-4 border border-slate-300">
                  <div className="text-xs font-bold text-slate-800">Glassmorphic</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">Backdrop-blur (12px)</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                <Layout className="h-4 w-4 text-indigo-500" />
                Interactive Buttons
              </h2>
              <div className="flex flex-wrap gap-2.5">
                <button className="rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 active:scale-95 shadow-sm shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all">
                  Primary Action
                </button>
                <button className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 active:scale-95 transition-all">
                  Slate Action
                </button>
                <button className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all bg-white">
                  Secondary Action
                </button>
                <button className="rounded-lg bg-red-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-600 active:scale-95 transition-all">
                  Destructive Action
                </button>
                <button className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2.5 text-xs font-bold active:scale-95 transition-all border border-emerald-100">
                  Light Theme Action
                </button>
              </div>
            </div>
          </div>

          {/* Gemini Development Guidelines */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              Gemini-Only UI Development Rules
            </h2>
            <div className="space-y-4 text-xs text-slate-600">
              <div className="flex gap-3">
                <div className="h-5 w-5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">1</div>
                <div>
                  <h4 className="font-bold text-slate-800">Rich Visual Aesthetics Only</h4>
                  <p className="mt-0.5 leading-relaxed">
                    Always useharmonious HSL customized background cards, ambient gradients, and soft backdrops. Avoid boring standard layouts. Ensure interactive elements float, hover, and pulse to create premium depth.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-5 w-5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">2</div>
                <div>
                  <h4 className="font-bold text-slate-800">Mock Data Fallbacks Always</h4>
                  <p className="mt-0.5 leading-relaxed">
                    Never leave pages broken. If database queries or fetch calls fail due to missing local backend instances, fall back to high-fidelity mocks so portals remain interactive and previewable instantly.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-5 w-5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">3</div>
                <div>
                  <h4 className="font-bold text-slate-800">Micro-animations & Interactive Feedbacks</h4>
                  <p className="mt-0.5 leading-relaxed">
                    Every transaction, modal toggle, and tab switcher must animate cleanly. Include smooth transitions, scale clicks, and sliding menus to make components feel responsive and alive.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Frontend Build Order Guidelines */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm bg-radial-glow">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
              <AlertCircle className="h-4 w-4 text-emerald-600" />
              Developer Onboarding & Build Order
            </h2>
            <div className="relative border-l-2 border-slate-200 pl-4 ml-2 space-y-6 text-xs text-slate-600">
              <div className="relative">
                <div className="absolute -left-[23px] h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-100" />
                <h4 className="font-bold text-slate-800">Phase 1: Component Registration & Assets Setup</h4>
                <p className="mt-0.5 leading-relaxed">
                  Design base layout schemas, styling definitions in tailwind and CSS, and import necessary assets.
                </p>
              </div>
              <div className="relative">
                <div className="absolute -left-[23px] h-3.5 w-3.5 rounded-full bg-indigo-500 border-2 border-white ring-2 ring-indigo-100" />
                <h4 className="font-bold text-slate-800">Phase 2: Navigation Mapping & Global Overlays</h4>
                <p className="mt-0.5 leading-relaxed">
                  Integrate path structures in the central DashboardShell and register floating utilities like the AI Copilot.
                </p>
              </div>
              <div className="relative">
                <div className="absolute -left-[23px] h-3.5 w-3.5 rounded-full bg-slate-400 border-2 border-white" />
                <h4 className="font-bold text-slate-800">Phase 3: Interactive Portals & Mock Integration</h4>
                <p className="mt-0.5 leading-relaxed">
                  Develop core portals (Agency settings, wallet ledgers, checkouts, and agent dashboards) powered by fallback mocks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Skeletons / Loaders */}
      {demoState === "loading" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-slate-200" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-slate-200 rounded w-1/4" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="h-3.5 bg-slate-200 rounded" />
            <div className="h-3.5 bg-slate-200 rounded w-5/6" />
            <div className="h-3.5 bg-slate-200 rounded w-2/3" />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
            <div className="h-8 bg-slate-100 rounded" />
            <div className="h-8 bg-slate-100 rounded" />
            <div className="h-8 bg-slate-100 rounded" />
          </div>
        </div>
      )}

      {/* Premium Empty State */}
      {demoState === "empty" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm max-w-xl mx-auto animate-fade-in">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-4 border border-emerald-100">
            <Inbox className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">No active campaigns scheduled</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            Your broadcast campaign list is currently empty. Tap Campaign Autopilot to have our AI generate your first client win-back flow.
          </p>
          <button className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 active:scale-95 transition-all">
            ✦ Open Autopilot
          </button>
        </div>
      )}

      {/* Premium Connection/Error State */}
      {demoState === "error" && (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 shadow-sm max-w-xl mx-auto flex gap-4 items-start animate-slide-up">
          <div className="rounded-xl bg-red-100 border border-red-200 p-2.5 text-red-700 shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-sm font-bold text-slate-900">API Connection Lost</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              We encountered a network timeout while query-syncing your Meta WABA cloud connection. Check Facebook API Status or refresh your credentials.
            </p>
            <div className="flex gap-2 pt-1.5">
              <button className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-red-700 active:scale-95 transition-all">
                Retry Connection
              </button>
              <button className="rounded-lg border border-red-200 px-3.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-red-100 bg-white transition-all">
                WABA Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
