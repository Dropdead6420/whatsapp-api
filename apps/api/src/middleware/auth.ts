import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { prisma } from "@nexaflow/db";
import { authService } from "../services/auth.service";
import {
  getAuthContext,
  setAuthContext,
  type CachedAuthContext,
} from "../lib/redis";

export interface RequestWithAuth extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: UserRole;
  /**
   * When the request is being made under an impersonation session,
   * `actorUserId` is the real SUPER_ADMIN behind the keyboard. `userId`
   * + `userRole` + `tenantId` still reflect the *target* so existing
   * tenant-scoped queries work unchanged.
   */
  actorUserId?: string;
  actorRole?: UserRole;
  /** True when this request is impersonating (i.e. actorUserId is set). */
  impersonating?: boolean;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export const authMiddleware = (
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractToken(req);
  if (!token) {
    return next();
  }
  try {
    const payload = authService.verifyAccessToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role;
    if (payload.tenantId) req.tenantId = payload.tenantId;
    if (payload.actorUserId) {
      req.actorUserId = payload.actorUserId;
      req.actorRole = payload.actorRole;
      req.impersonating = true;
    }
  } catch {
    // Optional auth — silently skip on invalid token. requireAuth will enforce.
  }
  next();
};

async function loadAuthContextFromDb(
  userId: string,
): Promise<CachedAuthContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      role: true,
      tenantId: true,
      tenant: { select: { status: true } },
    },
  });
  if (!user) return null;
  return {
    userStatus: user.status,
    role: user.role,
    tenantId: user.tenantId ?? null,
    tenantStatus: user.tenant?.status ?? null,
    revokedAt: null,
  };
}

async function resolveAuthContext(
  userId: string,
): Promise<CachedAuthContext | null> {
  const cached = await getAuthContext(userId);
  if (cached) return cached;
  const fresh = await loadAuthContextFromDb(userId);
  if (fresh) await setAuthContext(userId, fresh);
  return fresh;
}

function authContextAllowsRequest(
  ctx: CachedAuthContext,
  tokenIat: number | undefined,
): { allowed: boolean; reason?: string } {
  if (ctx.userStatus !== "ACTIVE") {
    return { allowed: false, reason: "User account is not active." };
  }
  if (ctx.tenantStatus && ctx.tenantStatus !== "ACTIVE") {
    return { allowed: false, reason: "Tenant is suspended or deleted." };
  }
  if (ctx.revokedAt && tokenIat && tokenIat * 1000 < ctx.revokedAt) {
    return { allowed: false, reason: "Session has been revoked." };
  }
  return { allowed: true };
}

export const requireAuth = async (
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractToken(req);
  if (!token && !req.userId) {
    return next(
      new ApiError(
        ErrorCodes.UNAUTHORIZED,
        401,
        "Authentication required. Provide a Bearer token.",
      ),
    );
  }
  let userId = req.userId;
  let tokenIat: number | undefined;
  try {
    if (!userId && token) {
      const payload = authService.verifyAccessToken(token);
      req.userId = payload.userId;
      req.userRole = payload.role;
      if (payload.tenantId) req.tenantId = payload.tenantId;
      if (payload.actorUserId) {
        req.actorUserId = payload.actorUserId;
        req.actorRole = payload.actorRole;
        req.impersonating = true;
      }
      tokenIat = payload.iat;
      userId = payload.userId;
    }
  } catch (err) {
    return next(err);
  }

  if (!userId) {
    return next(
      new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
    );
  }

  try {
    const ctx = await resolveAuthContext(userId);
    if (!ctx) {
      return next(
        new ApiError(ErrorCodes.UNAUTHORIZED, 401, "User no longer exists."),
      );
    }
    const decision = authContextAllowsRequest(ctx, tokenIat);
    if (!decision.allowed) {
      return next(
        new ApiError(
          ErrorCodes.UNAUTHORIZED,
          401,
          decision.reason ?? "Not authorized.",
        ),
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const requireTenantScope = (
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.userId) {
    return next(
      new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
    );
  }
  if (!req.tenantId) {
    return next(
      new ApiError(
        ErrorCodes.MULTI_TENANT_VIOLATION,
        400,
        "Tenant context required for this resource.",
      ),
    );
  }
  next();
};
