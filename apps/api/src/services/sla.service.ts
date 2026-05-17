import { prisma } from "@nexaflow/db";

/**
 * SLA worker — stamps `slaBreachedAt` on conversations where:
 *   - lastInboundAt is more than tenant.slaMinutes ago, AND
 *   - lastOutboundAt is null OR older than lastInboundAt (i.e. no reply yet)
 *
 * The breach timestamp is consumed by the inbox UI to surface a red SLA chip.
 * It's cleared when the agent replies (see conversations.routes.ts) and when
 * a new inbound arrives (see whatsapp.routes.ts).
 */

let workerHandle: ReturnType<typeof setInterval> | null = null;

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

export async function startSlaWorker(intervalMs = 60_000): Promise<void> {
  if (workerHandle) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[sla-worker] database unavailable; worker not started.");
    return;
  }
  setTimeout(() => void tick(), 5_000);
  workerHandle = setInterval(() => void tick(), intervalMs);
}

export function stopSlaWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}
