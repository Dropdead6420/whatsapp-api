"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DashboardShell } from "./DashboardShell";
import { useAuth } from "../hooks/useAuth";

interface ModuleComingSoonProps {
  title: string;
  description: string;
  highlights?: string[];
}

export function ModuleComingSoon({
  title,
  description,
  highlights = [],
}: ModuleComingSoonProps) {
  const { user, features, loading, signOut } = useAuth({ required: true });

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="space-y-8">
        <section className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300/80">
            NexaFlow module
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-400">{description}</p>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-white">Coming Soon</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  This page is wired into the production navigation so the team can
                  move around the platform today. The full workflow will be built in
                  the next implementation slice.
                </p>
              </div>
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 sm:flex">
                <ArrowRight className="h-5 w-5" />
              </div>
            </div>

            {highlights.length > 0 && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-6 shadow-2xl shadow-black/20">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
              Build order
            </div>
            <ol className="mt-5 space-y-4 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-300">
                  1
                </span>
                Validate the workflow with business-admin users.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-300">
                  2
                </span>
                Connect the API contracts and tenant-scoped data.
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-300">
                  3
                </span>
                Ship the complete operator UI with tests.
              </li>
            </ol>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
