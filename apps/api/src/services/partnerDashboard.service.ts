export const DEFAULT_PARTNER_MARGIN_BPS = 1500;

export interface PartnerBillingSubscriptionInput {
  tenantId: string;
  planId: string;
  planName: string;
  displayName: string;
  priceInPaisa: number;
  billingCycle: string;
  updatedAt?: Date | string | null;
}

export interface PartnerPlanDistributionRow {
  planId: string;
  name: string;
  count: number;
  percentage: number;
  mrrInPaisa: number;
}

export interface PartnerBillingSummary {
  billingCurrency: "INR";
  activeSubscriptionCount: number;
  baseMrrInPaisa: number;
  agencyProfitInPaisa: number;
  partnerMarginEnabled: boolean;
  partnerMarginBps: number;
  planDistribution: PartnerPlanDistributionRow[];
}

export function monthlyPriceInPaisa(
  priceInPaisa: number,
  billingCycle: string,
): number {
  const safePrice = Math.max(0, Math.round(priceInPaisa));
  const normalizedCycle = billingCycle.trim().toLowerCase();
  if (
    normalizedCycle === "annual" ||
    normalizedCycle === "annually" ||
    normalizedCycle === "year" ||
    normalizedCycle === "yearly"
  ) {
    return Math.round(safePrice / 12);
  }
  return safePrice;
}

export function normalizePartnerMarginBps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PARTNER_MARGIN_BPS;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}

export function summarizePartnerBilling(
  subscriptions: PartnerBillingSubscriptionInput[],
  options: {
    partnerMarginEnabled: boolean;
    partnerMarginBps?: number;
  },
): PartnerBillingSummary {
  const latestByTenant = new Map<string, PartnerBillingSubscriptionInput>();
  for (const subscription of subscriptions) {
    const existing = latestByTenant.get(subscription.tenantId);
    if (!existing || updatedAtMs(subscription) > updatedAtMs(existing)) {
      latestByTenant.set(subscription.tenantId, subscription);
    }
  }

  const activeSubscriptions = Array.from(latestByTenant.values());
  const partnerMarginBps = options.partnerMarginEnabled
    ? normalizePartnerMarginBps(
        options.partnerMarginBps ?? DEFAULT_PARTNER_MARGIN_BPS,
      )
    : 0;

  const groups = new Map<string, PartnerPlanDistributionRow>();
  let baseMrrInPaisa = 0;

  for (const subscription of activeSubscriptions) {
    const mrrInPaisa = monthlyPriceInPaisa(
      subscription.priceInPaisa,
      subscription.billingCycle,
    );
    baseMrrInPaisa += mrrInPaisa;

    const existing = groups.get(subscription.planId);
    if (existing) {
      existing.count += 1;
      existing.mrrInPaisa += mrrInPaisa;
    } else {
      groups.set(subscription.planId, {
        planId: subscription.planId,
        name: subscription.displayName.trim() || subscription.planName,
        count: 1,
        percentage: 0,
        mrrInPaisa,
      });
    }
  }

  const activeSubscriptionCount = activeSubscriptions.length;
  const planDistribution = Array.from(groups.values())
    .map((row) => ({
      ...row,
      percentage: activeSubscriptionCount
        ? Math.round((row.count / activeSubscriptionCount) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.mrrInPaisa !== a.mrrInPaisa) return b.mrrInPaisa - a.mrrInPaisa;
      return a.name.localeCompare(b.name);
    });

  return {
    billingCurrency: "INR",
    activeSubscriptionCount,
    baseMrrInPaisa,
    agencyProfitInPaisa: Math.round((baseMrrInPaisa * partnerMarginBps) / 10_000),
    partnerMarginEnabled: options.partnerMarginEnabled,
    partnerMarginBps,
    planDistribution,
  };
}

function updatedAtMs(subscription: PartnerBillingSubscriptionInput): number {
  if (!subscription.updatedAt) return 0;
  if (subscription.updatedAt instanceof Date) return subscription.updatedAt.getTime();
  const parsed = Date.parse(subscription.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
