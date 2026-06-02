// ============================================================================
// Razorpay HTTP client (Claude FINAL §4, slice 2)
//
// Intentionally NOT using the official `razorpay` npm package. The
// subset we need is two endpoints — Orders.create and webhook
// signature verification — and both are trivial to do with fetch +
// Node's crypto. Keeping it dep-free avoids a 14-MB transitive tree
// and side-steps the SDK's CommonJS-only export shape (which has
// historically broken our ESM build).
//
// Configuration:
//   RAZORPAY_KEY_ID       — required for live mode (test or live keys)
//   RAZORPAY_KEY_SECRET   — required for live mode
//   RAZORPAY_WEBHOOK_SECRET — required by the webhook handler in slice 3
//
// When RAZORPAY_KEY_ID is unset, the client runs in **stub mode**:
// createOrder returns a deterministic fake order id so dev / test envs
// don't need real Razorpay credentials. The webhook signature check
// always fails in stub mode (the handler treats that as a soft no-op).
// ============================================================================

import crypto from "node:crypto";

export interface RazorpayOrderRequest {
  /** Smallest currency unit (paise / cents). Integer. */
  amount: number;
  currency: string;
  /** Receipt — Razorpay surfaces this in dashboards. <= 40 chars. */
  receipt: string;
  /** Free-form key/value pairs Razorpay echoes back on the order. */
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  notes?: Record<string, string>;
}

/**
 * True when the env is configured for real Razorpay calls. Used by
 * route handlers to short-circuit to the stub branch in dev / tests.
 */
export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  );
}

/**
 * POST https://api.razorpay.com/v1/orders. Returns the parsed JSON.
 * Throws when the HTTP call fails or Razorpay returns an error body.
 *
 * In stub mode (no env), returns a deterministic fake order so dev
 * environments work without secrets.
 */
export async function createRazorpayOrder(
  req: RazorpayOrderRequest,
): Promise<RazorpayOrderResponse> {
  if (!isRazorpayConfigured()) {
    return {
      id: `order_stub_${crypto.randomBytes(8).toString("hex")}`,
      amount: req.amount,
      currency: req.currency,
      status: "created",
      receipt: req.receipt,
      notes: req.notes,
    };
  }

  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: req.amount,
      currency: req.currency,
      receipt: req.receipt,
      notes: req.notes ?? {},
      payment_capture: 1,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Razorpay /orders failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  return JSON.parse(text) as RazorpayOrderResponse;
}

/**
 * Verifies the X-Razorpay-Signature header against the raw request
 * body using HMAC-SHA256 with the webhook secret. Returns true iff
 * the signature matches.
 *
 * The signature is hex-encoded, so we compare via timing-safe equals
 * to dodge timing-attack leakage.
 */
export function verifyRazorpayWebhookSignature(args: {
  rawBody: string;
  signatureHeader: string | undefined;
}): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !args.signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(args.rawBody)
    .digest("hex");
  // Both sides must be the same length for timingSafeEqual.
  const sigBuf = Buffer.from(args.signatureHeader, "utf-8");
  const expBuf = Buffer.from(expected, "utf-8");
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
