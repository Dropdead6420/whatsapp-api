import { getRedis } from "../lib/redis";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/**
 * Per-tenant + per-WABA-phone-number rolling-window send throttle.
 *
 * V2 §18 calls out Meta quality-score monitoring + smart sending throttles as
 * a compliance must-have. Meta enforces tier-based business-initiated
 * conversation limits (1k / 10k / 100k / unlimited per 24h) AND a per-second
 * limit per phone number (typically 80/s). Bursts above either ceiling cause
 * quality-rating drops which can suspend the WABA.
 *
 * We enforce two default protections:
 * 1. Per-tenant per-second smoothing: max N sends per second across the
 *    whole account.
 * 2. Per-WABA-phone-number per-second smoothing: max M sends per second
 *    against a single phone number (T-093). This is the Meta-side limit
 *    that the tenant-level smoothing can't catch when one tenant has
 *    multiple numbers.
 *
 * The from-scratch architecture PDF is explicit: plan tiers must not impose
 * artificial WhatsApp message limits. Meta/provider limits, wallet balance,
 * rates, and quality controls own message volume. `Tenant.messageQuotaPerMonth`
 * remains available only as an optional emergency safety cap when
 * SEND_MONTHLY_SAFETY_CAP_ENABLED=true.
 *
 * Counters live in Redis. If Redis is unavailable the throttle fails open
 * rather than blocking real traffic — degraded performance > full outage.
 */

const PER_SECOND_LIMIT = Number(process.env.SEND_PER_SECOND_LIMIT ?? "20");
const PER_PHONE_PER_SECOND_LIMIT = Number(
  process.env.SEND_PER_PHONE_PER_SECOND_LIMIT ?? "80",
);
const MONTHLY_SAFETY_CAP_ENABLED =
  process.env.SEND_MONTHLY_SAFETY_CAP_ENABLED === "true";
const ROLLING_WINDOW_MS = 1000; // 1 second smoothing window

interface ThrottleResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  monthlyUsed?: number;
  monthlyQuota?: number | null;
  monthlySafetyCapEnabled?: boolean;
}

export interface ThrottleOptions {
  /** WABA phone-number id. When set, also enforces the per-phone limit. */
  phoneNumberId?: string;
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function canSendNow(
  tenantId: string,
  options: ThrottleOptions = {},
): Promise<ThrottleResult> {
  let monthlyQuota: number | null = null;
  let monthlyUsed = 0;

  try {
    const r = await getRedis();
    const monthKey = `send:{${tenantId}}:month:${monthStartIso()}`;
    const usedRaw = await r.get(monthKey);
    monthlyUsed = usedRaw ? Number(usedRaw) : 0;

    // Optional emergency safety cap. Disabled by default because WhatsApp
    // volume is governed by Meta/provider quality limits + wallet/rate engine,
    // not subscription plan tiers.
    if (MONTHLY_SAFETY_CAP_ENABLED) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { messageQuotaPerMonth: true },
      });
      monthlyQuota = tenant?.messageQuotaPerMonth ?? null;

      if (monthlyQuota !== null && monthlyUsed >= monthlyQuota) {
        return {
          allowed: false,
          reason: `Monthly safety cap reached (${monthlyUsed}/${monthlyQuota}). Ask SuperAdmin to raise the operational cap or wait until next billing cycle.`,
          monthlyUsed,
          monthlyQuota,
          monthlySafetyCapEnabled: true,
        };
      }
    }

    // 1. Per-tenant per-second smoothing using a sliding window of timestamps.
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
        monthlySafetyCapEnabled: MONTHLY_SAFETY_CAP_ENABLED,
      };
    }

    // 2. Per-WABA-phone-number per-second smoothing (T-093). When the
    //    caller knows the phone number id, also gate against the Meta
    //    per-number ceiling.
    if (options.phoneNumberId) {
      const phoneSecKey = `send:phone:{${options.phoneNumberId}}:sec`;
      await r.zRemRangeByScore(phoneSecKey, 0, cutoff);
      const phoneRecent = await r.zCard(phoneSecKey);
      if (phoneRecent >= PER_PHONE_PER_SECOND_LIMIT) {
        return {
          allowed: false,
          reason: `WABA phone-number rate limit reached (${phoneRecent}/${PER_PHONE_PER_SECOND_LIMIT} per second). Try again shortly.`,
          retryAfterMs: ROLLING_WINDOW_MS,
          monthlyUsed,
          monthlyQuota,
          monthlySafetyCapEnabled: MONTHLY_SAFETY_CAP_ENABLED,
        };
      }
    }
  } catch (err) {
    // Redis down or other infra issue — fail open with a console warning.
    console.warn(
      "[send-throttle] check failed, allowing send:",
      (err as Error).message,
    );
    return {
      allowed: true,
      monthlyUsed,
      monthlyQuota,
      monthlySafetyCapEnabled: MONTHLY_SAFETY_CAP_ENABLED,
    };
  }

  return {
    allowed: true,
    monthlyUsed,
    monthlyQuota,
    monthlySafetyCapEnabled: MONTHLY_SAFETY_CAP_ENABLED,
  };
}

/**
 * Record a successful send (call this immediately after the Meta API accepts
 * the message). Increments both the per-second sliding window and the monthly
 * counter atomically.
 */
export async function recordSend(
  tenantId: string,
  options: ThrottleOptions = {},
): Promise<void> {
  try {
    const r = await getRedis();
    const monthKey = `send:{${tenantId}}:month:${monthStartIso()}`;
    const secKey = `send:{${tenantId}}:sec`;
    const now = Date.now();
    const monthExpirySec = 60 * 60 * 24 * 40; // 40 days — survives month boundaries
    const writes: Promise<unknown>[] = [
      r.zAdd(secKey, { score: now, value: `${now}-${Math.random()}` }),
      r.expire(secKey, 10),
      r.incr(monthKey),
      r.expire(monthKey, monthExpirySec),
    ];

    if (options.phoneNumberId) {
      const phoneSecKey = `send:phone:{${options.phoneNumberId}}:sec`;
      writes.push(
        r.zAdd(phoneSecKey, { score: now, value: `${now}-${Math.random()}` }),
        r.expire(phoneSecKey, 10),
      );
    }

    await Promise.all(writes);
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
export async function assertCanSend(
  tenantId: string,
  options: ThrottleOptions = {},
): Promise<void> {
  const result = await canSendNow(tenantId, options);
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
): Promise<{
  monthlyUsed: number;
  monthlyQuota: number | null;
  monthlySafetyCapEnabled: boolean;
  perSecondLimit: number;
}> {
  let monthlyQuota: number | null = null;
  let monthlyUsed = 0;
  try {
    if (MONTHLY_SAFETY_CAP_ENABLED) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { messageQuotaPerMonth: true },
      });
      monthlyQuota = tenant?.messageQuotaPerMonth ?? null;
    }
    const r = await getRedis();
    const usedRaw = await r.get(`send:{${tenantId}}:month:${monthStartIso()}`);
    monthlyUsed = usedRaw ? Number(usedRaw) : 0;
  } catch {
    // ignore
  }
  return {
    monthlyUsed,
    monthlyQuota,
    monthlySafetyCapEnabled: MONTHLY_SAFETY_CAP_ENABLED,
    perSecondLimit: PER_SECOND_LIMIT,
  };
}
