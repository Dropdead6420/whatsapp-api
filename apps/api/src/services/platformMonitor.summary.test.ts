import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    platformActionItem: { findMany: mocks.findMany },
  },
  Prisma: {},
  PlatformActionCode: {
    WALLET_RISK_CRITICAL: "WALLET_RISK_CRITICAL",
    WALLET_RISK_URGENT: "WALLET_RISK_URGENT",
    COMPLIANCE_BLOCK_SPIKE: "COMPLIANCE_BLOCK_SPIKE",
    PROVIDER_HEALTH_DEGRADED: "PROVIDER_HEALTH_DEGRADED",
    WEBHOOK_FAILURE_SPIKE: "WEBHOOK_FAILURE_SPIKE",
    AI_USAGE_SPIKE: "AI_USAGE_SPIKE",
    CHURN_RISK: "CHURN_RISK",
    ONBOARDING_STALLED: "ONBOARDING_STALLED",
    DOMAIN_HEALTH_DEGRADED: "DOMAIN_HEALTH_DEGRADED",
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
  // Other enums imported by the service but unused in this test path.
  WalletRiskTier: {},
  WhatsAppProviderKey: {},
  ComplianceVerdict: {},
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

// queue stubs (Worker / queue connection imported at module top)
vi.mock("../lib/queue", () => ({
  getPlatformMonitorQueue: vi.fn(),
  getQueueConnection: vi.fn(),
  QueueNames: { PLATFORM_MONITOR: "platform-monitor" },
  trackWorker: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Worker: class {},
}));

import { runPlatformMonitorSummary } from "./platformMonitor.service";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item_1",
  code: "WALLET_RISK_CRITICAL",
  severity: "URGENT",
  title: "Tenant X wallet critical",
  body: "0 credits, 2 days to zero",
  targetTenantId: "tenant_x",
  createdAt: new Date("2026-05-31T10:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPlatformMonitorSummary", () => {
  it("returns the empty-queue fallback when there are no open items", async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.source).toBe("fallback");
    expect(result.totalOpen).toBe(0);
    expect(result.headline).toMatch(/clean/i);
    expect(result.actions).toEqual([]);
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("aggregates totals + byCode from open items", async () => {
    mocks.findMany.mockResolvedValue([
      item({ id: "a", severity: "URGENT", code: "WALLET_RISK_CRITICAL" }),
      item({ id: "b", severity: "HIGH", code: "WEBHOOK_FAILURE_SPIKE" }),
      item({ id: "c", severity: "HIGH", code: "WEBHOOK_FAILURE_SPIKE" }),
      item({ id: "d", severity: "MEDIUM", code: "COMPLIANCE_BLOCK_SPIKE" }),
    ]);
    mocks.runTenantLlmJson.mockResolvedValue({
      headline: "Two webhooks down, one wallet critical.",
      actions: [{ title: "Triage urgent wallet", rationale: "blocking sends", itemIds: ["a"] }],
    });

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.totals).toEqual({ URGENT: 1, HIGH: 2, MEDIUM: 1, LOW: 0 });
    expect(result.byCode).toEqual({
      WALLET_RISK_CRITICAL: 1,
      WEBHOOK_FAILURE_SPIKE: 2,
      COMPLIANCE_BLOCK_SPIKE: 1,
    });
    expect(result.totalOpen).toBe(4);
  });

  it("uses LLM output when available and tags source: ai", async () => {
    mocks.findMany.mockResolvedValue([item()]);
    mocks.runTenantLlmJson.mockResolvedValue({
      headline: "One wallet critical — top up immediately.",
      actions: [
        { title: "Recharge tenant X", rationale: "0 credits", itemIds: ["item_1"] },
      ],
    });

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.source).toBe("ai");
    expect(result.headline).toContain("wallet critical");
    expect(result.actions[0].itemIds).toEqual(["item_1"]);
    expect(mocks.runTenantLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        feature: "platform_monitor_summary",
      }),
    );
  });

  it("filters out invented itemIds the model returned", async () => {
    mocks.findMany.mockResolvedValue([item({ id: "real_1" })]);
    mocks.runTenantLlmJson.mockResolvedValue({
      headline: "Hi",
      actions: [
        {
          title: "Mixed real/fake",
          rationale: "test",
          itemIds: ["real_1", "ghost_2", "fabricated_3"],
        },
      ],
    });

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.actions[0].itemIds).toEqual(["real_1"]);
  });

  it("falls back to deterministic when LLM throws", async () => {
    mocks.findMany.mockResolvedValue([
      item({ id: "x", severity: "URGENT" }),
      item({ id: "y", severity: "HIGH" }),
    ]);
    mocks.runTenantLlmJson.mockRejectedValue(new Error("no api key"));

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.source).toBe("fallback");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].itemIds).toEqual(["x"]);
    expect(result.actions[0].title).toContain("Triage");
  });

  it("falls back when LLM returns an empty headline + zero usable actions", async () => {
    mocks.findMany.mockResolvedValue([item()]);
    mocks.runTenantLlmJson.mockResolvedValue({
      headline: "  ",
      actions: [],
    });

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.source).toBe("fallback");
  });

  it("sorts worst-by-severity-then-most-recent into worstItems", async () => {
    const t = (mins: number) => new Date(`2026-05-31T${10 + mins}:00:00Z`);
    mocks.findMany.mockResolvedValue([
      item({ id: "med_old", severity: "MEDIUM", createdAt: t(0) }),
      item({ id: "high_new", severity: "HIGH", createdAt: t(2) }),
      item({ id: "urg_old", severity: "URGENT", createdAt: t(0) }),
      item({ id: "urg_new", severity: "URGENT", createdAt: t(3) }),
    ]);
    mocks.runTenantLlmJson.mockResolvedValue({});

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    const ids = result.worstItems.map((i) => i.id);
    expect(ids[0]).toBe("urg_new"); // URGENT, newer first
    expect(ids[1]).toBe("urg_old");
    expect(ids[2]).toBe("high_new");
    expect(ids[3]).toBe("med_old");
  });

  it("caps actions at 3 even when the LLM returns more", async () => {
    mocks.findMany.mockResolvedValue([
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c" }),
      item({ id: "d" }),
    ]);
    mocks.runTenantLlmJson.mockResolvedValue({
      headline: "Multi",
      actions: [
        { title: "1", rationale: "r1", itemIds: ["a"] },
        { title: "2", rationale: "r2", itemIds: ["b"] },
        { title: "3", rationale: "r3", itemIds: ["c"] },
        { title: "4", rationale: "r4", itemIds: ["d"] },
        { title: "5", rationale: "r5", itemIds: ["a", "b"] },
      ],
    });

    const result = await runPlatformMonitorSummary({ billToTenantId: "t1" });

    expect(result.actions).toHaveLength(3);
  });
});
