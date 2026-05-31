"use client";

import { ArrowRight, Clock3 } from "lucide-react";
import Link from "next/link";
import { DashboardShell } from "./DashboardShell";
import { useAuth } from "../hooks/useAuth";

export function DashboardPlaceholder({
  title,
  description,
  suggestedHref,
  suggestedLabel,
}: {
  title: string;
  description: string;
  suggestedHref?: string;
  suggestedLabel?: string;
}) {
  const { user, features, loading, signOut } = useAuth({ required: true });

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4">
            <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Clock3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Coming Soon</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
                This dashboard module has its route, navigation, and responsive shell ready.
                The feature workspace can be connected here without changing the app layout.
              </p>
            </div>
          </div>
          {suggestedHref && suggestedLabel && (
            <Link
              href={suggestedHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {suggestedLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}
