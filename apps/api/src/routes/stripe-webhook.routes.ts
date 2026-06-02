// ============================================================================
// POST /api/v1/webhooks/stripe (Claude FINAL §4, slice 13)
//
// Mirror of routes/razorpay-webhook.routes.ts. HMAC is the auth
// surface (no Bearer token). Always responds 200 so Stripe stops
// retrying — outcomes are recorded on PaymentWebhookLog.
// ============================================================================

import { Router, Request, Response } from "express";
import { verifyStripeWebhookSignature } from "../lib/stripe";
import {
  handleStripeEvent,
  type StripeEvent,
} from "../services/stripeWebhook.service";
import { prisma } from "@nexaflow/db";

const router = Router();

type RawBodyRequest = Request & { rawBody?: Buffer };

router.post("/", async (req: Request, res: Response) => {
  const raw = (req as RawBodyRequest).rawBody;
  const rawBody = raw ? raw.toString("utf-8") : JSON.stringify(req.body ?? {});

  const signatureHeader = (req.headers["stripe-signature"] ?? "") as string;
  const signatureValid = verifyStripeWebhookSignature({
    rawBody,
    signatureHeader,
  });

  let payload: StripeEvent;
  try {
    payload = JSON.parse(rawBody) as StripeEvent;
  } catch {
    await prisma.paymentWebhookLog.create({
      data: {
        gateway: "STRIPE",
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
    const result = await handleStripeEvent({
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
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.paymentWebhookLog.create({
        data: {
          gateway: "STRIPE",
          eventId: `processing_failure_${Date.now()}`,
          eventType: payload.type ?? "unknown",
          signatureStatus: signatureValid ? "VALID" : "INVALID",
          rawPayload: rawBody.slice(0, 4000),
          processingError: message.slice(0, 1000),
        },
      });
    } catch {
      // Even the log write failed — nothing else to do.
    }
    res
      .status(200)
      .json({ success: true, data: { outcome: "processing_failure" } });
  }
});

export default router;
