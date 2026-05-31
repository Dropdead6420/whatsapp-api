// Plan-quota enforcement.
//
// Tenants are created with `contactLimit` / `campaignLimit` /
// `agentLimit` columns. The customer dashboard (BusinessCards →
// PlanQuotaBar) shows "used / limit" usage bars, so once a tenant
// can see the cap, the API has to honor it. This module is the
// single check used by every create-side route + service. If a
// future call site forgets to invoke it, the dashboard's number
// becomes a lie — so the rule of thumb: every prisma.contact.create
// / prisma.campaign.create goes through one of these assertions.
//
// Why 402 (Payment Required) instead of 403/422?
//   - Mirrors the wallet+billing QUOTA_EXCEEDED status (see
//     wallet.service.ts, billing.service.ts).
//   - The client cue is "upgrade plan or contact billing", not "you
//     have no permission" (403) or "the input was malformed" (422).
//
// `limit <= 0` is treated as unlimited — matches the PlanQuotaBar
// UI which renders "unlimited" for that case.

import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

interface TenantPlan {
  contactLimit: number;
  campaignLimit: number;
}

async function fetchPlan(tenantId: string): Promise<TenantPlan | null> {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { contactLimit: true, campaignLimit: true },
  });
}

/**
 * Throw QUOTA_EXCEEDED if the tenant cannot add `addCount` more
 * contacts. Use addCount > 1 for bulk imports — the check is done
 * against the would-be post-add total, not row-by-row.
 *
 * If the tenant row is missing (deleted mid-request, etc), this
 * skips silently — the create call itself will fail on the FK and
 * the error surfaced there is more useful than a quota 402.
 */
export async function assertContactQuota(
  tenantId: string,
  addCount = 1,
): Promise<void> {
  if (addCount <= 0) return;
  const plan = await fetchPlan(tenantId);
  if (!plan) return;
  if (plan.contactLimit <= 0) return; // 0 / negative = unlimited
  const current = await prisma.contact.count({ where: { tenantId } });
  if (current + addCount > plan.contactLimit) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      `Contact limit reached (${current}/${plan.contactLimit}). ` +
        `Upgrade your plan or remove unused contacts to import ${addCount} more.`,
    );
  }
}

/**
 * Throw QUOTA_EXCEEDED if the tenant cannot create one more campaign.
 * No `addCount` arg because campaigns are always created singly.
 */
export async function assertCampaignQuota(tenantId: string): Promise<void> {
  const plan = await fetchPlan(tenantId);
  if (!plan) return;
  if (plan.campaignLimit <= 0) return;
  const current = await prisma.campaign.count({ where: { tenantId } });
  if (current >= plan.campaignLimit) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      `Campaign limit reached (${current}/${plan.campaignLimit}). ` +
        "Upgrade your plan or archive an existing campaign first.",
    );
  }
}
