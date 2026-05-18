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

  it("binds decrypted ProviderRoute.config into the adapter's ctx (T-005d)", async () => {
    // Stored config is plaintext JSON (decryptTokenIfNeeded passes legacy
    // plaintext through). Factory parses + binds it; the adapter then
    // reads ctx instead of process.env.
    mocks.routeFindFirst.mockResolvedValue({
      tenantId: "t1",
      phoneNumberId: null,
      providerKey: "GUPSHUP",
      isActive: true,
      config: JSON.stringify({
        apiKey: "sk_bound_test",
        appName: "BoundApp",
        source: "919999999999",
      }),
    });

    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    expect(provider.key).toBe("gupshup");

    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "submitted", messageId: "x1" }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    // Wipe env so a regression that ignores ctx fails loudly.
    const env = { ...process.env };
    delete process.env.GUPSHUP_API_KEY;
    delete process.env.GUPSHUP_APP_NAME;
    delete process.env.GUPSHUP_SOURCE;

    try {
      await provider.sendText({
        phoneNumberId: "n/a",
        accessToken: "n/a",
        to: "919999999999",
        body: "bound",
      });
      const [, init] = fetchMock.mock.calls[0];
      expect((init?.headers as Record<string, string>).apikey).toBe(
        "sk_bound_test",
      );
      const form = new URLSearchParams(init?.body as string);
      expect(form.get("src.name")).toBe("BoundApp");
      expect(form.get("source")).toBe("919999999999");
    } finally {
      global.fetch = originalFetch;
      process.env = env;
    }
  });

  it("falls back to env-only adapter behaviour when route.config is malformed JSON", async () => {
    mocks.routeFindFirst.mockResolvedValue({
      tenantId: "t1",
      phoneNumberId: null,
      providerKey: "GUPSHUP",
      isActive: true,
      config: "{ not valid json :(",
    });
    const { getWhatsAppProvider } = await import("./index");
    const provider = await getWhatsAppProvider({ tenantId: "t1" });
    // Still returns Gupshup — config-parse failure doesn't demote the
    // provider; the adapter just falls through to env at send time.
    expect(provider.key).toBe("gupshup");
  });
});
