// ============================================================================
// Gateway refund reversals (Claude FINAL §4 — completes the payment
// pipeline's deferred refund branch).
//
// When a customer's recharge payment is refunded by Razorpay/Stripe
// (dispute, chargeback, support goodwill), the credits we granted on
// capture must be clawed back. We book a CREDIT_REVERSAL debit on the
// wallet ledger — with allowNegativeBalance, because the customer may
// already have spent those credits and the resulting negative balance
// is a real debt, not an error.
//
// Idempotency: the reversal references the gateway refund id, so a
// retried refund webhook collides on the WalletTransaction
// (walletId, referenceType, referenceId) UNIQUE and books exactly once.
// Distinct partial refunds carry distinct refund ids → distinct
// reversals, which is correct.
//
// We deliberately do NOT change the PaymentOrder status: the capture
// genuinely happened (SUCCEEDED is the truth), and the state machine
// forbids leaving a terminal state anyway. The reversal lives in the
// ledger; the order's history is reconstructable from both rows.
// ============================================================================

import type { PaymentGateway, PaymentOrder } from "@nexaflow/db";
import {
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { adjustWalletIdempotent } from "./wallet.service";

/**
 * Clamps a gateway-reported refund amount to the order's captured
 * amount. Pure — exported for tests.
 *
 * Returns 0 (caller should skip) when:
 *   - the refund amount is non-positive / non-finite
 *   - the order amount is non-positive
 * Caps at the order amount so a malformed "over-refund" payload can't
 * claw back more than was ever charged.
 */
export function computeReversalAmount(
  orderAmount: number,
  refundedAmount: number,
): number {
  if (!Number.isFinite(refundedAmount) || refundedAmount <= 0) return 0;
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return 0;
  return Math.min(Math.trunc(refundedAmount), Math.trunc(orderAmount));
}

export interface RefundReversalResult {
  outcome: "reversed" | "skipped_zero_amount" | "noop_already_reversed";
  reversedCredits: number;
}

/**
 * Books the CREDIT_REVERSAL debit for a refunded payment. Idempotent
 * on (tenantId, "payment_refund", gatewayRefundId).
 */
export async function applyRefundReversal(args: {
  order: Pick<PaymentOrder, "id" | "tenantId" | "amount" | "currency" | "createdByUserId">;
  gateway: PaymentGateway;
  /** Gateway's refund id — the idempotency anchor for this reversal. */
  gatewayRefundId: string;
  /** Smallest-unit amount the gateway says was refunded. */
  refundedAmount: number;
}): Promise<RefundReversalResult> {
  const reversedCredits = computeReversalAmount(
    args.order.amount,
    args.refundedAmount,
  );
  if (reversedCredits <= 0) {
    return { outcome: "skipped_zero_amount", reversedCredits: 0 };
  }

  const result = await adjustWalletIdempotent({
    tenantId: args.order.tenantId,
    actorUserId: args.order.createdByUserId,
    type: WalletTransactionType.CREDIT_REVERSAL,
    direction: WalletTransactionDirection.DEBIT,
    amountCredits: reversedCredits,
    reason: `${args.gateway} refund ${args.gatewayRefundId} for order ${args.order.id}`,
    referenceType: "payment_refund",
    referenceId: args.gatewayRefundId,
    allowNegativeBalance: true,
    metadata: {
      paymentOrderId: args.order.id,
      gateway: args.gateway,
      gatewayRefundId: args.gatewayRefundId,
      currency: args.order.currency,
    },
  });

  // adjustWalletIdempotent returns `idempotent: true` when it found an
  // existing reversal for this refund id (rete-delivered webhook). The
  // fallback adjustWallet path omits the field; we never hit it here
  // (we always pass referenceType + referenceId), so treat missing as
  // a fresh reversal.
  const alreadyReversed =
    "idempotent" in result && result.idempotent === true;
  return {
    outcome: alreadyReversed ? "noop_already_reversed" : "reversed",
    reversedCredits,
  };
}
