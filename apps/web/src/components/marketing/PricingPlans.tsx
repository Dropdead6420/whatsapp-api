"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { CheckList } from "./MarketingShell";
import { fallbackPlans } from "./data";

interface PublicPlan {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  features: string[];
  chatbotEnabled: boolean;
  creativeStudioEnabled: boolean;
  adsIntegrationEnabled: boolean;
  apiAccessEnabled: boolean;
}

function fallbackToPublicPlan(index: number, plan: (typeof fallbackPlans)[number]): PublicPlan {
  return {
    id: `fallback-${plan.name}`,
    name: plan.name.toUpperCase(),
    displayName: plan.name,
    description: plan.description,
    priceInPaisa:
      plan.price === "Custom"
        ? 0
        : Number(plan.price.replace(/[^\d]/g, "")) * 100,
    billingCycle: "monthly",
    features: plan.features,
    chatbotEnabled: index > 0,
    creativeStudioEnabled: index > 0,
    adsIntegrationEnabled: index > 1,
    apiAccessEnabled: index > 1,
  };
}

function formatCurrencyFromPaisa(value: number) {
  if (value <= 0) return "Custom";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function billingLabel(value: string) {
  if (!value) return "month";
  if (value === "monthly") return "month";
  if (value === "annual") return "year";
  return value;
}

export function PricingPlans({
  compact = false,
  showSourceNote = false,
}: {
  compact?: boolean;
  showSourceNote?: boolean;
}) {
  const fallback = useMemo(
    () => fallbackPlans.map((plan, index) => fallbackToPublicPlan(index, plan)),
    [],
  );
  const [plans, setPlans] = useState<PublicPlan[]>(fallback);
  const [source, setSource] = useState<"live" | "fallback">("fallback");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<PublicPlan[]>("/api/v1/pricing/plans", {
          auth: false,
        });
        if (cancelled) return;
        if (data.length > 0) {
          setPlans(data);
          setSource("live");
        }
      } catch (err) {
        if (cancelled) return;
        setSource("fallback");
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Live pricing is temporarily unavailable.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePlans = compact ? plans.slice(0, 3) : plans;
  const featuredIndex = Math.min(1, Math.max(0, visiblePlans.length - 1));

  return (
    <div>
      {showSourceNote ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            {source === "live"
              ? "Pricing is loaded from the SuperAdmin plan catalog."
              : "Showing fallback pricing until the API is reachable."}
          </span>
          {error ? <span className="text-amber-700">{error}</span> : null}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {visiblePlans.map((plan, index) => {
          const featured = index === featuredIndex && visiblePlans.length > 1;
          const custom = plan.priceInPaisa <= 0 || plan.name === "CUSTOM";
          return (
            <div
              key={plan.id}
              className={`rounded-lg border p-6 ${
                featured
                  ? "border-emerald-300 bg-white shadow-xl shadow-emerald-100"
                  : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">
                    {plan.displayName}
                  </h3>
                  <p className="mt-2 min-h-[72px] text-sm leading-6 text-slate-600">
                    {plan.description ??
                      "Managed from the SuperAdmin plan catalog."}
                  </p>
                </div>
                {featured ? (
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                    Popular
                  </span>
                ) : null}
              </div>
              <div className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                {formatCurrencyFromPaisa(plan.priceInPaisa)}
                {!custom ? (
                  <span className="text-sm font-medium text-slate-500">
                    {" "}
                    /{billingLabel(plan.billingCycle)}
                  </span>
                ) : null}
              </div>
              <Link
                href="/signup"
                className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold ${
                  featured
                    ? "bg-slate-950 text-white hover:bg-slate-800"
                    : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {custom ? "Talk to us" : "Start now"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="mt-6">
                <CheckList items={plan.features} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
