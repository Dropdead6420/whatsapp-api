import {
  prisma,
  WhatsAppProviderKey,
  WhatsAppSendKind,
} from "@nexaflow/db";

// ----------------------------------------------------------------------------
// AI Provider Router — telemetry layer (PRD-v2 §8, Sprint 2 slice 1).
//
// Every outbound WhatsApp send funnels through whatsapp/index.ts's
// sendWhatsAppText / sendWhatsAppTemplate wrappers. Slice 1 wires those
// wrappers to write a ProviderHealthSample after each attempt (success or
// failure) so we have data to reason about. Slice 2 will use the same
// table to drive smart selection between Meta-Direct / Gupshup / Twilio /
// Haptik / 360dialog.
//
// Sampling is fire-and-forget — a sample write must never block or fail
// the send. recordSample swallows errors and logs.
// ----------------------------------------------------------------------------

export interface RecordSampleInput {
  tenantId: string;
  providerKey: WhatsAppProviderKey;
  phoneNumberId?: string | null;
  kind: WhatsAppSendKind;
  success: boolean;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
}

export async function recordSample(input: RecordSampleInput): Promise<void> {
  try {
    await prisma.providerHealthSample.create({
      data: {
        tenantId: input.tenantId,
        providerKey: input.providerKey,
        phoneNumberId: input.phoneNumberId ?? null,
        kind: input.kind,
        success: input.success,
        statusCode: input.statusCode ?? null,
        errorCode: input.errorCode ?? null,
        latencyMs: input.latencyMs ?? null,
      },
    });
  } catch (err) {
    // Sample writes are best-effort. A failure here is observed only in
    // logs — never in the send path.
    console.warn(
      "[provider-router] recordSample failed:",
      (err as Error).message,
    );
  }
}

// ----------------------------------------------------------------------------
// Stats aggregation
// ----------------------------------------------------------------------------

export interface ProviderStats {
  providerKey: WhatsAppProviderKey;
  totalSends: number;
  successCount: number;
  failureCount: number;
  successRate: number; // 0-1
  // Latency stats — null when no samples carried timing.
  p50LatencyMs: number | null;
  p90LatencyMs: number | null;
  // Top error codes seen in the window, by frequency. Empty when all-success.
  topErrors: Array<{ code: string; count: number }>;
}

export interface ProviderStatsWindow {
  windowHours: number;
  fromAt: string; // ISO
  toAt: string; // ISO
  providers: ProviderStats[];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo));
}

/**
 * Per-tenant health stats over a rolling window. Default window is 24h —
 * long enough to smooth bursty traffic, short enough that a provider
 * outage shows up within the same operator shift.
 */
export async function getTenantProviderStats(
  tenantId: string,
  windowHours = 24,
): Promise<ProviderStatsWindow> {
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 60 * 60 * 1000);

  const samples = await prisma.providerHealthSample.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
    },
    select: {
      providerKey: true,
      success: true,
      errorCode: true,
      latencyMs: true,
    },
    take: 50_000,
  });

  const byProvider = new Map<
    WhatsAppProviderKey,
    {
      success: number;
      failure: number;
      latencies: number[];
      errors: Map<string, number>;
    }
  >();

  for (const s of samples) {
    let bucket = byProvider.get(s.providerKey);
    if (!bucket) {
      bucket = {
        success: 0,
        failure: 0,
        latencies: [],
        errors: new Map(),
      };
      byProvider.set(s.providerKey, bucket);
    }
    if (s.success) {
      bucket.success += 1;
    } else {
      bucket.failure += 1;
      if (s.errorCode) {
        bucket.errors.set(s.errorCode, (bucket.errors.get(s.errorCode) ?? 0) + 1);
      }
    }
    if (typeof s.latencyMs === "number" && Number.isFinite(s.latencyMs)) {
      bucket.latencies.push(s.latencyMs);
    }
  }

  const providers: ProviderStats[] = [];
  for (const [providerKey, b] of byProvider.entries()) {
    const total = b.success + b.failure;
    const sortedLatencies = [...b.latencies].sort((a, c) => a - c);
    const topErrors = Array.from(b.errors.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, c) => c.count - a.count)
      .slice(0, 5);
    providers.push({
      providerKey,
      totalSends: total,
      successCount: b.success,
      failureCount: b.failure,
      successRate: total > 0 ? b.success / total : 0,
      p50LatencyMs: percentile(sortedLatencies, 0.5),
      p90LatencyMs: percentile(sortedLatencies, 0.9),
      topErrors,
    });
  }
  // Sort by total volume descending so the dominant route lands on top.
  providers.sort((a, b) => b.totalSends - a.totalSends);

  return {
    windowHours,
    fromAt: from.toISOString(),
    toAt: to.toISOString(),
    providers,
  };
}
