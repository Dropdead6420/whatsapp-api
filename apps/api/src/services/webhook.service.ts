import crypto from "node:crypto";
import { prisma } from "@nexaflow/db";

/**
 * Outbound webhook system (V2 §3.3.6 "webhook builder").
 *
 * - Tenants subscribe a URL to one or more events (MESSAGE_RECEIVED, LEAD_CREATED, etc.)
 * - When an event fires we POST a signed JSON payload.
 * - Failed deliveries are persisted to WebhookLog and retried by the worker.
 *
 * Signature: `X-NexaFlow-Signature: sha256={hex hmac of body with webhook.secret}`
 */

type WebhookEvent =
  | "MESSAGE_SENT"
  | "MESSAGE_RECEIVED"
  | "LEAD_CREATED"
  | "CONTACT_TAGGED"
  | "CAMPAIGN_COMPLETED"
  | "CONVERSATION_ASSIGNED"
  | "APPOINTMENT_BOOKED";

interface DeliveryAttempt {
  ok: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
}

function sign(secret: string, body: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")
  );
}

async function deliver(
  url: string,
  secret: string,
  body: string,
  timeoutMs = 8000,
): Promise<DeliveryAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NexaFlow-Signature": sign(secret, body),
        "User-Agent": "NexaFlow-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      statusCode: res.status,
      responseBody: text.slice(0, 2000),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      responseBody: null,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire-and-forget: enqueue a webhook event. For each active subscription that
 * matches the event, attempt delivery. Failures are persisted to WebhookLog
 * with a `nextRetryAt`; the worker handles retries.
 */
export async function emitWebhookEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const subs = await prisma.webhook.findMany({
      where: { tenantId, isActive: true, events: { has: event } },
    });
    if (subs.length === 0) return;

    const bodyEnvelope = {
      event,
      tenantId,
      occurredAt: new Date().toISOString(),
      data: payload,
    };
    const body = JSON.stringify(bodyEnvelope);

    for (const sub of subs) {
      const attempt = await deliver(sub.url, sub.secret, body);
      if (attempt.ok) continue;
      // Persist for retry. Use exponential backoff: 1m, 5m, 30m, 2h.
      await prisma.webhookLog.create({
        data: {
          webhookId: sub.id,
          event,
          payload: body,
          statusCode: attempt.statusCode ?? null,
          response: attempt.responseBody ?? null,
          error: attempt.error ?? null,
          attempt: 1,
          nextRetryAt: new Date(Date.now() + 60_000),
        },
      });
    }
  } catch (err) {
    console.error("[webhook:emit]", err);
  }
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

let workerHandle: ReturnType<typeof setInterval> | null = null;

async function retryDueLogs(): Promise<void> {
  const due = await prisma.webhookLog.findMany({
    where: { nextRetryAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const log of due) {
    const webhook = await prisma.webhook.findUnique({
      where: { id: log.webhookId },
    });
    if (!webhook || !webhook.isActive) {
      // Subscription gone or paused — stop retrying.
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: { nextRetryAt: null, error: log.error ?? "subscription inactive" },
      });
      continue;
    }
    const attempt = await deliver(webhook.url, webhook.secret, log.payload);
    if (attempt.ok) {
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          statusCode: attempt.statusCode,
          response: attempt.responseBody,
          error: null,
          nextRetryAt: null,
          attempt: log.attempt + 1,
        },
      });
      continue;
    }
    const nextAttempt = log.attempt + 1;
    const maxAttempts = webhook.retryAttempts ?? 4;
    const giveUp = nextAttempt >= maxAttempts;
    const backoff = BACKOFF_MS[Math.min(nextAttempt - 1, BACKOFF_MS.length - 1)];
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        statusCode: attempt.statusCode ?? null,
        response: attempt.responseBody ?? null,
        error: attempt.error ?? null,
        attempt: nextAttempt,
        nextRetryAt: giveUp ? null : new Date(Date.now() + backoff),
      },
    });
  }
}

export async function startWebhookWorker(intervalMs = 60_000): Promise<void> {
  if (workerHandle) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[webhook-worker] database unavailable; worker not started.");
    return;
  }
  setTimeout(() => void retryDueLogs(), 15_000);
  workerHandle = setInterval(() => void retryDueLogs(), intervalMs);
}

export function stopWebhookWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}
