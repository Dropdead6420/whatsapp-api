// ============================================================================
// SuperAdmin payment operations read layer (Claude FINAL §4 — "SuperAdmin
// sees ... payment logs, webhook logs").
//
// Read-only visibility into the payment pipeline (PaymentOrder +
// PaymentWebhookLog) so an operator can debug a stuck recharge: did
// the order reach the gateway? did the webhook arrive? did the
// signature verify? was it a duplicate?
//
// The filter parsers are pure + validate enum membership so a junk
// query string can't reach Prisma as an invalid enum (which would
// 500 instead of a clean 400).
// ============================================================================

import {
  prismaRead,
  type PaymentGateway,
  type PaymentOrderStatus,
  type PaymentWebhookSignatureStatus,
} from "@nexaflow/db";

const GATEWAYS: readonly PaymentGateway[] = ["RAZORPAY", "STRIPE"];
const ORDER_STATUSES: readonly PaymentOrderStatus[] = [
  "CREATED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];
const SIGNATURE_STATUSES: readonly PaymentWebhookSignatureStatus[] = [
  "VALID",
  "INVALID",
  "MISSING",
];

export interface PaymentOrderFilters {
  status?: PaymentOrderStatus;
  gateway?: PaymentGateway;
  tenantId?: string;
  limit: number;
}

export interface PaymentWebhookFilters {
  gateway?: PaymentGateway;
  signatureStatus?: PaymentWebhookSignatureStatus;
  paymentOrderId?: string;
  limit: number;
}

export interface InvoiceFilters {
  status?: "draft" | "sent" | "paid" | "failed";
  tenantId?: string;
  limit: number;
}

function clampLimit(raw: unknown, fallback = 50, max = 200): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

function pickEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  return (allowed as readonly string[]).includes(upper)
    ? (upper as T)
    : undefined;
}

/**
 * Pure — parses + validates the order-list query. Unknown enum values
 * are dropped (treated as "no filter") rather than throwing, so a
 * stale bookmark with a renamed status still returns results instead
 * of erroring.
 */
export function parsePaymentOrderFilters(query: {
  status?: unknown;
  gateway?: unknown;
  tenantId?: unknown;
  limit?: unknown;
}): PaymentOrderFilters {
  return {
    status: pickEnum(query.status, ORDER_STATUSES),
    gateway: pickEnum(query.gateway, GATEWAYS),
    tenantId:
      typeof query.tenantId === "string" && query.tenantId.trim().length > 0
        ? query.tenantId.trim()
        : undefined,
    limit: clampLimit(query.limit),
  };
}

export function parsePaymentWebhookFilters(query: {
  gateway?: unknown;
  signatureStatus?: unknown;
  paymentOrderId?: unknown;
  limit?: unknown;
}): PaymentWebhookFilters {
  return {
    gateway: pickEnum(query.gateway, GATEWAYS),
    signatureStatus: pickEnum(query.signatureStatus, SIGNATURE_STATUSES),
    paymentOrderId:
      typeof query.paymentOrderId === "string" &&
      query.paymentOrderId.trim().length > 0
        ? query.paymentOrderId.trim()
        : undefined,
    limit: clampLimit(query.limit),
  };
}

export function parseInvoiceFilters(query: {
  status?: unknown;
  tenantId?: unknown;
  limit?: unknown;
}): InvoiceFilters {
  const status =
    typeof query.status === "string"
      ? query.status.trim().toLowerCase()
      : "";
  return {
    status: ["draft", "sent", "paid", "failed"].includes(status)
      ? (status as InvoiceFilters["status"])
      : undefined,
    tenantId:
      typeof query.tenantId === "string" && query.tenantId.trim().length > 0
        ? query.tenantId.trim()
        : undefined,
    limit: clampLimit(query.limit, 100, 500),
  };
}

export async function listPaymentOrders(filters: PaymentOrderFilters) {
  return prismaRead.paymentOrder.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.gateway ? { gateway: filters.gateway } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      gateway: true,
      amount: true,
      currency: true,
      status: true,
      gatewayOrderId: true,
      ledgerTransactionId: true,
      failureReason: true,
      createdAt: true,
      paidAt: true,
      tenant: { select: { name: true } },
      _count: { select: { webhookLogs: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
}

export async function listPaymentWebhookLogs(filters: PaymentWebhookFilters) {
  return prismaRead.paymentWebhookLog.findMany({
    where: {
      ...(filters.gateway ? { gateway: filters.gateway } : {}),
      ...(filters.signatureStatus
        ? { signatureStatus: filters.signatureStatus }
        : {}),
      ...(filters.paymentOrderId
        ? { paymentOrderId: filters.paymentOrderId }
        : {}),
    },
    select: {
      id: true,
      gateway: true,
      eventId: true,
      eventType: true,
      signatureStatus: true,
      paymentOrderId: true,
      duplicate: true,
      processingError: true,
      processedAt: true,
      // rawPayload deliberately excluded from the list — it can be
      // multi-KB; a detail endpoint can fetch it when an operator
      // actually needs to inspect one event.
    },
    orderBy: { processedAt: "desc" },
    take: filters.limit,
  });
}

export async function listInvoices(filters: InvoiceFilters) {
  return prismaRead.invoice.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      invoiceNumber: true,
      amountInPaisa: true,
      subtotalInPaisa: true,
      taxInPaisa: true,
      currency: true,
      status: true,
      paymentOrderId: true,
      rechargeRequestId: true,
      razorpayInvoiceId: true,
      stripeInvoiceId: true,
      pdfUrl: true,
      dueAt: true,
      paidAt: true,
      createdAt: true,
      tenant: {
        select: {
          name: true,
          type: true,
          status: true,
        },
      },
      currencySnapshot: {
        select: {
          displayCurrency: true,
          displayAmountMinor: true,
          exchangeRateMicros: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
}
