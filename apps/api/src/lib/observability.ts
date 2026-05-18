import * as Sentry from "@sentry/node";
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";
import type { Request, Response, NextFunction } from "express";

// ----------------------------------------------------------------------------
// Observability (T-121 + T-122).
//
// - Sentry: error capture for API + workers. Init is a no-op when SENTRY_DSN
//   is missing or a placeholder so dev keeps working.
// - prom-client: RED-style metrics — Rate / Errors / Duration per route, per
//   HTTP method, per status-code class. Exposed via /metrics (admin-gated)
//   for a Prometheus / Grafana scrape.
//
// The router-aware `httpMetricsMiddleware` records the matched route
// pattern, not the raw URL, so high-cardinality tenant ids never land in
// metric label sets.
// ----------------------------------------------------------------------------

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENV = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const SENTRY_RELEASE = process.env.SENTRY_RELEASE ?? process.env.GIT_SHA ?? undefined;
const SENTRY_TRACES_SAMPLE_RATE = Number(
  process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
);

function isLiveSentryDsn(value: string | undefined): value is string {
  return Boolean(
    value && !value.startsWith("your_") && value.startsWith("https://"),
  );
}

let sentryInitialized = false;

export function initSentry(): void {
  if (sentryInitialized) return;
  if (!isLiveSentryDsn(SENTRY_DSN)) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    release: SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(SENTRY_TRACES_SAMPLE_RATE)
      ? SENTRY_TRACES_SAMPLE_RATE
      : 0.1,
    // Don't ship request bodies — they may contain PII / tokens.
    sendDefaultPii: false,
  });
  sentryInitialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

export function sentryEnabled(): boolean {
  return sentryInitialized;
}

// --- Prometheus -------------------------------------------------------------

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "nexaflow_",
});

const httpRequestsTotal = new Counter({
  name: "nexaflow_http_requests_total",
  help: "Count of HTTP requests served by the API.",
  labelNames: ["method", "route", "status_class"] as const,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "nexaflow_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_class"] as const,
  // Buckets tuned for inbox-poll-style p95<400ms targets; long tail caught
  // by the 2.5s bucket for synthetic slow paths (AI calls, etc).
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const httpRequestErrorsTotal = new Counter({
  name: "nexaflow_http_request_errors_total",
  help: "Count of HTTP requests that responded with 5xx.",
  labelNames: ["method", "route"] as const,
  registers: [metricsRegistry],
});

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "1xx";
}

function routePattern(req: Request): string {
  // Prefer Express's matched route to keep label cardinality bounded —
  // raw URLs carry tenant / contact / message ids.
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (route && typeof route === "string") {
    // Express only fills `route.path` for the leaf router — prepend the
    // mount path when available so /api/v1/conversations/:id reads as one
    // label, not just `/:id`.
    const base = (req as Request & { baseUrl?: string }).baseUrl ?? "";
    return `${base}${route}` || "/";
  }
  // Fall back to the originalUrl path component. Only collapse segments
  // that look like cuid/uuid/random ids — those have BOTH letters and
  // digits in 8+ chars. Pure-letter segments like "conversations" stay
  // verbatim, even when 12+ chars long.
  const path = req.originalUrl.split("?")[0] ?? "/";
  return path.replace(/\/[a-z0-9]{8,}/gi, (segment) => {
    const inner = segment.slice(1);
    const hasLetter = /[a-z]/i.test(inner);
    const hasDigit = /[0-9]/.test(inner);
    return hasLetter && hasDigit ? "/:id" : segment;
  });
}

export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const elapsedNs = Number(process.hrtime.bigint() - startedAt);
    const elapsedSec = elapsedNs / 1_000_000_000;
    const route = routePattern(req);
    const sc = statusClass(res.statusCode);
    const labels = { method: req.method, route, status_class: sc };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, elapsedSec);
    if (res.statusCode >= 500) {
      httpRequestErrorsTotal.inc({ method: req.method, route });
    }
  });
  next();
}
