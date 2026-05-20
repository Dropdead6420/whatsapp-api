import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getQueueConnection,
  getWabaTokenExpiryQueue,
  QueueNames,
  trackWorker,
  type WabaTokenExpiryJobData,
} from "../lib/queue";
import { emitWebhookEvent } from "./webhook.service";

// WABA token-expiry warn worker (T-004 follow-up).
//
// Meta's `oauth/access_token` exchange in Embedded Signup can return
// either a 60-day token (default) or a never-expires token (when the
// System User is upgraded). For the 60-day case, the WABA goes silent
// when the token expires — incoming messages stop arriving and the
// next outbound returns OAuthException. Auto-refresh isn't supported
// by Meta for these tokens; the only recovery is to re-run Embedded
// Signup and capture a fresh one.
//
// This worker scans daily for tenants whose `wabaTokenExpiresAt` is
// within `WABA_TOKEN_EXPIRY_WARN_DAYS` (default 14). For each match
// not yet warned in the last 24h, we:
//   1. Stamp `wabaLastSyncError` with a human-readable expiry message
//      so /whatsapp-settings surfaces it on next load.
//   2. Emit a `TOKEN_EXPIRING` outbound webhook so the tenant's own
//      integrations can route the warning into Slack / PagerDuty.
//   3. Stamp `wabaTokenExpiryWarnedAt` so we don't re-warn every tick.

const WARN_DAYS = Number(process.env.WABA_TOKEN_EXPIRY_WARN_DAYS ?? "14");
const WARN_COOLDOWN_HOURS = Number(
  process.env.WABA_TOKEN_EXPIRY_WARN_COOLDOWN_HOURS ?? "24",
);
const SCAN_INTERVAL_MS = Number(
  process.env.WABA_TOKEN_EXPIRY_SCAN_INTERVAL_MS ?? `${6 * 60 * 60 * 1000}`,
); // every 6h by default
const SCAN_JOB_NAME = "scan";

interface ScanResult {
  warned: number;
  expired: number;
}

export async function scanWabaTokenExpiry(now = new Date()): Promise<ScanResult> {
  const warnHorizon = new Date(now.getTime() + WARN_DAYS * 24 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(
    now.getTime() - WARN_COOLDOWN_HOURS * 60 * 60 * 1000,
  );

  // Find tenants with a real expiry stamped, that lands in
  // (now, now + WARN_DAYS], and that we haven't warned recently.
  const due = await prisma.tenant.findMany({
    where: {
      wabaTokenExpiresAt: { gt: now, lte: warnHorizon },
      OR: [
        { wabaTokenExpiryWarnedAt: null },
        { wabaTokenExpiryWarnedAt: { lt: cooldownCutoff } },
      ],
    },
    select: {
      id: true,
      wabaTokenExpiresAt: true,
      wabaPhoneNumber: true,
    },
    take: 200,
  });

  // Tenants already past expiry — these are broken right now, not
  // about to be. Same warn flow but with a hard-fail message.
  const expired = await prisma.tenant.findMany({
    where: {
      wabaTokenExpiresAt: { lte: now, not: null },
      OR: [
        { wabaTokenExpiryWarnedAt: null },
        { wabaTokenExpiryWarnedAt: { lt: cooldownCutoff } },
      ],
    },
    select: {
      id: true,
      wabaTokenExpiresAt: true,
      wabaPhoneNumber: true,
    },
    take: 200,
  });

  let warned = 0;
  for (const t of due) {
    const expiresAt = t.wabaTokenExpiresAt!;
    const days = Math.max(
      0,
      Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    );
    await prisma.tenant.update({
      where: { id: t.id },
      data: {
        wabaLastSyncError: `WhatsApp access token expires in ${days} day(s) (${expiresAt.toISOString()}). Re-run Connect with Meta to refresh.`,
        wabaTokenExpiryWarnedAt: now,
      },
    });
    void emitWebhookEvent(t.id, "TOKEN_EXPIRING", {
      tenantId: t.id,
      phoneNumberId: t.wabaPhoneNumber,
      tokenExpiresAt: expiresAt.toISOString(),
      daysUntilExpiry: days,
      severity: days <= 3 ? "critical" : "warning",
    });
    warned += 1;
  }

  let expiredCount = 0;
  for (const t of expired) {
    const expiresAt = t.wabaTokenExpiresAt!;
    await prisma.tenant.update({
      where: { id: t.id },
      data: {
        wabaLastSyncError: `WhatsApp access token expired at ${expiresAt.toISOString()}. Re-run Connect with Meta.`,
        wabaTokenExpiryWarnedAt: now,
      },
    });
    void emitWebhookEvent(t.id, "TOKEN_EXPIRING", {
      tenantId: t.id,
      phoneNumberId: t.wabaPhoneNumber,
      tokenExpiresAt: expiresAt.toISOString(),
      daysUntilExpiry: 0,
      severity: "expired",
    });
    expiredCount += 1;
  }

  return { warned, expired: expiredCount };
}

let wabaTokenExpiryWorker: Worker<WabaTokenExpiryJobData> | null = null;

export async function startWabaTokenExpiryWorker(): Promise<void> {
  if (wabaTokenExpiryWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[waba-token-expiry] database unavailable; worker not started.",
    );
    return;
  }

  const q = getWabaTokenExpiryQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[waba-token-expiry] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }

  wabaTokenExpiryWorker = new Worker<WabaTokenExpiryJobData>(
    QueueNames.WABA_TOKEN_EXPIRY,
    async () => {
      const result = await scanWabaTokenExpiry();
      if (result.warned || result.expired) {
        console.log(
          `[waba-token-expiry] scan complete — warned=${result.warned} expired=${result.expired}`,
        );
      }
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  wabaTokenExpiryWorker.on("failed", (job, err) => {
    console.error(
      `[waba-token-expiry] job ${job?.id} failed:`,
      err?.message,
    );
  });
  wabaTokenExpiryWorker.on("error", (err) => {
    console.error("[waba-token-expiry] worker error:", err.message);
  });

  trackWorker(wabaTokenExpiryWorker);
}

export function stopWabaTokenExpiryWorker(): void {
  if (wabaTokenExpiryWorker) {
    void wabaTokenExpiryWorker.close();
    wabaTokenExpiryWorker = null;
  }
}
