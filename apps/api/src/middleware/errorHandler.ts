import { Request, Response, NextFunction } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/**
 * Global error handler middleware
 * Must be used as the last middleware
 */
export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error("[ERROR]", {
    message: err.message,
    code: err instanceof ApiError ? err.code : "INTERNAL_SERVER_ERROR",
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    },
  });
};
