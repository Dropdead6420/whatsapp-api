import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindFirst: vi.fn(),
  itemFindMany: vi.fn(),
  runTenantLlmJson: vi.fn(),
  sendToTenant: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: { findFirst: mocks.tenantFindFirst },
    platformActionItem: { findMany: mocks.itemFindMany },
  },
  Prisma: {},
  TenantType: {
    DIRECT: "DIRECT",
    WHITE_LABEL: "WHITE_LABEL",
    BUSINESS: "BUSINESS",
  },
  PlatformActionCode: {
    WALLET_RISK_CRITICAL: "WALLET_RISK_CRITICAL",
    WEBHOOK_FAILURE_SPIKE: "WEBHOOK_FAILURE_SPIKE",
    AI_USAGE_SPIKE: "AI_USAGE_SPIKE",
    DOMAIN_HEALTH_DEGRADED: "DOMAIN_HEALTH_DEGRADED",
    COMPLIANCE_BLOCK_SPIKE: "COMPLIANCE_BLOCK_SPIKE",
    PROVIDER_HEALTH_DEGRADED: "PROVIDER_HEALTH_DEGRADED",
    WALLET_RISK_URGENT: "WALLET_RISK_URGENT",
    CHURN_RISK: "CHURN_RISK",
    ONBOARDING_STALLED: "ONBOARDING_STALLED",
  },
  PlatformActionSeverity: {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    URGENT: "URGENT",
  },
  PlatformActionStatus: {
    OPEN: "OPEN",
    ACKED: "ACKED",
    RESOLVED: "RESOLVED",
    DISMISSED: "DISMISSED",
    SNOOZED: "SNOOZED",
  },
  WalletRiskTier: {},
  WhatsAppProviderKey: {},
  ComplianceVerdict: {},
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

vi.mock("./pushNotification.service", () => ({
  sendToTenant: mocks.sendToTenant,
}));

vi.mock("../lib/queue", () => ({
  getPlatformMonitorQueue: vi.fn(),
  getQueueConnection: vi.fn(),
  QueueNames: { PLATFORM_MONITOR: "platform-monitor" },
  trackWorker: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Worker: class {},
}));

import { runScheduledPlatformSummary } from "./platformMonitor.service";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  code: "WALLET_RISK_CRITICAL",
  severity: "URGENT",
  title: "Wallet critical",
  body: "0 credits",
  targetTenantId: "t_target",
  createdAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Always-successful LLM mock by default; tests can override.
  mocks.runTenantLlmJson.mockResolvedValue({
    headline: "Three urgent things to do.",
    actions: [],
  });
});

describe("runScheduledPlatformSummary", () => {
  it("skips push when no DIRECT tenant exists", async () => {
    mocks.tenantFindFirst.mockResolvedValue(null);

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/no active direct tenant/i);
    expect(mocks.itemFindMany).not.toHaveBeenCalled();
    expect(mocks.sendToTenant).not.toHaveBeenCalled();
  });

  it("skips push on a clean queue (zero URGENT and zero HIGH)", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockResolvedValue([]); // empty queue

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(false);
    expect(result.platformTenantId).toBe("platform_1");
    expect(result.urgentCount).toBe(0);
    expect(result.highCount).toBe(0);
    expect(mocks.sendToTenant).not.toHaveBeenCalled();
  });

  it("skips push when queue has only MEDIUM/LOW items", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockResolvedValue([
      item({ severity: "MEDIUM" }),
      item({ severity: "LOW" }),
      item({ severity: "MEDIUM" }),
    ]);

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/no urgent or high/i);
    expect(mocks.sendToTenant).not.toHaveBeenCalled();
  });

  it("pushes when at least one URGENT item is open", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockResolvedValue([
      item({ severity: "URGENT" }),
      item({ severity: "MEDIUM" }),
    ]);
    mocks.sendToTenant.mockResolvedValue({ delivered: 2, failed: 0, prunedTokens: 0 });

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(true);
    expect(result.urgentCount).toBe(1);
    expect(result.highCount).toBe(0);
    expect(mocks.sendToTenant).toHaveBeenCalledTimes(1);
    const call = mocks.sendToTenant.mock.calls[0];
    expect(call[0]).toBe("platform_1");
    expect(call[1].title).toMatch(/1 urgent/);
    expect(call[1].data?.type).toBe("PLATFORM_MONITOR_SUMMARY");
  });

  it("pushes when only HIGH items are open (no URGENT)", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockResolvedValue([
      item({ severity: "HIGH" }),
      item({ severity: "HIGH" }),
    ]);
    mocks.sendToTenant.mockResolvedValue({ delivered: 1, failed: 0, prunedTokens: 0 });

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(true);
    expect(result.urgentCount).toBe(0);
    expect(result.highCount).toBe(2);
    expect(mocks.sendToTenant).toHaveBeenCalled();
  });

  it("returns gracefully when the push dispatcher throws", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockResolvedValue([item({ severity: "URGENT" })]);
    mocks.sendToTenant.mockRejectedValue(new Error("FCM unreachable"));

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/push dispatch threw/i);
    expect(result.platformTenantId).toBe("platform_1");
  });

  it("returns gracefully when the summary build throws", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_1" });
    mocks.itemFindMany.mockRejectedValue(new Error("db down"));

    const result = await runScheduledPlatformSummary();

    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/summary build threw/i);
    expect(mocks.sendToTenant).not.toHaveBeenCalled();
  });

  it("picks the oldest DIRECT tenant deterministically", async () => {
    mocks.tenantFindFirst.mockResolvedValue({ id: "platform_oldest" });
    mocks.itemFindMany.mockResolvedValue([item({ severity: "URGENT" })]);
    mocks.sendToTenant.mockResolvedValue({ delivered: 1, failed: 0, prunedTokens: 0 });

    await runScheduledPlatformSummary();

    const tenantCall = mocks.tenantFindFirst.mock.calls[0][0];
    expect(tenantCall.where.type).toBe("DIRECT");
    expect(tenantCall.where.status).toBe("ACTIVE");
    expect(tenantCall.orderBy.createdAt).toBe("asc");
  });
});
