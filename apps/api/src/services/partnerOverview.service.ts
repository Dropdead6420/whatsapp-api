import { prisma } from "@nexaflow/db";

// =====================================================================
// AdGrowly — SuperAdmin Partners overview (admin console "Partners Wallet
// Management"). Read-only aggregation: per partner (a Tenant with a
// partnerModel set), surface the PARTNER_CREDIT wallet balance, the number of
// customer orgs under it, and how many of those are GMB-active. No credit
// writes — this only reads existing wallet/tenant data. The aggregation is a
// pure function so it can be unit-tested without the DB.
// =====================================================================

export interface PartnerOverviewRow {
  id: string;
  name: string;
  /** PartnerModel enum value: RESELLER | BRING_YOUR_OWN_META | HYBRID. */
  type: string;
  /** PARTNER_CREDIT wallet balance in credits (0 if no partner wallet yet). */
  walletBalance: number;
  /** Customer orgs provisioned under this partner. */
  totalOrgs: number;
  /** Of those orgs, how many have at least one GMB location connected. */
  gmbOrgs: number;
}

export interface PartnerAggregateInput {
  id: string;
  name: string;
  partnerModel: string;
  wallets: { type: string; balanceCredits: number }[];
  /** One entry per child org; gmbLocations = that org's connected-location count. */
  children: { gmbLocations: number }[];
}

const PARTNER_WALLET = "PARTNER_CREDIT";

/** Collapse a partner + its wallets + children into a single overview row (pure). */
export function summarizePartner(p: PartnerAggregateInput): PartnerOverviewRow {
  const wallet = p.wallets.find((w) => w.type === PARTNER_WALLET);
  return {
    id: p.id,
    name: p.name,
    type: p.partnerModel,
    walletBalance: wallet?.balanceCredits ?? 0,
    totalOrgs: p.children.length,
    gmbOrgs: p.children.filter((c) => c.gmbLocations > 0).length,
  };
}

/** Overview rows, richest partner first (wallet balance desc, then name). */
export function summarizePartners(rows: PartnerAggregateInput[]): PartnerOverviewRow[] {
  return rows
    .map(summarizePartner)
    .sort((a, b) => b.walletBalance - a.walletBalance || a.name.localeCompare(b.name));
}

/** Load every partner (Tenant with a partnerModel) and build the overview. */
export async function listPartnerOverview(): Promise<PartnerOverviewRow[]> {
  const partners = await prisma.tenant.findMany({
    where: { partnerModel: { not: null } },
    select: {
      id: true,
      name: true,
      partnerModel: true,
      wallets: { select: { type: true, balanceCredits: true } },
      resellChildren: { select: { _count: { select: { gmbLocations: true } } } },
    },
  });

  return summarizePartners(
    partners.map((p) => ({
      id: p.id,
      name: p.name,
      partnerModel: String(p.partnerModel),
      wallets: p.wallets.map((w) => ({ type: String(w.type), balanceCredits: w.balanceCredits })),
      children: p.resellChildren.map((c) => ({ gmbLocations: c._count.gmbLocations })),
    })),
  );
}
