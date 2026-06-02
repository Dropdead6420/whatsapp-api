// ============================================================================
// Razorpay webhook handler (Claude FINAL §4, slice 3)
//
// Lifecycle: webhook arrives → route verifies HMAC signature → service
// inserts PaymentWebhookLog (UNIQUE on gateway+eventId catches retries)
// → on payment.captured we transition the PaymentOrder from PENDING to
// SUCCEEDED and credit the wallet via adjustWalletIdempotent.
//
// Two layers of idempotency guard the customer's wallet from
// double-credits:
//   1. PaymentWebhookLog (gateway, eventId) UNIQUE — Razorpay retries
//      collide on insert; the handler records the duplicate and skips.
//   2. WalletTransaction (referenceType, referenceId) UNIQUE — even if
//      a duplicate sneaks past layer 1 (e.g. two different event ids
//      pointing at the same order), the ledger refuses the second
//      write.
//
// The PaymentOrder state machine in paymentOrder.service.ts is the
// third defensive layer: a SUCCEEDED order rejects any further
// transition, so we can never roll back a real credit.
//
// We always respond 200 to Razorpay even when something here throws,
// so the gateway stops retrying. Errors are recorded on
// PaymentWebhookLog.processingError for operator review.
// ============================================================================

import {
  prisma,
  type PaymentGateway,
  type PaymentOrder,
  type PaymentWebhookSignatureStatus,
  Prisma,
} from "@nexaflow/db";
import {
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { adjustWalletIdempotent } from "./wallet.service";
import { assertCanTransitionStatus } from "./paymentOrder.service";
import { createInvoiceForPaymentOrder } from "./invoice.service";

export interface RazorpayWebhookContext {
  /** Raw HTTP body, byte-for-byte — needed for signature verification. */
  rawBody: string;
  /** Already-parsed JSON payload. */
  payload: RazorpayEvent;
  /** Result of HMAC verification, written into PaymentWebhookLog. */
  signatureStatus: PaymentWebhookSignatureStatus;
}

export interface RazorpayEvent {
  event: string; // "payment.captured", "payment.failed", "order.paid" ...
  payload: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        error_description?: string | null;
      };
    };
    order?: {
      entity?: {
        id: string;
        amount: number;
        amount_paid?: number;
        status: string;
      };
    };
  };
}

export interface HandleRazorpayEventResult {
  /** What we did — for response body + logs. */
  outcome:
    | "duplicate_ignored"
    | "credited"
    | "marked_failed"
    | "no_matching_order"
    | "unknown_event"
    | "signature_invalid";
  /** PaymentWebhookLog id we wrote. Always set. */
  webhookLogId: string;
  paymentOrderId?: string;
}

const GATEWAY: PaymentGateway = "RAZORPAY";

/**
 * Pure helper — returns the Razorpay event id from the payload using
 * the same lookup the webhook handler uses. Exported for tests so the
 * idempotency mapping is locked down.
 *
 * Razorpay's webhook payload doesn't expose a top-level `id`; the
 * stable per-event identifier is the payment / order entity id under
 * `payload.*.entity.id`. We prefer payment.entity.id when present
 * (covers payment.captured + payment.failed) and fall back to order
 * id for order.paid.
 */
export function extractEventId(payload: RazorpayEvent): string | null {
  const paymentId = payload.payload.payment?.entity?.id;
  if (paymentId) return paymentId;
  const orderId = payload.payload.order?.entity?.id;
  if (orderId) return orderId;
  return null;
}

/**
 * Looks up our PaymentOrder by Razorpay's order id. Returns null when
 * no matching order — the webhook handler records the orphan and
 * acknowledges so Razorpay stops retrying.
 */
async function findPaymentOrder(
  gatewayOrderId: string,
): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findUnique({
    where: {
      gateway_gatewayOrderId: {
        gateway: GATEWAY,
        gatewayOrderId,
      },
    },
  });
}

/**
 * Main entry point. Always resolves — caller wraps in try/catch and
 * uses .processingError to recover.
 */
