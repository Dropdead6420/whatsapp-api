import { beforeEach, describe, expect, it, vi } from "vitest";

// T-004 follow-up — scanWabaTokenExpiry needs to warn exactly once per
// cooldown window, send a TOKEN_EXPIRING webhook, and stamp the warn
// timestamp. We mock prisma + webhook emit so the test runs without DB
// or Redis.

const mocks = vi.hoisted(() => ({
  tenantFindMany: vi.fn(),
  tenantUpdate: vi.fn(),
  emitWebhookEvent: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: {
      findMany: mocks.tenantFindMany,
      update: mocks.tenantUpdate,
    },
  },
}));

vi.mock("./webhook.service", () => ({
  emitWebhookEvent: mocks.emitWebhookEvent,
}));

const NOW = new Date("2026-05-20T12:00:00.000Z");
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe("scanWabaTokenExpiry", () => {
  beforeEach(() => {
    mocks.tenantFindMany.mockReset();
    mocks.tenantUpdate.mockReset();
    mocks.emitWebhookEvent.mockReset();
    mocks.tenantUpdate.mockResolvedValue({});
  });

  it("warns tenants within the 14-day window and emits TOKEN_EXPIRING", async () => {
    // First call → tenants approaching expiry; second → already-expired.
    mocks.tenantFindMany
      .mockResolvedValueOnce([
        {
          id: "t_1",
          wabaTokenExpiresAt: inDays(10),
          wabaPhoneNumber: "phone_a",
        },
      ])
      .mockResolvedValueOnce([]);

    const { scanWabaTokenExpiry } = await import("./wabaTokenExpiry.service");
    const result = await scanWabaTokenExpiry(NOW);

    expect(result).toEqual({ warned: 1, expired: 0 });
    expect(mocks.tenantUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.tenantUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "t_1" });
    expect(updateArgs.data.wabaTokenExpiryWarnedAt).toBe(NOW);
    expect(updateArgs.data.wabaLastSyncError).toMatch(
      /expires in 10 day\(s\)/,
    );

    expect(mocks.emitWebhookEvent).toHaveBeenCalledTimes(1);
    const [tenantId, event, payload] = mocks.emitWebhookEvent.mock.calls[0];
    expect(tenantId).toBe("t_1");
    expect(event).toBe("TOKEN_EXPIRING");
    expect(payload).toMatchObject({
      tenantId: "t_1",
      phoneNumberId: "phone_a",
      daysUntilExpiry: 10,
      severity: "warning",
    });
  });

  it("marks ≤3 days as critical severity", async () => {
    mocks.tenantFindMany
      .mockResolvedValueOnce([
        {
          id: "t_2",
          wabaTokenExpiresAt: inDays(2),
          wabaPhoneNumber: "phone_b",
        },
      ])
      .mockResolvedValueOnce([]);

    const { scanWabaTokenExpiry } = await import("./wabaTokenExpiry.service");
    await scanWabaTokenExpiry(NOW);

    const payload = mocks.emitWebhookEvent.mock.calls[0][2];
    expect(payload.severity).toBe("critical");
  });

  it("flags already-expired tenants with severity=expired", async () => {
    mocks.tenantFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "t_3",
          wabaTokenExpiresAt: inDays(-1),
          wabaPhoneNumber: "phone_c",
        },
      ]);

    const { scanWabaTokenExpiry } = await import("./wabaTokenExpiry.service");
    const result = await scanWabaTokenExpiry(NOW);

    expect(result).toEqual({ warned: 0, expired: 1 });
    const updateArgs = mocks.tenantUpdate.mock.calls[0][0];
    expect(updateArgs.data.wabaLastSyncError).toMatch(/expired at/);
    const payload = mocks.emitWebhookEvent.mock.calls[0][2];
    expect(payload.severity).toBe("expired");
    expect(payload.daysUntilExpiry).toBe(0);
  });

  it("does nothing when no tenants are due", async () => {
    mocks.tenantFindMany.mockResolvedValue([]);
    const { scanWabaTokenExpiry } = await import("./wabaTokenExpiry.service");
    const result = await scanWabaTokenExpiry(NOW);
    expect(result).toEqual({ warned: 0, expired: 0 });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
    expect(mocks.emitWebhookEvent).not.toHaveBeenCalled();
  });
});
