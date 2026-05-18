import { beforeEach, describe, expect, it, vi } from "vitest";

// T-005b: prove the factory picks the right provider based on the
// ProviderRoute row, and falls back to Meta in the no-row + unknown-key
// cases. We mock @nexaflow/db so the tests don't need a live Postgres.

const mocks = vi.hoisted(() => ({
  routeFindFirst: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    providerRoute: {
      findFirst: mocks.routeFindFirst,
    },
  },
  WhatsAppProviderKey: {
    META: "META",
    GUPSHUP: "GUPSHUP",
    DIALOG_360: "DIALOG_360",
    TWILIO: "TWILIO",
    HAPTIK: "HAPTIK",
  },
}));

describe("whatsapp factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns Meta when no selector is given", async () => {
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider();
    expect(provider.key).toBe("meta");
    expect(mocks.routeFindFirst).not.toHaveBeenCalled();
  });

  it("returns Meta when the tenant has no ProviderRoute row", async () => {
    mocks.routeFindFirst.mockResolvedValue(null);
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    expect(provider.key).toBe("meta");
    // We only look up the default route (no phoneNumberId given).
    expect(mocks.routeFindFirst).toHaveBeenCalledTimes(1);
  });

  it("matches a phone-scoped route before the default route", async () => {
    // First lookup (phone-scoped) wins — default lookup never runs.
    mocks.routeFindFirst.mockResolvedValueOnce({
      tenantId: "t1",
      phoneNumberId: "PN-123",
      providerKey: "META",
      isActive: true,
    });
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({
      tenantId: "t1",
      phoneNumberId: "PN-123",
    });
    expect(provider.key).toBe("meta");
    expect(mocks.routeFindFirst).toHaveBeenCalledTimes(1);
  });

  it("falls back to Meta when the routed providerKey has no registered adapter", async () => {
    mocks.routeFindFirst.mockResolvedValue({
      tenantId: "t1",
      phoneNumberId: null,
      providerKey: "DIALOG_360", // not registered yet
      isActive: true,
    });
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    expect(provider.key).toBe("meta");
  });

  it("returns the Gupshup adapter when the route picks it", async () => {
    mocks.routeFindFirst.mockResolvedValue({
      tenantId: "t1",
      phoneNumberId: null,
      providerKey: "GUPSHUP",
      isActive: true,
    });
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    expect(provider.key).toBe("gupshup");
  });

  it("falls back to Meta when the ProviderRoute lookup throws", async () => {
    mocks.routeFindFirst.mockRejectedValue(new Error("db down"));
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    expect(provider.key).toBe("meta");
  });
});