export async function handleRazorpayEvent(
  ctx: RazorpayWebhookContext,
): Promise<HandleRazorpayEventResult> {
  const eventId = extractEventId(ctx.payload);

  // Insert PaymentWebhookLog first so we always have an audit row,
  // even when subsequent steps blow up. Use a stable eventId
  // fallback ("unknown_<hash>") when Razorpay didn't include one so
  // the UNIQUE index doesn't collide on every payload.
  const stableEventId =
    eventId ?? `unparseable_${Buffer.from(ctx.rawBody).slice(0, 32).toString("hex")}`;

  let webhookLogId: string;
  let duplicate = false;
  try {
    const created = await prisma.paymentWebhookLog.create({
      data: {
        gateway: GATEWAY,
        eventId: stableEventId,
        eventType: ctx.payload.event ?? "unknown",
        signatureStatus: ctx.signatureStatus,
        rawPayload: ctx.rawBody,
        duplicate: false,
      },
      select: { id: true },
    });
    webhookLogId = created.id;
  } catch (err) {
    // P2002 on (gateway, eventId) → retry of an already-processed event.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      duplicate = true;
      const stamp = await prisma.paymentWebhookLog.create({
        data: {
          gateway: GATEWAY,
          eventId: `${stableEventId}_dup_${Date.now()}`,
          eventType: ctx.payload.event ?? "unknown",
          signatureStatus: ctx.signatureStatus,
          rawPayload: ctx.rawBody,
          duplicate: true,
        },
        select: { id: true },
      });
      webhookLogId = stamp.id;
      return { outcome: "duplicate_ignored", webhookLogId };
    }
    throw err;
  }

  // Reject anything that didn't pass HMAC at the route layer. We still
  // wrote a log row above so the operator can investigate.
  if (ctx.signatureStatus !== "VALID") {
    return { outcome: "signature_invalid", webhookLogId };
  }

  const eventName = ctx.payload.event ?? "";
  const paymentEntity = ctx.payload.payload.payment?.entity;
  if (!paymentEntity) {
    return { outcome: "unknown_event", webhookLogId };
  }

  const order = await findPaymentOrder(paymentEntity.order_id);
  if (!order) {
    // Most likely a webhook for an order created by some other system
    // (e.g. another service sharing the same Razorpay account). Record
    // it and move on.
    return { outcome: "no_matching_order", webhookLogId };
  }

  // Stamp the log row with the resolved order id so support can join.
  await prisma.paymentWebhookLog.update({
    where: { id: webhookLogId },
    data: { paymentOrderId: order.id },
  });

  if (eventName === "payment.captured" || eventName === "order.paid") {
    return creditFromCapturedPayment({
      order,
      paymentId: paymentEntity.id,
      webhookLogId,
    });
  }

  if (eventName === "payment.failed") {
    return markOrderFailed({
      order,
      reason:
        paymentEntity.error_description ??
        `Razorpay payment.failed (no description)`,
      webhookLogId,
    });
  }

  if (duplicate) {
    return { outcome: "duplicate_ignored", webhookLogId };
  }
  return { outcome: "unknown_event", webhookLogId };
}

async function creditFromCapturedPayment(args: {
  order: PaymentOrder;
  paymentId: string;
  webhookLogId: string;
}): Promise<HandleRazorpayEventResult> {
  const { order } = args;
  // Already terminal — assertCanTransitionStatus would throw. Treat
  // as duplicate; the wallet was already credited on the first event.
  if (order.status === "SUCCEEDED") {
    return {
      outcome: "duplicate_ignored",
      webhookLogId: args.webhookLogId,
      paymentOrderId: order.id,
    };
  }
  assertCanTransitionStatus(order.status, "SUCCEEDED");

  // Credit the wallet first; if this fails (network blip on the DB
  // transaction), we leave the order PENDING and let Razorpay retry.
  // adjustWalletIdempotent guarantees a second arrival of the same
  // referenceId is a no-op so we don't double-credit on retry.
  const credit = await adjustWalletIdempotent({
    tenantId: order.tenantId,
    actorUserId: order.createdByUserId,
    type: WalletTransactionType.CREDIT_ALLOCATION,
    direction: WalletTransactionDirection.CREDIT,
    amountCredits: order.amount,
    reason: `Razorpay recharge ${args.paymentId}`,
    referenceType: "payment_order",
    referenceId: order.id,
    metadata: {
      paymentId: args.paymentId,
      gatewayOrderId: order.gatewayOrderId,
      currency: order.currency,
    },
  });

  const paidAt = new Date();
  const updatedOrder = await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: "SUCCEEDED",
      ledgerTransactionId: credit.transaction.id,
      paidAt,
    },
  });

  // Auto-generate the customer's invoice. Idempotent — a retried
  // webhook lands on the existing row instead of creating a duplicate.
  // Wrapped in try/catch so an invoice-side hiccup never blocks the
  // wallet credit (the credit is what matters; invoice can be
  // backfilled by a future reconciliation job).
  try {
    await createInvoiceForPaymentOrder(updatedOrder);
  } catch (err) {
    console.warn(
      "[razorpay-webhook] invoice creation failed (credit still booked):",
      (err as Error).message,
    );
  }

  return {
    outcome: "credited",
    webhookLogId: args.webhookLogId,
    paymentOrderId: order.id,
  };
}

async function markOrderFailed(args: {
  order: PaymentOrder;
  reason: string;
  webhookLogId: string;
}): Promise<HandleRazorpayEventResult> {
  if (args.order.status === "FAILED" || args.order.status === "SUCCEEDED") {
    // Terminal — nothing to do.
    return {
      outcome: "duplicate_ignored",
      webhookLogId: args.webhookLogId,
      paymentOrderId: args.order.id,
    };
  }
  assertCanTransitionStatus(args.order.status, "FAILED");
  await prisma.paymentOrder.update({
    where: { id: args.order.id },
    data: {
      status: "FAILED",
      failureReason: args.reason.slice(0, 500),
    },
  });
  return {
    outcome: "marked_failed",
    webhookLogId: args.webhookLogId,
    paymentOrderId: args.order.id,
  };
}
