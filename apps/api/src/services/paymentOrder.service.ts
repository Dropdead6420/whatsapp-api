// ============================================================================
// PaymentOrder service (Claude FINAL §4, slice 1)
//
// Pure helpers for the customer self-recharge flow. The DB layer
// (createPaymentOrder + applyWebhookEvent) lands in subsequent slices
// alongside the actual Razorpay/Stripe wiring; this slice just
// stabilizes the contracts:
//
//   - canTransitionStatus(from, to)  — state-machine rules
//   - sanitizeRechargeAmount(...)    — bounds check on smallest-unit amount
//   - sanitizeIdempotencyKey(...)    — key shape + length validation
//
// Lifecycle:
//   CREATED → PENDING → SUCCEEDED       (happy path)
//   CREATED → PENDING → FAILED          (signature mismatch / gateway no)
//   CREATED → PENDING → EXPIRED         (reconciliation sweep)
//   CREATED → CANCELLED                 (operator-cancel before checkout)
//   SUCCEEDED / FAILED / EXPIRED / CANCELLED are terminal.
//
// Why a state machine rather than free-form updates:
//   - SUCCEEDED → FAILED would unbook a real credit on the customer's
//     wallet (Razorpay can't claw back), so we hard-stop terminal
//     transitions.
//   - PENDING → CREATED would let a re-checkout reset the order; the
//     correct path is "create a new order with a fresh idempotency
//     key".
// ============================================================================

import { prisma, type PaymentOrder, type PaymentOrderStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
} from "../lib/razorpay";
import {
  createStripePaymentIntent,
  isStripeConfigured,
} from "../lib/stripe";

/** Bounds for amount sanitization. Currency-agnostic — caller is
 *  responsible for unit conversion (paise vs cents) before invoking. */
const MIN_AMOUNT_UNITS = 100; // ₹1 / $1 smallest unit floor
const MAX_AMOUNT_UNITS = 10_000_000; // ₹1,00,000 / $1,00,000 ceiling

const TERMINAL_STATUSES: readonly PaymentOrderStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
];

/**
 * Allowed forward transitions. Anything not in this map is rejected
 * by `canTransitionStatus`. Self-transitions (X → X) are forbidden so
 * duplicate webhooks can be detected at the route layer rather than
 * silently no-op'd.
 */
const ALLOWED_TRANSITIONS: Record<
  PaymentOrderStatus,
  ReadonlyArray<PaymentOrderStatus>
