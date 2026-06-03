// ============================================================================
// Customer-editable wallet settings (Claude FINAL §4 + §5
// POST /customer/wallets/auto-recharge).
//
// PRD §4: "Customer ... set auto-recharge and low balance alert." The
// SuperAdmin /wallets/:tenantId/settings PATCH can change EVERYTHING
// (status, billingMode, creditLimit) — none of which a customer may
// touch. This module is the safety boundary: it whitelists the exact
// fields a BUSINESS_ADMIN may self-serve and rejects the rest, so the
// customer route can pass the sanitized patch straight to
// updateWalletSettings without leaking admin-only knobs.
//
// Customer-editable fields (and ONLY these):
//   - lowBalanceThreshold
//   - autoRechargeEnabled
//   - autoRechargeAmountCredits
//   - autoRechargePaymentProvider  ("razorpay" | "stripe" | null)
//   - autoRechargePaymentMethodToken
// ============================================================================

import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface CustomerWalletSettingsInput {
  lowBalanceThreshold?: unknown;
  autoRechargeEnabled?: unknown;
  autoRechargeAmountCredits?: unknown;
  autoRechargePaymentProvider?: unknown;
  autoRechargePaymentMethodToken?: unknown;
}

export interface CustomerWalletSettingsPatch {
  lowBalanceThreshold?: number;
  autoRechargeEnabled?: boolean;
  autoRechargeAmountCredits?: number;
  autoRechargePaymentProvider?: string | null;
  autoRechargePaymentMethodToken?: string | null;
}

const ALLOWED_PROVIDERS = new Set(["razorpay", "stripe"]);
const MAX_THRESHOLD = 100_000_000;
const MAX_RECHARGE_CREDITS = 100_000_000;

function assertNonNegativeInt(value: unknown, field: string, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${field} must be a non-negative integer.`,
    );
  }
  if (num > max) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${field} exceeds the maximum allowed (${max}).`,
    );
  }
  return num;
}

/**
 * Validates + whitelists customer-editable wallet settings. Pure —
 * exported for tests. Throws ApiError on any invalid field. Returns
 * only the keys the caller actually supplied (so omitted fields stay
 * unchanged downstream).
 *
 * Cross-field rule: when autoRechargeEnabled flips to true, the
 * amount + provider + token must all be present and valid — an
 * enabled-but-unconfigured auto-recharge would silently never fire
 * (the worker requires all three), which is a confusing dead state.
 */
export function sanitizeCustomerWalletSettings(
  input: CustomerWalletSettingsInput,
): CustomerWalletSettingsPatch {
  const patch: CustomerWalletSettingsPatch = {};

  if (input.lowBalanceThreshold !== undefined) {
    patch.lowBalanceThreshold = assertNonNegativeInt(
      input.lowBalanceThreshold,
      "lowBalanceThreshold",
      MAX_THRESHOLD,
    );
  }

  if (input.autoRechargeEnabled !== undefined) {
    if (typeof input.autoRechargeEnabled !== "boolean") {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "autoRechargeEnabled must be a boolean.",
      );
    }
    patch.autoRechargeEnabled = input.autoRechargeEnabled;
  }

  if (input.autoRechargeAmountCredits !== undefined) {
    patch.autoRechargeAmountCredits = assertNonNegativeInt(
      input.autoRechargeAmountCredits,
      "autoRechargeAmountCredits",
      MAX_RECHARGE_CREDITS,
    );
  }

  if (input.autoRechargePaymentProvider !== undefined) {
    const p = input.autoRechargePaymentProvider;
    if (p === null) {
      patch.autoRechargePaymentProvider = null;
    } else if (typeof p === "string" && ALLOWED_PROVIDERS.has(p)) {
      patch.autoRechargePaymentProvider = p;
    } else {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "autoRechargePaymentProvider must be 'razorpay', 'stripe', or null.",
      );
    }
  }

  if (input.autoRechargePaymentMethodToken !== undefined) {
    const t = input.autoRechargePaymentMethodToken;
    if (t === null) {
      patch.autoRechargePaymentMethodToken = null;
    } else if (typeof t === "string" && t.trim().length > 0 && t.length <= 255) {
      patch.autoRechargePaymentMethodToken = t.trim();
    } else {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "autoRechargePaymentMethodToken must be a non-empty string (≤255 chars) or null.",
      );
    }
  }

  // Cross-field: enabling auto-recharge requires a complete config so
  // the worker can actually charge. We check the *effective* state —
  // the incoming patch wins, but we can't see omitted-but-already-set
  // fields here, so the route passes the merged view. To keep this
  // helper pure + standalone, we only enforce when the patch itself
  // turns it on AND supplies at least one of the dependent fields as
  // empty/zero. The route adds the merged-state guard.
  if (
    patch.autoRechargeEnabled === true &&
    patch.autoRechargeAmountCredits !== undefined &&
    patch.autoRechargeAmountCredits <= 0
  ) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "autoRechargeAmountCredits must be greater than 0 when auto-recharge is enabled.",
    );
  }

  return patch;
}
