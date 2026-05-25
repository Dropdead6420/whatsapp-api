import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  contactCount: vi.fn(),
  aiAgentCount: vi.fn(),
  messageCount: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    contact: { count: mocks.contactCount },
    aiAgent: { count: mocks.aiAgentCount },
    message: { count: mocks.messageCount },
  },
}));

import { getOnboardingStatus } from "./onboarding.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOnboardingStatus", () => {
  it("returns all-incomplete for a fresh tenant", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: null,
      wabaPhoneNumber: null,
    });
    mocks.contactCount.mockResolvedValue(0);
    mocks.aiAgentCount.mockResolvedValue(0);
    mocks.messageCount.mockResolvedValue(0);

    const status = await getOnboardingStatus("tenant_1");

    expect(status.totalSteps).toBe(4);
    expect(status.completedSteps).toBe(0);
    expect(status.completed).toBe(false);
    expect(status.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    // Each step has a "Connect / Add / Create" CTA in the incomplete state
    expect(status.steps[0].ctaLabel).toBe("Connect now");
    expect(status.steps[1].ctaLabel).toBe("Add contacts");
    expect(status.steps[2].ctaLabel).toBe("Create agent");
    // Detail copy doesn't claim things that didn't happen
    expect(status.steps[1].detail).toBeNull();
    expect(status.steps[2].detail).toBeNull();
    expect(status.steps[3].detail).toBeNull();
  });

  it("WhatsApp is done only when BOTH token AND phone number are set", async () => {
    mocks.contactCount.mockResolvedValue(0);
    mocks.aiAgentCount.mockResolvedValue(0);
    mocks.messageCount.mockResolvedValue(0);

    // Token but no phone -> not done
    mocks.tenantFindUnique.mockResolvedValueOnce({
      wabaAccessToken: "tok",
      wabaPhoneNumber: null,
    });
    let status = await getOnboardingStatus("tenant_1");
    expect(status.steps[0].done).toBe(false);

    // Phone but no token -> not done
    mocks.tenantFindUnique.mockResolvedValueOnce({
      wabaAccessToken: null,
      wabaPhoneNumber: "123",
    });
    status = await getOnboardingStatus("tenant_1");
    expect(status.steps[0].done).toBe(false);

    // Both -> done
    mocks.tenantFindUnique.mockResolvedValueOnce({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    status = await getOnboardingStatus("tenant_1");
    expect(status.steps[0].done).toBe(true);
    expect(status.steps[0].detail).toBe("Connection active");
  });

  it("contacts step done with proper pluralization", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    mocks.aiAgentCount.mockResolvedValue(0);
    mocks.messageCount.mockResolvedValue(0);

    mocks.contactCount.mockResolvedValueOnce(1);
    let status = await getOnboardingStatus("tenant_1");
    expect(status.steps[1].done).toBe(true);
    expect(status.steps[1].detail).toBe("1 contact in your CRM");

    mocks.contactCount.mockResolvedValueOnce(2_500);
    status = await getOnboardingStatus("tenant_1");
    expect(status.steps[1].detail).toBe("2,500 contacts in your CRM");
  });

  it("agent step counts ACTIVE only — DRAFT/DISABLED/ARCHIVED don't count", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    mocks.contactCount.mockResolvedValue(10);
    mocks.messageCount.mockResolvedValue(0);
    mocks.aiAgentCount.mockResolvedValue(2);

    const status = await getOnboardingStatus("tenant_1");

    // Verify the where clause filters to status: ACTIVE
    expect(mocks.aiAgentCount).toHaveBeenCalledWith({
      where: { tenantId: "tenant_1", status: "ACTIVE" },
    });
    expect(status.steps[2].done).toBe(true);
    expect(status.steps[2].detail).toBe("2 ACTIVE agents");
  });

  it("send_message step counts OUTBOUND messages via the conversation join", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    mocks.contactCount.mockResolvedValue(10);
    mocks.aiAgentCount.mockResolvedValue(1);
    mocks.messageCount.mockResolvedValue(42);

    const status = await getOnboardingStatus("tenant_1");

    const whereArg = mocks.messageCount.mock.calls[0][0].where;
    expect(whereArg.conversation).toEqual({ tenantId: "tenant_1" });
    expect(whereArg.direction).toBe("OUTBOUND");
    expect(status.steps[3].done).toBe(true);
    expect(status.steps[3].detail).toBe("42 outbound messages sent");
  });

  it("returns completed=true and all steps done when every check passes", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    mocks.contactCount.mockResolvedValue(100);
    mocks.aiAgentCount.mockResolvedValue(1);
    mocks.messageCount.mockResolvedValue(50);

    const status = await getOnboardingStatus("tenant_1");

    expect(status.completedSteps).toBe(4);
    expect(status.completed).toBe(true);
    expect(status.steps.every((s) => s.done)).toBe(true);
  });

  it("partial completion counts correctly", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaAccessToken: "tok",
      wabaPhoneNumber: "123",
    });
    mocks.contactCount.mockResolvedValue(10);
    mocks.aiAgentCount.mockResolvedValue(0); // no agent yet
    mocks.messageCount.mockResolvedValue(5); // sent some, no agent

    const status = await getOnboardingStatus("tenant_1");

    expect(status.completedSteps).toBe(3);
    expect(status.completed).toBe(false);
    expect(status.steps[0].done).toBe(true);
    expect(status.steps[1].done).toBe(true);
    expect(status.steps[2].done).toBe(false);
    expect(status.steps[3].done).toBe(true);
  });

  it("handles missing tenant gracefully (returns all-not-done)", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    mocks.contactCount.mockResolvedValue(0);
    mocks.aiAgentCount.mockResolvedValue(0);
    mocks.messageCount.mockResolvedValue(0);

    const status = await getOnboardingStatus("nonexistent");
    expect(status.steps[0].done).toBe(false);
    expect(status.completed).toBe(false);
  });
});
