// ============================================================================
// Stripe webhook handler (Claude FINAL §4, slice 13)
//
// Mirrors razorpayWebhook.service.ts — three layers of idempotency
// (PaymentWebhookLog UNIQUE + WalletTransaction UNIQUE + PaymentOrder
// state machine) keep a Stripe retry from double-crediting.
//
// Stripe events we care about:
//   payment_intent.succeeded  → CREDIT wallet + transition to SUCCEEDED
//   payment_intent.payment_failed → transition to FAILED
//   charge.refunded → not handled (refund flow is its own slice)
// ============================================================================

import {
  prisma,
  Prisma,
  type PaymentGateway,
  type PaymentOrder,
  type PaymentWebhookSignatureStatus,
} from "@nexaflow/db";
import {
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";
import { adjustWalletIdempotent } from "./wallet.service";
import { assertCanTransitionStatus } from "./paymentOrder.service";
import { createInvoiceForPaymentOrder } from "./invoice.service";

export interface StripeWebhookContext {
  rawBody: string;
  payload: StripeEvent;
  signatureStatus: PaymentWebhookSignatureStatus;
}

export interface StripeEvent {
  id: string;
  type: string; // "payment_intent.succeeded" etc.
  data: {
    object?: {
      id?: string;
      amount?: number;
      currency?: string;
      status?: string;
      last_payment_error?: { message?: string } | null;
    };
  };
}

export interface HandleStripeEventResult {
  outcome:
    | "duplicate_ignored"
    | "credited"
    | "marked_failed"
    | "no_matching_order"
    | "unknown_event"
    | "signature_invalid";
  webhookLogId: string;
  paymentOrderId?: string;
}

const GATEWAY: PaymentGateway = "STRIPE";

/**
 * Returns Stripe's event id from the payload. Unlike Razorpay,
 * Stripe always exposes `event.id` so this never needs a fallback.
 */
export function extractEventId(payload: StripeEvent): string {
  return payload.id ?? "missing_stripe_event_id";
}

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

export async function handleStripeEvent(
  ctx: StripeWebhookContext,
): Promise<HandleStripeEventResult> {
  const eventId = extractEventId(ctx.payload);

  let webhookLogId: string;
  try {
    const created = await prisma.paymentWebhookLog.create({
      data: {
        gateway: GATEWAY,
        eventId,
        eventType: ctx.payload.type ?? "unknown",
        signatureStatus: ctx.signatureStatus,
        rawPayload: ctx.rawBody,
        duplicate: false,
      },
      select: { id: true },
    });
    webhookLogId = created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const stamp = await prisma.paymentWebhookLog.create({
        data: {
          gateway: GATEWAY,
          eventId: `${eventId}_dup_${Date.now()}`,
          eventType: ctx.payload.type ?? "unknown",
          signatureStatus: ctx.signatureStatus,
          rawPayload: ctx.rawBody,
          duplicate: true,
        },
        select: { id: true },
      });
      return { outcome: "duplicate_ignored", webhookLogId: stamp.id };
    }
    throw err;
  }

  if (ctx.signatureStatus !== "VALID") {
    return { outcome: "signature_invalid", webhookLogId };
  }

  const intent = ctx.payload.data?.object;
  if (!intent?.id) {
    return { outcome: "unknown_event", webhookLogId };
  }

  const order = await findPaymentOrder(intent.id);
  if (!order) {
    return { outcome: "no_matching_order", webhookLogId };
  }

  await prisma.paymentWebhookLog.update({
    where: { id: webhookLogId },
    data: { paymentOrderId: order.id },
  });

  if (ctx.payload.type === "payment_intent.succeeded") {
    return creditFromCapturedPayment({
      order,
      paymentIntentId: intent.id,
      webhookLogId,
    });
  }

  if (ctx.payload.type === "payment_intent.payment_failed") {
    return markOrderFailed({
      order,
      reason:
        intent.last_payment_error?.message ??
        "Stripe payment_intent.payment_failed (no description)",
      webhookLogId,
    });
  }

  return { outcome: "unknown_event", webhookLogId };
}

async function creditFromCapturedPayment(args: {
  order: PaymentOrder;
  paymentIntentId: string;
  webhookLogId: string;
}): Promise<HandleStripeEventResult> {
  const { order } = args;
  if (order.status === "SUCCEEDED") {
    return {
      outcome: "duplicate_ignored",
      webhookLogId: args.webhookLogId,
      paymentOrderId: order.id,
    };
  }
  assertCanTransitionStatus(order.status, "SUCCEEDED");

  const credit = await adjustWalletIdempotent({
    tenantId: order.tenantId,
    actorUserId: order.createdByUserId,
    type: WalletTransactionType.CREDIT_ALLOCATION,
    direction: WalletTransactionDirection.CREDIT,
    amountCredits: order.amount,
    reason: `Stripe recharge ${args.paymentIntentId}`,
    referenceType: "payment_order",
    referenceId: order.id,
    metadata: {
      paymentIntentId: args.paymentIntentId,
      gatewayOrderId: order.gatewayOrderId,
      currency: order.currency,
    },
  });

  const updatedOrder = await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: "SUCCEEDED",
      ledgerTransactionId: credit.transaction.id,
      paidAt: new Date(),
    },
  });

  try {
    await createInvoiceForPaymentOrder(updatedOrder);
  } catch (err) {
    console.warn(
      "[stripe-webhook] invoice creation failed (credit still booked):",
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
}): Promise<HandleStripeEventResult> {
  if (args.order.status === "FAILED" || args.order.status === "SUCCEEDED") {
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
