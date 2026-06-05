"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Minus } from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import {
  billingLabel,
  fallbackPublicPlans,
  formatCurrencyFromPaisa,
  formatPlanNumber,
  isCustomPlan,
  type PublicPlan,
} from "./pricingCatalog";

type ComparisonRow =
  | {
      label: string;
      kind: "text";
      value: (plan: PublicPlan) => string;
    }
  | {
      label: string;
      kind: "boolean";
      value: (plan: PublicPlan) => boolean;
    };

const rows: ComparisonRow[] = [
  {
    label: "Price",
    kind: "text",
    value: (plan) => {
      const price = formatCurrencyFromPaisa(plan.priceInPaisa);
      if (isCustomPlan(plan)) return `${price}+ starting`;
      return `${price} / ${billingLabel(plan.billingCycle)}`;
    },
  },
  {
    label: "WhatsApp messages / month",
    kind: "text",
    value: (plan) => formatPlanNumber(plan.messageQuota),
  },
  {
    label: "Contacts",
    kind: "text",
    value: (plan) => formatPlanNumber(plan.contactLimit),
  },
  {
    label: "Team seats",
    kind: "text",
    value: (plan) => formatPlanNumber(plan.agentLimit),
  },
  {
    label: "Campaigns / month",
    kind: "text",
    value: (plan) => formatPlanNumber(plan.campaignLimit),
  },
  {
    label: "AI credits / month",
    kind: "text",
    value: (plan) => formatPlanNumber(plan.aiCreditsPerMonth),
  },
  {
    label: "Chatbot and workflow automation",
    kind: "boolean",
    value: (plan) => plan.chatbotEnabled,
  },
  {
    label: "AI creative studio",
    kind: "boolean",
    value: (plan) => plan.creativeStudioEnabled,
  },
  {
    label: "Ads integrations",
    kind: "boolean",
    value: (plan) => plan.adsIntegrationEnabled,
  },
  {
    label: "API and developer access",
    kind: "boolean",
    value: (plan) => plan.apiAccessEnabled,
  },
];

export function PricingComparison() {
  const fallback = useMemo(() => fallbackPublicPlans(), []);
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
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setSource("fallback");
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Live comparison is temporarily unavailable.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePlans = plans.slice(0, 5);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {source === "live"
            ? "Comparison is synced from the SuperAdmin plan catalog."
            : "Showing fallback comparison until the API is reachable."}
        </span>
        {error ? <span className="text-amber-700">{error}</span> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[860px] table-fixed text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-700">
              <th className="w-56 px-4 py-3 font-semibold">Capability</th>
              {visiblePlans.map((plan) => (
                <th key={plan.id} className="px-4 py-3 text-center font-semibold">
                  <div className="truncate">{plan.displayName}</div>
                  <div className="mt-1 text-xs font-medium text-slate-500">
                    {isCustomPlan(plan)
                      ? `${formatCurrencyFromPaisa(plan.priceInPaisa)}+`
                      : `${formatCurrencyFromPaisa(plan.priceInPaisa)} / ${billingLabel(
                          plan.billingCycle,
                        )}`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
                <th className="px-4 py-4 text-left font-medium text-slate-800">
                  {row.label}
                </th>
                {visiblePlans.map((plan) => (
                  <td key={`${plan.id}-${row.label}`} className="px-4 py-4 text-center">
                    {row.kind === "boolean" ? (
                      <PlanMark value={row.value(plan)} />
                    ) : (
                      <span className="font-medium text-slate-700">
                        {row.value(plan)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanMark({ value }: { value: boolean }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-50">
      {value ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      ) : (
        <Minus className="h-5 w-5 text-slate-300" />
      )}
    </span>
  );
}
