import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface RequestWithAuth extends Request {
  tenantId?: string;
  userId?: string;
  userRole?: string;
  user?: any;
}

/**
 * Authentication middleware
 * Placeholder - will be implemented in Phase 2
 */
export const authMiddleware = (
  req: RequestWithAuth,
  res: Response,
  next: NextFunction,
) => {
  // TODO: Implement JWT verification
  // TODO: Extract user info from token
  // TODO: Set req.userId, req.userRole
  next();
};

/**
 * Require authentication (protected routes)
 */
export const requireAuth = (
  req: RequestWithAuth,
  res: Response,
  next: NextFunction,
) => {
  if (!req.userId) {
    throw new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      "Authentication required. Please provide a valid JWT token.",
    );
  }
  next();
};
