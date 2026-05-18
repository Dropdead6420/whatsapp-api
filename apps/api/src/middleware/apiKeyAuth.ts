import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  authenticateApiKey,
  recordApiRequestLog,
} from "../services/apiKey.service";

export interface RequestWithApiKey extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyRateLimit?: number;
  tenantId?: string;
}

function extractApiKey(req: Request): string | null {
  const explicit = req.headers["x-nexaflow-api-key"];
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function requireApiKey(
  req: RequestWithApiKey,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = Date.now();
  const secret = extractApiKey(req);
  if (!secret) {
    return next(
      new ApiError(
        ErrorCodes.UNAUTHORIZED,
        401,
        "API key required. Use Authorization: Bearer <key> or X-NexaFlow-API-Key.",
      ),
    );
  }

  try {
    const auth = await authenticateApiKey(secret);
    req.apiKeyId = auth.apiKeyId;
    req.apiKeyName = auth.name;
    req.apiKeyRateLimit = auth.rateLimit;
    req.tenantId = auth.tenantId;

    res.on("finish", () => {
      const forwarded = (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim();
      void recordApiRequestLog({
        tenantId: auth.tenantId,
        apiKeyId: auth.apiKeyId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ipAddress: forwarded ?? req.ip ?? req.socket.remoteAddress ?? null,
        userAgent:
          (req.headers["user-agent"] as string | undefined) ?? null,
      });
    });

    next();
  } catch (err) {
    next(err);
  }
}
