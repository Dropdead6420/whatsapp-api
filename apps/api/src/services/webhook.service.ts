import crypto from "node:crypto";
import { Worker, UnrecoverableError } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getQueueConnection,
  getWebhookQueue,
  makeBullJobId,
  QueueNames,
  trackWorker,
  type WebhookJobData,
} from "../lib/queue";

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
  | "APPOINTMENT_BOOKED"
  | "TOKEN_EXPIRING";

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
      // Failed first attempt — persist the audit row and hand the rest to
      // BullMQ. The retry queue uses native attempts + custom backoff,
      // replacing the old nextRetryAt polling.
      const log = await prisma.webhookLog.create({
        data: {
          webhookId: sub.id,
          event,
          payload: body,
          statusCode: attempt.statusCode ?? null,
          response: attempt.responseBody ?? null,
          error: attempt.error ?? null,
          attempt: 1,
          nextRetryAt: null,
        },
      });
      void enqueueWebhookRetry(log.id, sub.retryAttempts ?? 4);
    }
  } catch (err) {
    console.error("[webhook:emit]", err);
  }
}

// Existing schedule: 1m, 5m, 30m, 2h. Index by BullMQ's `attemptsMade`,
// which is 1 on the first retry, 2 on the second, ...
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

const WEBHOOK_BACKOFF = "webhookExponential";

async function enqueueWebhookRetry(
  webhookLogId: string,
  maxAttempts: number,
): Promise<void> {
  const q = getWebhookQueue();
  // attempts counts initial + retries in BullMQ. We've already done the
  // first attempt synchronously; queue the remaining maxAttempts - 1.
  const remaining = Math.max(1, maxAttempts - 1);
  await q.add(
    "deliver",
    { webhookLogId },
    {
      jobId: makeBullJobId("deliver", webhookLogId),
      attempts: remaining,
      backoff: { type: WEBHOOK_BACKOFF, delay: 0 },
    },
  );
}

async function processWebhookDelivery(
  job: { data: WebhookJobData; attemptsMade: number },
): Promise<void> {
  const { webhookLogId } = job.data;
  const log = await prisma.webhookLog.findUnique({
    where: { id: webhookLogId },
  });
  if (!log) {
    throw new UnrecoverableError("WebhookLog row missing");
  }
  const webhook = await prisma.webhook.findUnique({
    where: { id: log.webhookId },
  });
  if (!webhook || !webhook.isActive) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { error: "subscription inactive" },
    });
    // Don't retry — subscription is gone or paused.
    throw new UnrecoverableError("webhook subscription inactive");
  }

  const attempt = await deliver(webhook.url, webhook.secret, log.payload);
  // attemptsMade is 0 on the first retry. The audit log's `attempt` reflects
  // the human-readable count (initial=1, +N retries).
  const auditAttempt = (log.attempt ?? 1) + 1;

  if (attempt.ok) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        statusCode: attempt.statusCode,
        response: attempt.responseBody,
        error: null,
        attempt: auditAttempt,
      },
    });
    return;
  }

  await prisma.webhookLog.update({
    where: { id: log.id },
    data: {
      statusCode: attempt.statusCode ?? null,
      response: attempt.responseBody ?? null,
      error: attempt.error ?? null,
      attempt: auditAttempt,
    },
  });
  throw new Error(`webhook delivery failed: ${attempt.error ?? "unknown"}`);
}

let webhookWorker: Worker<WebhookJobData> | null = null;

export async function startWebhookWorker(): Promise<void> {
  if (webhookWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[webhook-worker] database unavailable; worker not started.");
    return;
  }

  webhookWorker = new Worker<WebhookJobData>(
    QueueNames.WEBHOOK_DELIVERY,
    processWebhookDelivery,
    {
      connection: getQueueConnection(),
      concurrency: 4,
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          // attemptsMade is 1-based after the first failure. Clamp to the
          // last element so very late retries don't crash on out-of-range.
          const idx = Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1);
          return RETRY_DELAYS_MS[Math.max(0, idx)];
        },
      },
    },
  );

  webhookWorker.on("failed", (job, err) => {
    // Per-attempt errors are already persisted to WebhookLog. Just log the
    // final-failure case so operators can correlate.
    if (job?.attemptsMade && job.opts.attempts && job.attemptsMade >= job.opts.attempts) {
      console.warn(
        `[webhook-worker] gave up on ${job.id} after ${job.attemptsMade} attempts: ${err?.message}`,
      );
    }
  });
  webhookWorker.on("error", (err) => {
    console.error("[webhook-worker] worker error:", err.message);
  });

  trackWorker(webhookWorker);
}

export function stopWebhookWorker(): void {
  if (webhookWorker) {
    void webhookWorker.close();
    webhookWorker = null;
  }
}
