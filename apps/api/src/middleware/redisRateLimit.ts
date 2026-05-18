import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { getRedis } from "../lib/redis";

interface RedisRateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
}

function defaultKey(req: Request): string {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  return forwarded ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function hashKey(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function redisRateLimit(options: RedisRateLimitOptions) {
  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));

  return async (req: Request, res: Response, next: NextFunction) => {
    const bucket = Math.floor(Date.now() / options.windowMs);
    const identity = options.key?.(req) ?? defaultKey(req);
    const key = `rl:${options.name}:${bucket}:${hashKey(identity)}`;

    try {
      const redis = await getRedis();
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds + 2);
      }

      const remaining = Math.max(0, options.max - current);
      const resetSeconds =
        Math.ceil(((bucket + 1) * options.windowMs - Date.now()) / 1000);

      res.setHeader("RateLimit-Limit", String(options.max));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.max(1, resetSeconds)));

      if (current > options.max) {
        res.status(429).json({
          success: false,
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "Rate limit exceeded.",
          },
        });
        return;
      }

      next();
    } catch (err) {
      // Fail open: an unavailable Redis cluster should not take down the API.
      console.warn("[rate-limit] redis unavailable; allowing request", err);
      next();
    }
  };
}