> = {
  CREATED: ["PENDING", "FAILED", "CANCELLED", "EXPIRED"],
  PENDING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/**
 * Returns true when the requested transition is legal. Pure — no DB.
 */
export function canTransitionStatus(
  from: PaymentOrderStatus,
  to: PaymentOrderStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Throws ApiError(BAD_REQUEST) when the transition isn't allowed.
 * Used by the webhook handler to refuse SUCCEEDED → anything (would
 * undo a real customer credit) and to keep self-loops out of audit.
 */
export function assertCanTransitionStatus(
  from: PaymentOrderStatus,
  to: PaymentOrderStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot transition PaymentOrder ${from} → ${to}.`,
    );
  }
}

/** True iff status is one of the four terminal states. */
export function isTerminalStatus(status: PaymentOrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Sanitizes a recharge amount. The caller is expected to have already
 * converted to the smallest currency unit (paise for INR, cents for
 * USD). Returns the validated integer or throws.
 */
export function sanitizeRechargeAmount(
  raw: unknown,
): number {
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Amount must be a number.");
  }
  if (!Number.isInteger(num)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Amount must be an integer (smallest currency unit — paise / cents).",
    );
  }
  if (num < MIN_AMOUNT_UNITS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Amount must be at least ${MIN_AMOUNT_UNITS} (smallest unit).`,
    );
  }
  if (num > MAX_AMOUNT_UNITS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Amount cannot exceed ${MAX_AMOUNT_UNITS} (smallest unit).`,
    );
  }
  return num;
}

/**
 * Validates the client-supplied idempotency key. Required (no
 * server-generated fallback) so a network retry on the client always
 * lands on the same row.
 */
export function sanitizeIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key is required.",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length < 8) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key must be at least 8 characters.",
    );
  }
  if (trimmed.length > 80) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key must be 80 characters or fewer.",
    );
  }
  // Keep the surface narrow — letters, digits, dash, underscore. No
  // path-style characters; the key flows into DB indexes + audit logs.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Idempotency key may only contain letters, digits, '-' and '_'.",
    );
  }
  return trimmed;
}

// ----------------------------------------------------------------------------
// DB layer
// ----------------------------------------------------------------------------

export interface RazorpayInitPayload {
  /** Razorpay's order id — what Checkout.js needs. */
  gatewayOrderId: string;
  /** Public key id Checkout.js needs. Null when running in stub mode. */
  keyId: string | null;
  /** Smallest currency unit. */
  amount: number;
  currency: string;
  /** True when no Razorpay credentials are configured (dev/test). */
  stubMode: boolean;
}

export interface InitiateRazorpayRechargeResult {
  paymentOrder: PaymentOrder;
  init: RazorpayInitPayload;
  /** True when an existing CREATED order was returned (idempotent replay). */
  replayed: boolean;
}

/**
 * Customer self-recharge entry point. Idempotent on
 * (tenantId, idempotencyKey): a second POST with the same key returns
 * the existing PENDING row unchanged. A second POST with the same key
 * after the order is terminal is an error — the operator should mint
 * a fresh key for a new attempt.
 */
export async function initiateRazorpayRecharge(args: {
  tenantId: string;
  amount: number;
  currency?: string;
  idempotencyKey: string;
  createdByUserId?: string;
}): Promise<InitiateRazorpayRechargeResult> {
  const amount = sanitizeRechargeAmount(args.amount);
  const idempotencyKey = sanitizeIdempotencyKey(args.idempotencyKey);
  const currency = (args.currency ?? "INR").toUpperCase();

  // The customer's wallet is the credit destination. Auto-created on
  // tenant signup, so we expect it to exist; surface a clear 404 when
  // it doesn't.
  const wallet = await prisma.wallet.findUnique({
    where: { tenantId: args.tenantId },
    select: { id: true, status: true },
  });
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Wallet not initialized for this tenant.",
    );
  }
  if (wallet.status !== "ACTIVE") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot recharge a ${wallet.status} wallet.`,
    );
  }

  // Idempotent path: same key returns the same row.
  const existing = await prisma.paymentOrder.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: args.tenantId,
        idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.status !== "CREATED" && existing.status !== "PENDING") {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        `An order with this idempotency key already finished (${existing.status}). Use a fresh key for a new recharge.`,
      );
    }
    if (existing.amount !== amount) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "Idempotency key reused with a different amount. Use a fresh key.",
      );
    }
    return {
      paymentOrder: existing,
      init: {
        gatewayOrderId: existing.gatewayOrderId ?? "",
        keyId: process.env.RAZORPAY_KEY_ID ?? null,
        amount: existing.amount,
        currency: existing.currency,
        stubMode: !isRazorpayConfigured(),
      },
      replayed: true,
    };
  }

  // Hit Razorpay first to fail fast if the gateway rejects; we don't
  // want to leave half-built PaymentOrder rows when the gateway is
  // down.
  const gatewayOrder = await createRazorpayOrder({
    amount,
    currency,
    receipt: idempotencyKey.slice(0, 40),
    notes: { tenantId: args.tenantId },
  });

  const paymentOrder = await prisma.paymentOrder.create({
    data: {
      tenantId: args.tenantId,
      walletId: wallet.id,
      gateway: "RAZORPAY",
      amount,
      currency,
      // Razorpay accepted the order; from here we are waiting for the
      // customer checkout + payment webhook.
      status: "PENDING",
      gatewayOrderId: gatewayOrder.id,
      idempotencyKey,
      createdByUserId: args.createdByUserId ?? null,
    },
  });

  return {
    paymentOrder,
    init: {
      gatewayOrderId: gatewayOrder.id,
      keyId: process.env.RAZORPAY_KEY_ID ?? null,
      amount,
      currency,
      stubMode: !isRazorpayConfigured(),
    },
    replayed: false,
  };
}

