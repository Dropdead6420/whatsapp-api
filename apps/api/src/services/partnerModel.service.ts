// ============================================================================
// Partner model rules (Claude Final Corrected Billing §4)
//
// Three partner models, each constraining which provider-ownership +
// credit-source a customer under that partner may use:
//
//   Model A — RESELLER: partner resells on NexaFlow's provider + rates.
//     Provider is always NEXAFLOW_OWNED. Credit comes from the
//     customer's own wallet or (if the partner fronts it) the partner
//     wallet / partner credit line.
//
//   Model B — BRING_YOUR_OWN_META: partner brings their own Meta/BSP
//     credentials. Provider is PARTNER_OWNED. Same credit options.
//
//   Model C — HYBRID: per-customer choice — provider may be NexaFlow-,
//     partner-, or customer-owned, and any credit source.
//
// Pure helpers so the provisioning route + tests share one rule set;
// no DB here.
// ============================================================================

import type {
  CreditSource,
  PartnerModel,
  ProviderOwnership,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/** Provider ownerships each model permits for its customers. */
const ALLOWED_OWNERSHIP: Record<PartnerModel, ReadonlyArray<ProviderOwnership>> = {
  RESELLER: ["NEXAFLOW_OWNED"],
  BRING_YOUR_OWN_META: ["PARTNER_OWNED"],
  HYBRID: ["NEXAFLOW_OWNED", "PARTNER_OWNED", "CUSTOMER_OWNED"],
};

/**
 * Credit sources permitted in general. PARTNER_* sources additionally
 * require the partner to have margin/credit enabled — that's checked
 * by the route with the partner row, not here.
 */
const ALL_CREDIT_SOURCES: ReadonlyArray<CreditSource> = [
  "CUSTOMER_WALLET",
  "PARTNER_WALLET",
  "PARTNER_CREDIT_LINE",
  "CUSTOMER_CREDIT_LINE",
];

export function allowedOwnershipsFor(
  model: PartnerModel,
): ReadonlyArray<ProviderOwnership> {
  return ALLOWED_OWNERSHIP[model];
}

/** True iff this provider ownership is valid under the given model. */
export function isOwnershipAllowed(
  model: PartnerModel,
  ownership: ProviderOwnership,
): boolean {
  return ALLOWED_OWNERSHIP[model].includes(ownership);
}

/** True iff the credit source is a partner-funded one. */
export function isPartnerFundedSource(source: CreditSource): boolean {
  return source === "PARTNER_WALLET" || source === "PARTNER_CREDIT_LINE";
}

export interface PartnerModelConfigInput {
  partnerModel: PartnerModel;
  providerOwnership: ProviderOwnership;
  creditSource: CreditSource;
  /** Whether the partner is allowed to fund customers (margin enabled). */
  partnerMarginEnabled?: boolean;
}

/**
 * Validates a (model, ownership, creditSource) triple for a customer
 * being provisioned under a partner. Throws ApiError on any violation.
 * Pure — exported for tests + reused by the provisioning route.
 */
export function assertValidPartnerModelConfig(
  input: PartnerModelConfigInput,
): void {
  if (!ALL_CREDIT_SOURCES.includes(input.creditSource)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unknown credit source ${input.creditSource}.`,
    );
  }
  if (!isOwnershipAllowed(input.partnerModel, input.providerOwnership)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Provider ownership ${input.providerOwnership} is not allowed under a ${input.partnerModel} partner. ` +
        `Allowed: ${ALLOWED_OWNERSHIP[input.partnerModel].join(", ")}.`,
    );
  }
  // Partner-funded credit requires the partner to have margin/credit
  // enabled — otherwise the customer must fund their own wallet.
  if (
    isPartnerFundedSource(input.creditSource) &&
    input.partnerMarginEnabled === false
  ) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Credit source ${input.creditSource} requires the partner to have margin/credit enabled.`,
    );
  }
}

/**
 * Returns the default (providerOwnership, creditSource) for a freshly
 * provisioned customer under each model — the safe baseline the
 * provisioning route uses when the operator doesn't override. Pure.
 */
export function defaultCustomerConfigFor(model: PartnerModel): {
  providerOwnership: ProviderOwnership;
  creditSource: CreditSource;
} {
  switch (model) {
    case "BRING_YOUR_OWN_META":
      return { providerOwnership: "PARTNER_OWNED", creditSource: "CUSTOMER_WALLET" };
    case "HYBRID":
    case "RESELLER":
    default:
      return { providerOwnership: "NEXAFLOW_OWNED", creditSource: "CUSTOMER_WALLET" };
  }
}
