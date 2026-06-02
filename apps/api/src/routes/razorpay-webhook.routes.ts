// ============================================================================
// POST /api/v1/webhooks/razorpay (Claude FINAL §4, slice 3)
//
// Public — no Bearer token. The HMAC signature in
// X-Razorpay-Signature is the authentication surface, verified
// against the raw request body (captured by express.json's verify
// hook in index.ts).
//
// Always responds 200 so Razorpay stops retrying. Real outcomes are
// recorded on PaymentWebhookLog; the response body just exposes the
// outcome so operators can curl-test.
// ============================================================================

import { Router, Request, Response } from "express";
import { verifyRazorpayWebhookSignature } from "../lib/razorpay";
import {
  handleRazorpayEvent,
  type RazorpayEvent,
} from "../services/razorpayWebhook.service";
import { prisma } from "@nexaflow/db";

const router = Router();

/**
 * Raw body is required for HMAC. express.json's `verify` hook in
 * index.ts already stashes it on req.rawBody (used by the WhatsApp
 * webhook too).
 */
type RawBodyRequest = Request & { rawBody?: Buffer };

router.post("/", async (req: Request, res: Response) => {
  const raw = (req as RawBodyRequest).rawBody;
  const rawBody = raw ? raw.toString("utf-8") : JSON.stringify(req.body ?? {});

  const signatureHeader = (req.headers["x-razorpay-signature"] ?? "") as string;
  const signatureValid = verifyRazorpayWebhookSignature({
    rawBody,
    signatureHeader,
  });

  let payload: RazorpayEvent;
  try {
    payload = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    // Malformed JSON — log and acknowledge so Razorpay stops retrying.
    await prisma.paymentWebhookLog.create({
      data: {
        gateway: "RAZORPAY",
        eventId: `malformed_${Date.now()}`,
        eventType: "malformed",
        signatureStatus: signatureValid ? "VALID" : "INVALID",
        rawPayload: rawBody.slice(0, 4000),
        processingError: "Body is not valid JSON",
      },
    });
    res.status(200).json({ success: true, data: { outcome: "malformed_json" } });
    return;
  }

  try {
    const result = await handleRazorpayEvent({
      rawBody,
      payload,
      signatureStatus: signatureValid
        ? "VALID"
        : signatureHeader
          ? "INVALID"
          : "MISSING",
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    // Last-resort safety net: don't 500 to Razorpay, just record the
    // error on the log row and acknowledge. Operators see the failure
    // in the PaymentWebhookLog dashboard / processingError column.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.paymentWebhookLog.create({
        data: {
          gateway: "RAZORPAY",
          eventId: `processing_failure_${Date.now()}`,
          eventType: payload.event ?? "unknown",
          signatureStatus: signatureValid ? "VALID" : "INVALID",
          rawPayload: rawBody.slice(0, 4000),
          processingError: message.slice(0, 1000),
        },
      });
    } catch {
      // Even the log write failed — there's nothing left to do.
    }
    res
      .status(200)
      .json({ success: true, data: { outcome: "processing_failure" } });
  }
});

export default router;
