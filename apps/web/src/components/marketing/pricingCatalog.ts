import { fallbackPlans } from "./data";

export interface PublicPlan {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  features: string[];
  chatbotEnabled: boolean;
  creativeStudioEnabled: boolean;
  adsIntegrationEnabled: boolean;
  apiAccessEnabled: boolean;
}

export function fallbackToPublicPlan(
  index: number,
  plan: (typeof fallbackPlans)[number],
): PublicPlan {
  const keys = ["STARTER", "GROWTH", "PRO", "ENTERPRISE", "CUSTOM"] as const;
  const name = keys[index] ?? plan.name.toUpperCase();
  const isFree = name === "STARTER";
  const isBasic = name === "GROWTH";
  const isStandard = name === "PRO";
  const isPremium = name === "ENTERPRISE";

  return {
    id: `fallback-${plan.name}`,
    name,
    displayName: plan.name,
    description: plan.description,
    priceInPaisa: plan.priceInPaisa,
    billingCycle: "monthly",
    messageQuota: isFree
      ? 100
      : isBasic
        ? 1_000
        : isStandard
          ? 10_000
          : isPremium
            ? 50_000
            : 250_000,
    contactLimit: isFree
      ? 100
      : isBasic
        ? 1_000
        : isStandard
          ? 10_000
          : isPremium
            ? 50_000
            : 250_000,
    agentLimit: isFree ? 1 : isBasic ? 2 : isStandard ? 5 : isPremium ? 15 : 100,
    aiCreditsPerMonth: isFree
      ? 50
      : isBasic
        ? 200
        : isStandard
          ? 1_000
          : isPremium
            ? 3_500
            : 10_000,
    campaignLimit: isFree ? 1 : isBasic ? 20 : isStandard ? 100 : isPremium ? 500 : 2_000,
    features: plan.features,
    chatbotEnabled: !isFree,
    creativeStudioEnabled: !isFree,
    adsIntegrationEnabled: isPremium || name === "CUSTOM",
    apiAccessEnabled: isPremium || name === "CUSTOM",
  };
}

export function fallbackPublicPlans(): PublicPlan[] {
  return fallbackPlans.map((plan, index) => fallbackToPublicPlan(index, plan));
}

export function formatCurrencyFromPaisa(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function isCustomPlan(plan: Pick<PublicPlan, "name">) {
  return plan.name.toUpperCase() === "CUSTOM";
}

export function formatPlanNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function billingLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "monthly") return "month";
  if (normalized === "annual" || normalized === "yearly") return "year";
  return normalized;
}
