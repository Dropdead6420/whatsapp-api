import { Response, NextFunction } from "express";
import {
  ApiError,
  ErrorCodes,
  Permission,
  Permissions,
  RolePermissions,
  UserRole,
} from "@nexaflow/shared";
import { RequestWithAuth } from "./auth";

function hasPermission(role: UserRole, perm: Permission): boolean {
  const granted = RolePermissions[role];
  return granted?.includes(perm) ?? false;
}

export function requireRole(...allowed: UserRole[]) {
  return (req: RequestWithAuth, _res: Response, next: NextFunction) => {
    if (!req.userId || !req.userRole) {
      return next(
        new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
      );
    }
    if (!allowed.includes(req.userRole)) {
      return next(
        new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          `Role ${req.userRole} is not permitted for this resource.`,
        ),
      );
    }
    next();
  };
}

export function requirePermission(...required: Permission[]) {
  return (req: RequestWithAuth, _res: Response, next: NextFunction) => {
    if (!req.userId || !req.userRole) {
      return next(
        new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Authentication required."),
      );
    }
    const missing = required.filter((p) => !hasPermission(req.userRole!, p));
    if (missing.length > 0) {
      return next(
        new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          `Missing required permission(s): ${missing.join(", ")}`,
        ),
      );
    }
    next();
  };
}

export { Permissions };
