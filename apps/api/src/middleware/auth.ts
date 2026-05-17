import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { authService } from "../services/auth.service";

export interface RequestWithAuth extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: UserRole;
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
  } catch {
    // Optional auth — silently skip on invalid token. requireAuth will enforce.
  }
  next();
};

export const requireAuth = (
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction,
): void => {
  if (req.userId) return next();
  const token = extractToken(req);
  if (!token) {
    return next(
      new ApiError(
        ErrorCodes.UNAUTHORIZED,
        401,
        "Authentication required. Provide a Bearer token.",
      ),
    );
  }
  try {
    const payload = authService.verifyAccessToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role;
    if (payload.tenantId) req.tenantId = payload.tenantId;
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
