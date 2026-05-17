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
