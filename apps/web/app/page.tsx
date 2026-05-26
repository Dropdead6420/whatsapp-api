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
    <main className="flex min-h-full flex-col bg-slate-950 text-white font-sans overflow-x-hidden antialiased bg-cosmic-glow">
      {/* HEADER NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5 text-base font-extrabold tracking-tight hover:scale-105 transition-all">
            <img src="/logo.png" alt="NexaFlow AI Logo" className="h-8 w-8 rounded-lg shadow-emerald-500/10 border border-slate-800" />
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent font-extrabold text-lg">
              NexaFlow AI
            </span>
          </div>
          <nav className="flex items-center gap-4 text-xs font-bold">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-slate-400 hover:text-white transition-all"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20 px-4.5 py-2.5 text-white transition-all active:scale-95 shadow-md"
            >
              Get started free
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pt-16 pb-16 text-center space-y-6">
        {/* Glow ambient background vector */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 h-80 w-80 bg-radial-glow opacity-60 pointer-events-none" />

        <span className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-1 text-xs font-bold text-emerald-400 animate-float">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          The AI-Powered WhatsApp Growth Engine
        </span>

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl text-white">
          Get more bookings, leads, and repeat sales with{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-emerald-500 to-indigo-400 bg-clip-text text-transparent">
            AI-powered WhatsApp automation.
          </span>
        </h1>

        <p className="mx-auto max-w-2xl text-sm sm:text-base text-slate-400 leading-relaxed font-sans font-medium">
          NexaFlow combines Facebook's official WABA Cloud API with custom NLU recepionists, vector knowledge manuals, and campaign autopilots to scale bookings automatically.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3.5">
          <Link
            href="/signup"
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-500 px-6 py-3.5 text-xs font-extrabold text-white shadow-xl hover:scale-105 hover:shadow-emerald-500/10 transition-all active:scale-95"
          >
            Start Free Trial →
          </Link>
          <Link
            href="/login"
            className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-3.5 text-xs font-extrabold hover:bg-slate-800/80 transition-all active:scale-95 text-slate-200"
          >
            Sign In to Dashboard
          </Link>
        </div>

        <div className="pt-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          Built for salons • dental clinics • ecommerce retailers • agencies
        </div>
      </section>

      {/* OUTCOME STATS CARDS STRIP */}
      <section className="border-y border-slate-900 bg-slate-950/40 backdrop-blur-md relative overflow-hidden py-10">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 md:grid-cols-4 text-center">
          {[
            { label: "Win Back Inactives", hint: "Re-engagement Autopilot", metric: "+24% bookings" },
            { label: "Cut Cart Abandonment", hint: "Shopify Webhooks Sync", metric: "14.2% recovery rate" },
            { label: "Expedite Meta Setup", hint: "WABA Display Name Wizard", metric: "10-min onboarding" },
            { label: "Reduce Agent Stress", hint: "AI suggested replies", metric: "3× faster response" }
          ].map((o) => (
            <div key={o.label} className="space-y-1 hover:scale-105 transition-all">
              <div className="text-xs font-semibold text-slate-400">{o.label}</div>
              <div className="text-base font-extrabold text-emerald-400">{o.metric}</div>
              <div className="text-[10px] text-slate-500">{o.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {/* INTERACTIVE PLAYGROUND: AI AUTOPILOT SIMULATOR */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20 grid gap-12 lg:grid-cols-2 items-center">
        <div className="space-y-6">
          <span className="inline-flex rounded-full bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 text-xs font-bold text-indigo-400">
            Interactive Product Sandbox
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
            AI Campaign Autopilot Sandbox.
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Select a target niche category to watch our NLU prompt auditor immediately draft compliance-approved campaign copy and calculate Meta approval scores dynamically.
          </p>

          {/* Toggle niches */}
          <div className="flex gap-2 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800/80 w-fit">
            {[
              { id: "salon", label: "Hair Salon" },
              { id: "clinic", label: "Dental Clinic" },
              { id: "retail", label: "Shopify Store" }
            ].map((n) => (
              <button
                key={n.id}
                onClick={() => setActiveNiche(n.id as typeof activeNiche)}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                  activeNiche === n.id ? "bg-emerald-500 text-white shadow-md" : "text-slate-400 hover:text-white"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        {/* AI simulator card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-md p-6 space-y-4 shadow-2xl relative overflow-hidden animate-slide-up">
          <div className="absolute top-0 right-0 h-20 w-20 bg-radial-glow opacity-30 pointer-events-none" />
          <div className="flex justify-between items-center pb-3 border-b border-slate-800/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" />
              NexaFlow AI Autopilot Draft
            </span>
            <span className="text-[9px] text-slate-500">Niche: {activeNiche}</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 font-bold block mb-0.5">Campaign Goal:</span>
              <div className="font-semibold text-slate-200">{selectedNicheObj.goal}</div>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block mb-0.5">Target Audience Segment:</span>
              <div className="font-semibold text-slate-200">{selectedNicheObj.audience}</div>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold block mb-0.5">Approved WABA Copy:</span>
              <div className="rounded-xl bg-slate-950 p-3.5 text-slate-300 font-mono leading-relaxed border border-slate-800/80 select-all">
                {selectedNicheObj.copy}
              </div>
            </div>
            <div className="flex justify-between items-center bg-slate-950/60 p-2.5 rounded-xl border border-slate-900">
              <span className="text-[10px] font-bold text-slate-400">Meta Approval Predictor:</span>
              <span className="rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 font-bold font-mono text-[10px]">
                {selectedNicheObj.predictedApproval}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* CORE CAPABILITIES GRID */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-extrabold tracking-tight text-center text-white mb-2 sm:text-4xl">
          Designed for Multi-tenant Scale.
        </h2>
        <p className="text-slate-400 text-center text-xs sm:text-sm max-w-xl mx-auto mb-12 leading-relaxed">
          NexaFlow provides complete visual abstractions over the official WhatsApp Cloud APIs, giving you enterprise-grade controls.
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "NLU Receptionist Training", desc: "Inject PDF manuals or scrape web links. Let our chatbot handle FAQ responses instantly.", icon: Sparkles },
            { title: "No-Code Visual Flows", desc: "Drag triggers, logic delays, and database CRM updates using `@xyflow/react` setups.", icon: MessageSquare },
            { title: "White Label agency Panel", desc: "Connect custom DNS records, configure SSLs, pick primary color schemes, and markup payouts.", icon: Globe },
            { title: "Prepaid Wallet & Recharge", desc: "Setup auto-billing recharge boundaries via Stripe and review transaction cost ledger logs.", icon: BarChart2 },
            { title: "Meta Catalog Sync", desc: "Synchronize Shopify catalogs, monitor SKU codes, and publish products inside WABA templates.", icon: Zap },
            { title: "Helpdesk support Tickets", desc: "Integrated split ticket lists and live message timeline dialogues directly inside the portal.", icon: Shield }
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="rounded-2xl border border-slate-900 bg-slate-900/20 p-5 hover:bg-slate-900/40 hover:border-slate-800 transition-all flex flex-col justify-between group">
                <div className="space-y-3">
                  <div className="h-9 w-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-all">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-100">{f.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-sans">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CALL TO ACTION */}
      <section className="bg-slate-950 border-t border-slate-900 py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-radial-glow opacity-30 pointer-events-none" />
        <div className="mx-auto max-w-4xl px-6 text-center space-y-6 relative z-10">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
            Stop sending simple broadcasts. Scale bookings now.
          </h2>
          <p className="mx-auto max-w-xl text-slate-400 text-xs sm:text-sm leading-relaxed">
            Other platforms give you message templates. NexaFlow deploys AI receptionists that convert threads into transactions.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3 text-xs font-extrabold text-white shadow-xl hover:scale-105 transition-all"
            >
              Get Started for Free
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-slate-900/60 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} NexaFlow AI — The AI Customer Growth OS. All rights reserved.
      </footer>
    </main>
  );
}
