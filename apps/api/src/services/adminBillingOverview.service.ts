import {
  DEFAULT_PARTNER_MARGIN_BPS,
  monthlyPriceInPaisa,
  normalizePartnerMarginBps,
} from "./partnerDashboard.service";

export interface AdminBillingSubscriptionInput {
  status: string;
  tenant: {
    id: string;
    parentTenant: {
      id: string;
      name: string;
      partnerMarginEnabled: boolean;
    } | null;
  };
  plan: {
    id: string;
    name: string;
    displayName: string;
    priceInPaisa: number;
    billingCycle: string;
  };
}

export interface AdminPartnerBillingSummary {
  partnerTenantId: string;
  partnerName: string;
  customerCount: number;
  activeSubscriptions: number;
  baseMrrInPaisa: number;
  agencyProfitInPaisa: number;
  partnerMarginEnabled: boolean;
  partnerMarginBps: number;
  planBreakdown: Array<{
    planId: string;
    name: string;
    count: number;
    mrrInPaisa: number;
  }>;
}

export interface AdminBillingOverview {
  activeSubscriptions: number;
  activeMrrInPaisa: number;
  directMrrInPaisa: number;
  partnerMrrInPaisa: number;
  partnerAgencyProfitInPaisa: number;
  partnerSummaries: AdminPartnerBillingSummary[];
}

export function summarizeAdminBillingSubscriptions(
  subscriptions: AdminBillingSubscriptionInput[],
  options: {
    activeStatus?: string;
    partnerMarginBps?: number;
  } = {},
): AdminBillingOverview {
  const activeStatus = options.activeStatus ?? "ACTIVE";
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === activeStatus,
  );
  const activeMrrInPaisa = activeSubscriptions.reduce(
    (sum, subscription) =>
      sum +
      monthlyPriceInPaisa(
        subscription.plan.priceInPaisa,
        subscription.plan.billingCycle,
      ),
    0,
  );
  const partnerSummaries = summarizePartnerSubscriptions(activeSubscriptions, {
    partnerMarginBps: options.partnerMarginBps,
  });
  const partnerMrrInPaisa = partnerSummaries.reduce(
    (sum, row) => sum + row.baseMrrInPaisa,
    0,
  );
  const partnerAgencyProfitInPaisa = partnerSummaries.reduce(
    (sum, row) => sum + row.agencyProfitInPaisa,
    0,
  );

  return {
    activeSubscriptions: activeSubscriptions.length,
    activeMrrInPaisa,
    directMrrInPaisa: activeMrrInPaisa - partnerMrrInPaisa,
    partnerMrrInPaisa,
    partnerAgencyProfitInPaisa,
    partnerSummaries,
  };
}

function summarizePartnerSubscriptions(
  subscriptions: AdminBillingSubscriptionInput[],
  options: {
    partnerMarginBps?: number;
  },
): AdminPartnerBillingSummary[] {
  const configuredMarginBps = normalizePartnerMarginBps(
    options.partnerMarginBps ?? DEFAULT_PARTNER_MARGIN_BPS,
  );
  const partnerMap = new Map<
    string,
    {
      partnerTenantId: string;
      partnerName: string;
      partnerMarginEnabled: boolean;
      partnerMarginBps: number;
      customerIds: Set<string>;
      activeSubscriptions: number;
      baseMrrInPaisa: number;
      agencyProfitInPaisa: number;
      plans: Map<
        string,
        {
          planId: string;
          name: string;
          count: number;
          mrrInPaisa: number;
        }
      >;
    }
  >();

  for (const subscription of subscriptions) {
    const partner = subscription.tenant.parentTenant;
    if (!partner) continue;

    const monthlyMrrInPaisa = monthlyPriceInPaisa(
      subscription.plan.priceInPaisa,
      subscription.plan.billingCycle,
    );
    const marginBps = partner.partnerMarginEnabled ? configuredMarginBps : 0;
    const existing =
      partnerMap.get(partner.id) ??
      {
        partnerTenantId: partner.id,
        partnerName: partner.name,
        partnerMarginEnabled: partner.partnerMarginEnabled,
        partnerMarginBps: marginBps,
        customerIds: new Set<string>(),
        activeSubscriptions: 0,
        baseMrrInPaisa: 0,
        agencyProfitInPaisa: 0,
        plans: new Map(),
      };

    existing.customerIds.add(subscription.tenant.id);
    existing.activeSubscriptions += 1;
    existing.baseMrrInPaisa += monthlyMrrInPaisa;
    existing.agencyProfitInPaisa += Math.round(
      (monthlyMrrInPaisa * marginBps) / 10_000,
    );

    const plan =
      existing.plans.get(subscription.plan.id) ??
      {
        planId: subscription.plan.id,
        name: subscription.plan.displayName || subscription.plan.name,
        count: 0,
        mrrInPaisa: 0,
      };
    plan.count += 1;
    plan.mrrInPaisa += monthlyMrrInPaisa;
    existing.plans.set(subscription.plan.id, plan);
    partnerMap.set(partner.id, existing);
  }

  return Array.from(partnerMap.values())
    .map((partner) => ({
      partnerTenantId: partner.partnerTenantId,
      partnerName: partner.partnerName,
      customerCount: partner.customerIds.size,
      activeSubscriptions: partner.activeSubscriptions,
      baseMrrInPaisa: partner.baseMrrInPaisa,
      agencyProfitInPaisa: partner.agencyProfitInPaisa,
      partnerMarginEnabled: partner.partnerMarginEnabled,
      partnerMarginBps: partner.partnerMarginBps,
      planBreakdown: Array.from(partner.plans.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.mrrInPaisa !== a.mrrInPaisa) return b.mrrInPaisa - a.mrrInPaisa;
        return a.name.localeCompare(b.name);
      }),
    }))
    .sort((a, b) => b.baseMrrInPaisa - a.baseMrrInPaisa);
}