// ---- Stripe sibling --------------------------------------------------------

export interface StripeInitPayload {
  /** Stripe PaymentIntent id. */
  gatewayOrderId: string;
  /** Public publishable key (pk_*) — client uses with Stripe.js. */
  publishableKey: string | null;
  /** client_secret for confirmCardPayment. Null when stub-mode. */
  clientSecret: string | null;
  amount: number;
  currency: string;
  stubMode: boolean;
}

export interface InitiateStripeRechargeResult {
  paymentOrder: PaymentOrder;
  init: StripeInitPayload;
  replayed: boolean;
}

/**
 * Same shape as initiateRazorpayRecharge, but talks to Stripe.
 * Idempotency: (tenantId, idempotencyKey) UNIQUE protects against
 * double-creates on our side; Stripe's Idempotency-Key header
 * protects against the same on theirs.
 */
export async function initiateStripeRecharge(args: {
  tenantId: string;
  amount: number;
  currency?: string;
  idempotencyKey: string;
  createdByUserId?: string;
}): Promise<InitiateStripeRechargeResult> {
  const amount = sanitizeRechargeAmount(args.amount);
  const idempotencyKey = sanitizeIdempotencyKey(args.idempotencyKey);
  const currency = (args.currency ?? "USD").toUpperCase();

  const wallet = await prisma.wallet.findUnique({
    where: { tenantId: args.tenantId },
    select: { id: true, status: true },
  });
  if (!wallet) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Wallet not initialized for this tenant.",
    );
  }
  if (wallet.status !== "ACTIVE") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot recharge a ${wallet.status} wallet.`,
    );
  }

  const existing = await prisma.paymentOrder.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: args.tenantId,
        idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.status !== "CREATED" && existing.status !== "PENDING") {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        `An order with this idempotency key already finished (${existing.status}). Use a fresh key for a new recharge.`,
      );
    }
    if (existing.amount !== amount) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "Idempotency key reused with a different amount. Use a fresh key.",
      );
    }
    if (existing.gateway !== "STRIPE") {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "Idempotency key already used for a different gateway.",
      );
    }
    return {
      paymentOrder: existing,
      init: {
        gatewayOrderId: existing.gatewayOrderId ?? "",
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
        // We don't persist client_secret — the customer has to retry
        // create to get a fresh one (which they shouldn't need to,
        // since Stripe's PaymentIntents remain usable for 24h).
        clientSecret: null,
        amount: existing.amount,
        currency: existing.currency,
        stubMode: !isStripeConfigured(),
      },
      replayed: true,
    };
  }

  const intent = await createStripePaymentIntent({
    amount,
    currency,
    idempotencyKey,
    metadata: { tenantId: args.tenantId, idempotencyKey },
  });

  const paymentOrder = await prisma.paymentOrder.create({
    data: {
      tenantId: args.tenantId,
      walletId: wallet.id,
      gateway: "STRIPE",
      amount,
      currency,
      // Stripe accepts → we wait for the customer to confirm + the
      // webhook to land.
      status: "PENDING",
      gatewayOrderId: intent.id,
      idempotencyKey,
      createdByUserId: args.createdByUserId ?? null,
    },
  });

  return {
    paymentOrder,
    init: {
      gatewayOrderId: intent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
      clientSecret: intent.client_secret ?? null,
      amount,
      currency,
      stubMode: !isStripeConfigured(),
    },
    replayed: false,
  };
}
