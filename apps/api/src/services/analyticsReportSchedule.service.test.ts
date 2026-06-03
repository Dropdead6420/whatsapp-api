import { describe, expect, it, vi } from "vitest";

vi.mock("@nexaflow/db", () => ({
  prisma: {},
  AnalyticsReportFrequency: {
    DAILY: "DAILY",
    WEEKLY: "WEEKLY",
    MONTHLY: "MONTHLY",
  },
  AnalyticsReportScope: {
    PLATFORM: "PLATFORM",
    TENANT: "TENANT",
  },
  AnalyticsReportFormat: {
    CSV: "CSV",
    PDF: "PDF",
  },
  AnalyticsReportStatus: {
    SENT: "SENT",
    FAILED: "FAILED",
    NEVER_RUN: "NEVER_RUN",
  },
}));

vi.mock("../lib/queue", () => ({
  getAnalyticsReportQueue: vi.fn(),
  getQueueConnection: vi.fn(),
  QueueNames: { ANALYTICS_REPORTS: "analytics-reports" },
  trackWorker: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: class {},
}));

vi.mock("./analyticsSummary.service", () => ({
  getPlatformSummary: vi.fn(),
  getTenantSummary: vi.fn(),
}));

vi.mock("./email.service", () => ({
  sendEmail: vi.fn(),
}));

import { AnalyticsReportFrequency, AnalyticsReportScope } from "@nexaflow/db";
import {
  analyticsReportScheduleKey,
  computeNextAnalyticsReportRunAt,
} from "./analyticsReportSchedule.service";

describe("computeNextAnalyticsReportRunAt", () => {
  it("schedules daily reports at the next 09:00 UTC boundary", () => {
    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.DAILY,
        new Date("2026-06-03T08:59:00.000Z"),
      ).toISOString(),
    ).toBe("2026-06-03T09:00:00.000Z");

    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.DAILY,
        new Date("2026-06-03T09:01:00.000Z"),
      ).toISOString(),
    ).toBe("2026-06-04T09:00:00.000Z");
  });

  it("schedules weekly reports for Monday 09:00 UTC", () => {
    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.WEEKLY,
        new Date("2026-06-03T10:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-06-08T09:00:00.000Z");

    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.WEEKLY,
        new Date("2026-06-08T08:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-06-08T09:00:00.000Z");
  });

  it("schedules monthly reports for the first day at 09:00 UTC", () => {
    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.MONTHLY,
        new Date("2026-06-01T08:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-06-01T09:00:00.000Z");

    expect(
      computeNextAnalyticsReportRunAt(
        AnalyticsReportFrequency.MONTHLY,
        new Date("2026-06-02T08:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("analyticsReportScheduleKey", () => {
  it("uses stable keys for platform and tenant schedules", () => {
    expect(
      analyticsReportScheduleKey(AnalyticsReportScope.PLATFORM, null),
    ).toBe("platform");
    expect(
      analyticsReportScheduleKey(AnalyticsReportScope.TENANT, "tenant_123"),
    ).toBe("tenant:tenant_123");
  });
});
