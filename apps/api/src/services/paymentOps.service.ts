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
  prisma,
  prismaRead,
  type PaymentGateway,
  type PaymentOrderStatus,
  type PaymentWebhookSignatureStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

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

export interface PaymentGatewaySettingView {
  gateway: string;
  label: string;
  description: string;
  enabled: boolean;
  mode: string;
  credentialHint: string | null;
  instructions: string | null;
  updatedAt?: Date;
}

export interface PaymentNotificationTemplateView {
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  subject: string;
  message: string;
  updatedAt?: Date;
}

export const DEFAULT_PAYMENT_GATEWAYS: PaymentGatewaySettingView[] = [
  {
    gateway: "MANUAL",
    label: "Manual Payment",
    description:
      "Enable offline payment review and define bank transfer or cash instructions customers will see during checkout.",
    enabled: false,
    mode: "manual",
    credentialHint: "No gateway credentials required.",
    instructions:
      "Use this for bank transfer, UPI, cash, cheque, or manually approved partner/customer credit purchases.",
  },
  {
    gateway: "PAYPAL",
    label: "PayPal",
    description:
      "Control PayPal checkout availability and provide the API credentials used for order creation and capture.",
    enabled: false,
    mode: "test",
    credentialHint: "Store PayPal client id and secret in Secret Vault.",
    instructions: "PayPal is not wired to the live recharge pipeline yet.",
  },
  {
    gateway: "STRIPE",
    label: "Stripe",
    description:
      "Configure Stripe Checkout credentials for one-time and recurring billing.",
    enabled: false,
    mode: "test",
    credentialHint:
      "Live Stripe checkout uses STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET or Secret Vault.",
    instructions:
      "Stripe recharge and webhook capture are already implemented in the payment pipeline.",
  },
  {
    gateway: "PAYU",
    label: "PayU",
    description: "Configure PayU credentials for hosted one-time payments.",
    enabled: false,
    mode: "test",
    credentialHint: "Store merchant key and salt in Secret Vault.",
    instructions: "PayU is planned as an additional provider route.",
  },
  {
    gateway: "RAZORPAY",
    label: "Razorpay",
    description:
      "Configure Razorpay credentials for one-time and recurring billing.",
    enabled: false,
    mode: "test",
    credentialHint:
      "Live Razorpay checkout uses RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / webhook secret or Secret Vault.",
    instructions:
      "Razorpay recharge and webhook capture are already implemented in the payment pipeline.",
  },
  {
    gateway: "PAYTM",
    label: "Paytm",
    description: "Configure Paytm credentials for one-time billing.",
    enabled: false,
    mode: "test",
    credentialHint: "Store merchant id and key in Secret Vault.",
    instructions: "Paytm is planned as an additional provider route.",
  },
  {
    gateway: "YOOMONEY",
    label: "YooMoney",
    description: "Configure YooMoney credentials for one-time billing.",
    enabled: false,
    mode: "test",
    credentialHint: "Store shop id and secret in Secret Vault.",
    instructions: "YooMoney is planned as an additional provider route.",
  },
  {
    gateway: "CCAVENUE",
    label: "CCAvenue",
    description: "Configure CCAvenue credentials for one-time billing.",
    enabled: false,
    mode: "test",
    credentialHint: "Store merchant id, access code, and working key in Secret Vault.",
    instructions: "CCAvenue is planned as an additional provider route.",
  },
  {
    gateway: "TWOCHECKOUT",
    label: "2Checkout",
    description: "Configure 2Checkout credentials for one-time billing.",
    enabled: false,
    mode: "test",
    credentialHint: "Store seller id and private key in Secret Vault.",
    instructions: "2Checkout is planned as an additional provider route.",
  },
  {
    gateway: "SSLCOMMERZ",
    label: "SSLCOMMERZ",
    description: "Configure SSLCOMMERZ credentials for one-time checkout.",
    enabled: false,
    mode: "test",
    credentialHint: "Store store id and password in Secret Vault.",
    instructions: "SSLCOMMERZ is planned as an additional provider route.",
  },
  {
    gateway: "PAYSTACK",
    label: "Paystack",
    description: "Configure Paystack credentials for one-time card billing.",
    enabled: false,
    mode: "test",
    credentialHint: "Store Paystack secret key in Secret Vault.",
    instructions: "Paystack is planned as an additional provider route.",
  },
];

export const DEFAULT_PAYMENT_NOTIFICATIONS: PaymentNotificationTemplateView[] = [
  {
    event: "PAYMENT_SUCCESS",
    label: "Payment success",
    description:
      "Configure the outbound payment email sent to the customer for this event.",
    enabled: true,
    subject: "Payment confirmed for :plan",
    message:
      "Your payment of :amount :currency via :gateway was confirmed.\n\nTransaction ID: :transaction_id.\nCurrent plan: :plan.",
  },
  {
    event: "PAYMENT_FAILED",
    label: "Payment failed",
    description:
      "Configure the outbound payment email sent to the customer for this event.",
    enabled: true,
    subject: "Payment failed for :plan",
    message:
      "We could not complete your payment of :amount :currency via :gateway.\n\nStatus: :status.\nMessage: :message.",
  },
  {
    event: "PAYMENT_PENDING",
    label: "Payment pending",
    description:
      "Configure the outbound payment email sent while checkout or webhook confirmation is pending.",
    enabled: true,
    subject: "Payment pending for :plan",
    message:
      "Your :gateway payment is pending confirmation.\n\nTransaction ID: :transaction_id.\nWe will update your wallet or plan once the payment is confirmed.",
  },
  {
    event: "PAYMENT_REFUNDED",
    label: "Payment refunded",
    description:
      "Configure the outbound payment email sent when a refund is recorded.",
    enabled: true,
    subject: "Payment refunded for :plan",
    message:
      "Your refund of :amount :currency for :plan has been recorded.\n\nTransaction ID: :transaction_id.\nStatus: :status.",
  },
];

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

function normalizeSettingKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function defaultGatewayOrThrow(gateway: string): PaymentGatewaySettingView {
  const normalized = normalizeSettingKey(gateway);
  const found = DEFAULT_PAYMENT_GATEWAYS.find((item) => item.gateway === normalized);
  if (!found) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unsupported payment gateway: ${gateway}`,
    );
  }
  return found;
}

function defaultNotificationOrThrow(event: string): PaymentNotificationTemplateView {
  const normalized = normalizeSettingKey(event);
  const found = DEFAULT_PAYMENT_NOTIFICATIONS.find((item) => item.event === normalized);
  if (!found) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unsupported payment notification event: ${event}`,
    );
  }
  return found;
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

export function mergeGatewaySettings(
  stored: PaymentGatewaySettingView[],
): PaymentGatewaySettingView[] {
  const byKey = new Map(stored.map((item) => [item.gateway, item]));
  return DEFAULT_PAYMENT_GATEWAYS.map((defaults) => ({
    ...defaults,
    ...byKey.get(defaults.gateway),
  }));
}

export function mergeNotificationTemplates(
  stored: PaymentNotificationTemplateView[],
): PaymentNotificationTemplateView[] {
  const byKey = new Map(stored.map((item) => [item.event, item]));
  return DEFAULT_PAYMENT_NOTIFICATIONS.map((defaults) => ({
    ...defaults,
    ...byKey.get(defaults.event),
  }));
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

export async function listPaymentGatewaySettings() {
  const rows = await prismaRead.paymentGatewaySetting.findMany({
    select: {
      gateway: true,
      label: true,
      description: true,
      enabled: true,
      mode: true,
      credentialHint: true,
      instructions: true,
      updatedAt: true,
    },
  });
  return mergeGatewaySettings(rows);
}

export async function updatePaymentGatewaySetting(
  gateway: string,
  patch: Partial<PaymentGatewaySettingView>,
  updatedByUserId?: string,
) {
  const defaults = defaultGatewayOrThrow(gateway);
  const saved = await prisma.paymentGatewaySetting.upsert({
    where: { gateway: defaults.gateway },
    create: {
      gateway: defaults.gateway,
      label: patch.label?.trim() || defaults.label,
      description: patch.description?.trim() || defaults.description,
      enabled: patch.enabled ?? defaults.enabled,
      mode: patch.mode?.trim() || defaults.mode,
      credentialHint: patch.credentialHint?.trim() || defaults.credentialHint,
      instructions: patch.instructions?.trim() || defaults.instructions,
      updatedByUserId: updatedByUserId ?? null,
    },
    update: {
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description.trim() }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode.trim() } : {}),
      ...(patch.credentialHint !== undefined
        ? { credentialHint: patch.credentialHint?.trim() || null }
        : {}),
      ...(patch.instructions !== undefined
        ? { instructions: patch.instructions?.trim() || null }
        : {}),
      updatedByUserId: updatedByUserId ?? null,
    },
  });
  return mergeGatewaySettings([saved]).find((item) => item.gateway === defaults.gateway)!;
}

export async function listPaymentNotificationTemplates() {
  const rows = await prismaRead.paymentNotificationTemplate.findMany({
    select: {
      event: true,
      label: true,
      description: true,
      enabled: true,
      subject: true,
      message: true,
      updatedAt: true,
    },
  });
  return mergeNotificationTemplates(rows);
}

export async function updatePaymentNotificationTemplate(
  event: string,
  patch: Partial<PaymentNotificationTemplateView>,
  updatedByUserId?: string,
) {
  const defaults = defaultNotificationOrThrow(event);
  const saved = await prisma.paymentNotificationTemplate.upsert({
    where: { event: defaults.event },
    create: {
      event: defaults.event,
      label: patch.label?.trim() || defaults.label,
      description: patch.description?.trim() || defaults.description,
      enabled: patch.enabled ?? defaults.enabled,
      subject: patch.subject?.trim() || defaults.subject,
      message: patch.message?.trim() || defaults.message,
      updatedByUserId: updatedByUserId ?? null,
    },
    update: {
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description.trim() }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}),
      ...(patch.message !== undefined ? { message: patch.message.trim() } : {}),
      updatedByUserId: updatedByUserId ?? null,
    },
  });
  return mergeNotificationTemplates([saved]).find(
    (item) => item.event === defaults.event,
  )!;
}
