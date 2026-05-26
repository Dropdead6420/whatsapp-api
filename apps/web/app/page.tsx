"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkles, MessageSquare, Zap, BarChart2, Check, ArrowRight, Smartphone, Globe, Shield } from "lucide-react";

export default function LandingPage() {
  const [activeNiche, setActiveNiche] = useState<"salon" | "clinic" | "retail">("salon");

  // Simulated AI autopilot campaign drafts
  const mockCampaigns = {
    salon: {
      goal: "Weekend win-back for inactive salon clients",
      audience: "Inactive clients (30+ days)",
      copy: "Hey {{contactName}}, we miss you! 💇‍♂️ Grab a Saturday slots at Cutz & Bangs and get a complimentary hair mask treat. Book here: {{bookingLink}}",
      predictedApproval: "96.4% Low Risk",
    },
    clinic: {
      goal: "Routine checkup reminders for family clinic",
      audience: "Clients due for cleanup in May",
      copy: "Hi {{contactName}}, time for your dental checkup! 🦷 Protect your smile and secure an afternoon slot this Saturday. Book: {{bookingLink}}",
      predictedApproval: "98.2% Low Risk",
    },
    retail: {
      goal: "Abandoned shopping cart win-back alert",
      audience: "Cart abandons from Shopify",
      copy: "Hi {{contactName}}! We held your items for you. 🛍 Complete checkout inside 24 hours to secure 10% off: {{bookingLink}}",
      predictedApproval: "94.8% Low Risk",
    },
  };

  const selectedNicheObj = mockCampaigns[activeNiche];

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-white font-sans overflow-x-hidden antialiased bg-cosmic-glow">
      {/* HEADER NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-slate-950/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3 text-base font-extrabold tracking-tight hover:scale-102 transition-all">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white font-black shadow-md shadow-emerald-500/20">
              N
            </div>
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent font-extrabold text-base tracking-wide">
              NexaFlow AI
            </span>
          </div>
          <nav className="flex items-center gap-4 text-xs font-bold">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2.5 text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/25 px-5 py-2.5 text-white transition-all active:scale-95 border border-emerald-400/25 shadow-md shadow-emerald-500/10 font-bold tracking-wide"
            >
              Get started free
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pt-24 pb-20 text-center space-y-8">
        {/* Glow ambient background vector */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 h-96 w-96 bg-radial-glow opacity-50 pointer-events-none filter blur-3xl" />

        <span className="mx-auto inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-4.5 py-1.5 text-xs font-bold text-emerald-400 animate-float shadow-sm shadow-emerald-500/5">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
          The AI-Powered WhatsApp Growth Engine
        </span>

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl text-white">
          Get more bookings, leads, and repeat sales with{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-emerald-500 to-indigo-400 bg-clip-text text-transparent text-glow-emerald">
            AI-powered WhatsApp automation.
          </span>
        </h1>

        <p className="mx-auto max-w-2xl text-sm sm:text-base text-slate-400 leading-relaxed font-sans font-medium">
          NexaFlow combines Facebook's official WABA Cloud API with custom NLU receptionists, vector knowledge manuals, and campaign autopilots to scale bookings automatically.
        </p>

        <div className="pt-4 flex flex-wrap justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-7 py-4 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-emerald-500/20 hover:scale-105 hover:shadow-emerald-500/30 transition-all duration-300 active:scale-95 border border-emerald-400/25"
          >
            Start Free Trial →
          </Link>
          <Link
            href="/login"
            className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md px-7 py-4 text-xs font-bold uppercase tracking-wider hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-95 text-slate-200"
          >
            Sign In to Dashboard
          </Link>
        </div>

        <div className="pt-4 text-[10px] text-slate-500 uppercase tracking-widest font-extrabold">
          Built for salons • dental clinics • ecommerce retailers • agencies
        </div>
      </section>

      {/* OUTCOME STATS CARDS STRIP */}
      <section className="border-y border-white/5 bg-slate-950/40 backdrop-blur-md relative overflow-hidden py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 md:grid-cols-4 text-center">
          {[
            { label: "Win Back Inactives", hint: "Re-engagement Autopilot", metric: "+24% bookings" },
            { label: "Cut Cart Abandonment", hint: "Shopify Webhooks Sync", metric: "14.2% recovery rate" },
            { label: "Expedite Meta Setup", hint: "WABA Display Name Wizard", metric: "10-min onboarding" },
            { label: "Reduce Agent Stress", hint: "AI suggested replies", metric: "3× faster response" }
          ].map((o) => (
            <div key={o.label} className="space-y-1.5 hover:scale-105 transition-all duration-300">
              <div className="text-xs font-semibold text-slate-400">{o.label}</div>
              <div className="text-lg font-black text-emerald-400 text-glow-emerald">{o.metric}</div>
              <div className="text-[10px] text-slate-500 font-medium">{o.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {/* INTERACTIVE PLAYGROUND: AI AUTOPILOT SIMULATOR */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24 grid gap-12 lg:grid-cols-2 items-center">
        <div className="space-y-6">
          <span className="inline-flex rounded-full bg-indigo-500/10 border border-indigo-500/20 px-3.5 py-1.5 text-xs font-bold text-indigo-400">
            Interactive Product Sandbox
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
            AI Campaign Autopilot Sandbox.
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Select a target niche category to watch our NLU prompt auditor immediately draft compliance-approved campaign copy and calculate Meta approval scores dynamically.
          </p>

          {/* Toggle niches */}
          <div className="flex gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-white/5 w-fit">
            {[
              { id: "salon", label: "Hair Salon" },
              { id: "clinic", label: "Dental Clinic" },
              { id: "retail", label: "Shopify Store" }
            ].map((n) => (
              <button
                key={n.id}
                onClick={() => setActiveNiche(n.id as typeof activeNiche)}
                className={`rounded-xl px-5 py-2 text-xs font-extrabold tracking-wide transition-all duration-300 ${
                  activeNiche === n.id
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        {/* AI simulator card */}
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 backdrop-blur-md p-7 space-y-5 shadow-2xl relative overflow-hidden animate-slide-up glass-card-dark-hover">
          <div className="absolute top-0 right-0 h-24 w-24 bg-radial-glow opacity-30 pointer-events-none filter blur-xl" />
          <div className="flex justify-between items-center pb-3.5 border-b border-white/5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              NexaFlow AI Autopilot Draft
            </span>
            <span className="text-[9px] text-slate-500 font-extrabold uppercase tracking-wide">Niche: {activeNiche}</span>
          </div>

          <div className="space-y-4.5 text-xs">
            <div>
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Campaign Goal:</span>
              <div className="font-semibold text-slate-200">{selectedNicheObj.goal}</div>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Target Audience Segment:</span>
              <div className="font-semibold text-slate-200">{selectedNicheObj.audience}</div>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Approved WABA Copy:</span>
              <div className="rounded-xl bg-slate-950 p-4 text-slate-300 font-mono leading-relaxed border border-white/5 select-all shadow-inner">
                {selectedNicheObj.copy}
              </div>
            </div>
            <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-white/5">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Meta Approval Predictor:</span>
              <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 font-extrabold font-mono text-[10px] uppercase tracking-wider">
                {selectedNicheObj.predictedApproval}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* CORE CAPABILITIES GRID */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <h2 className="text-3xl font-extrabold tracking-tight text-center text-white mb-3 sm:text-4xl">
          Designed for Multi-tenant Scale.
        </h2>
        <p className="text-slate-400 text-center text-xs sm:text-sm max-w-xl mx-auto mb-16 leading-relaxed">
          NexaFlow provides complete visual abstractions over the official WhatsApp Cloud APIs, giving you enterprise-grade controls.
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "NLU Receptionist Training", desc: "Inject PDF manuals or scrape web links. Let our chatbot handle FAQ responses instantly.", icon: Sparkles },
            { title: "No-Code Visual Flows", desc: "Drag triggers, logic delays, and database CRM updates using `@xyflow/react` setups.", icon: MessageSquare },
            { title: "White Label Agency Panel", desc: "Connect custom DNS records, configure SSLs, pick primary color schemes, and markup payouts.", icon: Globe },
            { title: "Prepaid Wallet & Recharge", desc: "Setup auto-billing recharge boundaries via Stripe and review transaction cost ledger logs.", icon: BarChart2 },
            { title: "Meta Catalog Sync", desc: "Synchronize Shopify catalogs, monitor SKU codes, and publish products inside WABA templates.", icon: Zap },
            { title: "Helpdesk Support Tickets", desc: "Integrated split ticket lists and live message timeline dialogues directly inside the portal.", icon: Shield }
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="rounded-2xl border border-white/5 bg-slate-900/10 p-6.5 hover:bg-slate-900/20 hover:border-white/10 transition-all duration-300 flex flex-col justify-between group glass-card-dark-hover">
                <div className="space-y-4">
                  <div className="h-10 w-10 rounded-xl bg-slate-950 border border-white/5 flex items-center justify-center text-emerald-400 group-hover:scale-110 group-hover:border-emerald-500/20 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.1)] transition-all duration-300 shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-100 tracking-wide">{f.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-sans font-medium">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CALL TO ACTION */}
      <section className="bg-slate-950 border-t border-white/5 py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-radial-glow opacity-30 pointer-events-none filter blur-2xl" />
        <div className="mx-auto max-w-4xl px-6 text-center space-y-8 relative z-10">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
            Stop sending simple broadcasts. Scale bookings now.
          </h2>
          <p className="mx-auto max-w-xl text-slate-400 text-xs sm:text-sm leading-relaxed font-medium">
            Other platforms give you message templates. NexaFlow deploys AI receptionists that convert threads into transactions.
          </p>
          <div className="flex justify-center pt-2">
            <Link
              href="/signup"
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 px-7 py-4 text-xs font-bold uppercase tracking-wider text-white shadow-xl shadow-emerald-500/25 hover:scale-105 transition-all duration-300 border border-emerald-400/20"
            >
              Get Started for Free
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-white/5 py-8 text-center text-xs text-slate-500 font-semibold tracking-wide">
        © {new Date().getFullYear()} NexaFlow AI — The AI Customer Growth OS. All rights reserved.
      </footer>
    </main>
  );
}
