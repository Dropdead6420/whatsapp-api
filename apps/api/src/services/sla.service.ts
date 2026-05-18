import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import {
  getSlaQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type SlaJobData,
} from "../lib/queue";

/**
 * SLA worker — stamps `slaBreachedAt` on conversations where:
 *   - lastInboundAt is more than tenant.slaMinutes ago, AND
 *   - lastOutboundAt is null OR older than lastInboundAt (i.e. no reply yet)
 *
 * The breach timestamp is consumed by the inbox UI to surface a red SLA chip.
 * It's cleared when the agent replies (see conversations.routes.ts) and when
 * a new inbound arrives (see whatsapp.routes.ts).
 */

async function tick(): Promise<void> {
  // Pull tenants with their SLA setting; iterate per tenant so we use the
  // right threshold.
  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slaMinutes: true },
  });
  for (const t of tenants) {
    const cutoff = new Date(Date.now() - t.slaMinutes * 60 * 1000);

    // Stamp breach on conversations where:
    //   inbound was before cutoff, AND
    //   either no outbound has happened OR last outbound was before that inbound, AND
    //   not already stamped.
    const candidates = await prisma.conversation.findMany({
      where: {
        tenantId: t.id,
        isActive: true,
        slaBreachedAt: null,
        lastInboundAt: { lt: cutoff },
      },
      select: {
        id: true,
        lastInboundAt: true,
        lastOutboundAt: true,
      },
      take: 200,
    });

    for (const c of candidates) {
      if (!c.lastInboundAt) continue;
      const replied =
        c.lastOutboundAt && c.lastOutboundAt.getTime() >= c.lastInboundAt.getTime();
      if (replied) continue;
      await prisma.conversation.update({
        where: { id: c.id },
        data: { slaBreachedAt: new Date() },
      });
    }
  }
}

const SCAN_INTERVAL_MS = 60_000;
const SCAN_JOB_NAME = "scan";

let slaWorker: Worker<SlaJobData> | null = null;

export async function startSlaWorker(): Promise<void> {
  if (slaWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[sla-worker] database unavailable; worker not started.");
    return;
  }

  const q = getSlaQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[sla-worker] could not register scan scheduler (Redis unavailable?)",
      (err as Error).message,
    );
    return;
  }

  slaWorker = new Worker<SlaJobData>(
    QueueNames.SLA_DISPATCH,
    async () => {
      await tick();
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  slaWorker.on("failed", (job, err) => {
    console.error(`[sla-worker] job ${job?.id} failed:`, err?.message);
  });
  slaWorker.on("error", (err) => {
    console.error("[sla-worker] worker error:", err.message);
  });

  trackWorker(slaWorker);
}

export function stopSlaWorker(): void {
  if (slaWorker) {
    void slaWorker.close();
    slaWorker = null;
  }
}
