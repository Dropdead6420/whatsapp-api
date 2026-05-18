import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function getRedis(): Promise<RedisClientType> {
  if (client && client.isOpen) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c: RedisClientType = createClient({ url: REDIS_URL });
    c.on("error", (err) => console.error("[redis]", err));
    await c.connect();
    client = c;
    return c;
  })();

  return connecting;
}

export async function closeRedis(): Promise<void> {
  const active = client;
  client = null;
  connecting = null;
  if (active?.isOpen) {
    await active.quit();
  }
}

const REFRESH_PREFIX = "auth:refresh:";
const BLACKLIST_PREFIX = "auth:blacklist:";

export async function storeRefreshToken(
  jti: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  const r = await getRedis();
  await r.set(`${REFRESH_PREFIX}${jti}`, userId, { EX: ttlSeconds });
}

export async function isRefreshTokenActive(jti: string): Promise<boolean> {
  const r = await getRedis();
  const v = await r.get(`${REFRESH_PREFIX}${jti}`);
  return v !== null;
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  const r = await getRedis();
  await r.del(`${REFRESH_PREFIX}${jti}`);
  await r.set(`${BLACKLIST_PREFIX}${jti}`, "1", { EX: 60 * 60 * 24 * 14 });
}

export async function isRefreshTokenBlacklisted(jti: string): Promise<boolean> {
  const r = await getRedis();
  const v = await r.get(`${BLACKLIST_PREFIX}${jti}`);
  return v !== null;
}

// ----------------------------------------------------------------------------
// Auth context cache (T-090). Every authenticated request validates that the
// user + tenant are still ACTIVE without a Postgres roundtrip. A cache miss
// triggers one DB lookup, populates the cache, and gates the request. A hit
// is a single Redis GET on the hot path.
//
// TTL is intentionally short (60s default) so a SuperAdmin suspending a
// tenant blocks new requests within a minute, without us needing an explicit
// invalidation broadcast. Explicit invalidation (`invalidateAuthContext`) is
// still called from the lifecycle hooks that already know which user is
// affected (logout, password change, role change).
// ----------------------------------------------------------------------------

const AUTH_CTX_PREFIX = "auth:ctx:";
const AUTH_CTX_TTL_SECONDS = Number(
  process.env.AUTH_CTX_CACHE_TTL_SECONDS ?? 60,
);

export interface CachedAuthContext {
  userStatus: string;
  role: string;
  tenantId: string | null;
  tenantStatus: string | null;
  // ms epoch — if set, every JWT with iat * 1000 < revokedAt is rejected.
  revokedAt: number | null;
}

export async function getAuthContext(
  userId: string,
): Promise<CachedAuthContext | null> {
  try {
    const r = await getRedis();
    const raw = await r.get(`${AUTH_CTX_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuthContext;
  } catch {
    // Redis hiccup — fall back to DB lookup (caller handles).
    return null;
  }
}

export async function setAuthContext(
  userId: string,
  ctx: CachedAuthContext,
  ttlSeconds: number = AUTH_CTX_TTL_SECONDS,
): Promise<void> {
  try {
    const r = await getRedis();
    await r.set(`${AUTH_CTX_PREFIX}${userId}`, JSON.stringify(ctx), {
      EX: ttlSeconds,
    });
  } catch {
    // Cache write failure is non-fatal; the next request just re-queries.
  }
}

export async function invalidateAuthContext(userId: string): Promise<void> {
  try {
    const r = await getRedis();
    await r.del(`${AUTH_CTX_PREFIX}${userId}`);
  } catch {
    // Non-fatal — the cache will expire on its own within the TTL.
  }
}
