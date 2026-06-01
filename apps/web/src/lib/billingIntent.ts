import type { UserRole } from "@nexaflow/shared";

export interface BillingIntent {
  billing: boolean;
  plan: string | null;
}

export function readBillingIntent(search: string): BillingIntent {
  const params = new URLSearchParams(search);
  return {
    billing: params.get("billing") === "1",
    plan: params.get("plan"),
  };
}

export function readBillingIntentFromWindow(): BillingIntent {
  if (typeof window === "undefined") {
    return { billing: false, plan: null };
  }
  return readBillingIntent(window.location.search);
}

export function billingIntentSearch(intent: BillingIntent): string {
  const params = new URLSearchParams();
  if (intent.billing) params.set("billing", "1");
  if (intent.plan) params.set("plan", intent.plan);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function billingIntentHref(path: string, intent: BillingIntent): string {
  return `${path}${billingIntentSearch(intent)}`;
}

export function pricingSignupHref(planName: string): string {
  return billingIntentHref("/signup", {
    billing: true,
    plan: planName,
  });
}

export function billingDestinationForRole(
  role: UserRole,
  intent: BillingIntent,
  fallback: string,
): string {
  if (!intent.billing) return fallback;
  if (role === "SUPER_ADMIN") {
    return billingIntentHref("/billing", intent);
  }
  return billingIntentHref(fallback, intent);
}
