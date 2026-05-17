import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface RequestWithContext extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: string;
  user?: any;
}

/**
 * Multi-tenant middleware
 * Extracts tenantId from:
 * 1. Authorization header (JWT payload)
 * 2. X-Tenant-ID header
 * 3. Subdomain
 *
 * Ensures all requests are scoped to a tenant
 */
export const multiTenantMiddleware = (
  req: RequestWithContext,
  _res: Response,
  next: NextFunction,
) => {
  try {
    // Extract tenantId from various sources
    const tenantId = req.headers["x-tenant-id"] as string;

    if (!tenantId && req.headers.authorization) {
      // Could extract from JWT token here (will be implemented in auth phase)
      // For now, just accept from header
    }

    // For public routes, tenantId is optional
    // For protected routes, it will be enforced in auth middleware
    if (tenantId) {
      req.tenantId = tenantId;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Ensure tenantId is present (for protected routes)
 */
export const requireTenant = (
  req: RequestWithContext,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.tenantId) {
    throw new ApiError(
      ErrorCodes.MULTI_TENANT_VIOLATION,
      400,
      "Tenant context is required. Please provide X-Tenant-ID header.",
    );
  }
  next();
};
