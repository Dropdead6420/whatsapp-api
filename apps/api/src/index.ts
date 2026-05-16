import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";
import { multiTenantMiddleware } from "./middleware/multiTenant";
import { authMiddleware } from "./middleware/auth";

const app: Express = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// Helmet for security headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

app.use("/api/", limiter);

// ============================================================================
// BODY PARSING MIDDLEWARE
// ============================================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// REQUEST CONTEXT MIDDLEWARE
// ============================================================================

// Multi-tenant middleware (extracts tenantId from header or JWT)
app.use(multiTenantMiddleware);

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes (will be added in future phases)
app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    api: "NexaFlow AI v0.1.0",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// ============================================================================
// SERVER STARTUP
// ============================================================================

const startServer = () => {
  app.listen(PORT, () => {
    console.log(
      `🚀 NexaFlow API Server running on http://localhost:${PORT}`,
    );
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📡 API: http://localhost:${PORT}/api/v1/health`);
  });
};

// Handle errors during startup
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Start server
startServer();

export default app;
