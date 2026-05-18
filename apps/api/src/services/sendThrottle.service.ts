import { getRedis } from "../lib/redis";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/**
 * Per-tenant rolling-window send throttle.
 *
 * V2 §18 calls out Meta quality-score monitoring + smart sending throttles as
 * a compliance must-have. Meta enforces tier-based business-initiated
 * conversation limits (1k / 10k / 100k / unlimited per 24h). Bursts above the
 * tier cause quality-rating drops which can suspend the WABA.
 *
 * We enforce two protections:
 * 1. Monthly cap from `Tenant.messageQuotaPerMonth` (plan limit).
 * 2. Per-second smoothing: max N sends per second to avoid spike bursts.
 *
 * Counters live in Redis. If Redis is unavailable the throttle fails open
 * rather than blocking real traffic — degraded performance > full outage.
 */

const PER_SECOND_LIMIT = Number(process.env.SEND_PER_SECOND_LIMIT ?? "20");
const ROLLING_WINDOW_MS = 1000; // 1 second smoothing window

interface ThrottleResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  monthlyUsed?: number;
  monthlyQuota?: number;
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function canSendNow(tenantId: string): Promise<ThrottleResult> {
  let monthlyQuota = 10_000;
  let monthlyUsed = 0;

  try {
    // 1. Monthly cap check from DB + Redis counter.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messageQuotaPerMonth: true },
    });
    monthlyQuota = tenant?.messageQuotaPerMonth ?? 10_000;

    const r = await getRedis();
    const monthKey = `send:{${tenantId}}:month:${monthStartIso()}`;
    const usedRaw = await r.get(monthKey);
    monthlyUsed = usedRaw ? Number(usedRaw) : 0;

    if (monthlyUsed >= monthlyQuota) {
      return {
        allowed: false,
        reason: `Monthly send quota reached (${monthlyUsed}/${monthlyQuota}). Upgrade your plan or wait until next billing cycle.`,
        monthlyUsed,
        monthlyQuota,
      };
    }

    // 2. Per-second smoothing using a sliding window of timestamps.
    const secKey = `send:{${tenantId}}:sec`;
    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    await r.zRemRangeByScore(secKey, 0, cutoff);
    const recent = await r.zCard(secKey);

    if (recent >= PER_SECOND_LIMIT) {
      return {
        allowed: false,
        reason: `Send rate limit reached (${recent}/${PER_SECOND_LIMIT} per second). Try again shortly.`,
        retryAfterMs: ROLLING_WINDOW_MS,
        monthlyUsed,
        monthlyQuota,
      };
    }
  } catch (err) {
    // Redis down or other infra issue — fail open with a console warning.
    console.warn(
      "[send-throttle] check failed, allowing send:",
      (err as Error).message,
    );
    return { allowed: true, monthlyUsed, monthlyQuota };
  }

  return { allowed: true, monthlyUsed, monthlyQuota };
}

/**
 * Record a successful send (call this immediately after the Meta API accepts
 * the message). Increments both the per-second sliding window and the monthly
 * counter atomically.
 */
export async function recordSend(tenantId: string): Promise<void> {
  try {
    const r = await getRedis();
    const monthKey = `send:{${tenantId}}:month:${monthStartIso()}`;
    const secKey = `send:{${tenantId}}:sec`;
    const now = Date.now();
    const monthExpirySec = 60 * 60 * 24 * 40; // 40 days — survives month boundaries

    await Promise.all([
      r.zAdd(secKey, { score: now, value: `${now}-${Math.random()}` }),
      r.expire(secKey, 10),
      r.incr(monthKey),
      r.expire(monthKey, monthExpirySec),
    ]);
  } catch (err) {
    console.warn(
      "[send-throttle] record failed (not fatal):",
      (err as Error).message,
    );
  }
}

/**
 * Convenience wrapper for routes — throws ApiError(429) when blocked.
 */
export async function assertCanSend(tenantId: string): Promise<void> {
  const result = await canSendNow(tenantId);
  if (!result.allowed) {
    throw new ApiError(
      ErrorCodes.TOO_MANY_REQUESTS,
      429,
      result.reason ?? "Send throttled.",
    );
  }
}

export async function getTenantSendStats(
  tenantId: string,
): Promise<{ monthlyUsed: number; monthlyQuota: number; perSecondLimit: number }> {
  let monthlyQuota = 10_000;
  let monthlyUsed = 0;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messageQuotaPerMonth: true },
    });
    monthlyQuota = tenant?.messageQuotaPerMonth ?? 10_000;
    const r = await getRedis();
    const usedRaw = await r.get(`send:{${tenantId}}:month:${monthStartIso()}`);
    monthlyUsed = usedRaw ? Number(usedRaw) : 0;
  } catch {
    // ignore
  }
  return { monthlyUsed, monthlyQuota, perSecondLimit: PER_SECOND_LIMIT };
}
