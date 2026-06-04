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
  const name = plan.name.toUpperCase();
  const isPartner = name === "PARTNER";
  const isGrowth = index > 0;
  const isProLike = index > 1 || isPartner;

  return {
    id: `fallback-${plan.name}`,
    name,
    displayName: plan.name,
    description: plan.description,
    priceInPaisa:
      plan.price === "Custom"
        ? 0
        : Number(plan.price.replace(/[^\d]/g, "")) * 100,
    billingCycle: "monthly",
    messageQuota: isPartner ? 100_000 : isGrowth ? 25_000 : 5_000,
    contactLimit: isPartner ? 100_000 : isGrowth ? 10_000 : 1_000,
    agentLimit: isPartner ? 50 : isGrowth ? 10 : 3,
    aiCreditsPerMonth: isPartner ? 50_000 : isGrowth ? 10_000 : 1_000,
    campaignLimit: isPartner ? 500 : isGrowth ? 100 : 20,
    features: plan.features,
    chatbotEnabled: isGrowth,
    creativeStudioEnabled: isGrowth,
    adsIntegrationEnabled: isProLike,
    apiAccessEnabled: isProLike,
  };
}

export function fallbackPublicPlans(): PublicPlan[] {
  return fallbackPlans.map((plan, index) => fallbackToPublicPlan(index, plan));
}

export function formatCurrencyFromPaisa(value: number) {
  if (value <= 0) return "Custom";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value / 100);
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
