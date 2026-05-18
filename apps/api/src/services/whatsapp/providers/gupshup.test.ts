import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-005c — verify Gupshup adapter speaks the right wire format. We
// mock global fetch so the tests run without a live Gupshup account.

describe("gupshupProvider", () => {
  const originalFetch = global.fetch;
  const env = process.env;
  const fetchMock = vi.fn();

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env = {
      ...env,
      GUPSHUP_API_KEY: "sk_test_gupshup",
      GUPSHUP_APP_NAME: "NexaFlowDev",
      GUPSHUP_SOURCE: "15551234567",
    };
    fetchMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  function okResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("sends text via the wa/api/v1/msg endpoint with the correct form fields", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ status: "submitted", messageId: "gs-123" }),
    );

    const { gupshupProvider } = await import("./gupshup");
    const result = await gupshupProvider.sendText({
      phoneNumberId: "ignored-by-gupshup",
      accessToken: "ignored-by-gupshup",
      to: "919999999999",
      body: "Hello there",
    });

    expect(result.providerMessageId).toBe("gs-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.gupshup.io/wa/api/v1/msg");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      apikey: "sk_test_gupshup",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("channel")).toBe("whatsapp");
    expect(form.get("source")).toBe("15551234567");
    expect(form.get("destination")).toBe("919999999999");
    expect(form.get("src.name")).toBe("NexaFlowDev");
    const message = JSON.parse(form.get("message")!);
    expect(message).toEqual({ type: "text", text: "Hello there" });
  });

  it("sends template via /template/msg with the params shape Gupshup expects", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ status: "submitted", messageId: "gs-tpl-7" }),
    );

    const { gupshupProvider } = await import("./gupshup");
    const result = await gupshupProvider.sendTemplate({
      phoneNumberId: "ignored",
      accessToken: "ignored",
      to: "919999999999",
      templateName: "appointment_reminder",
      languageCode: "en_US",
      bodyParams: ["Sid", "Friday 3pm"],
    });

    expect(result.providerMessageId).toBe("gs-tpl-7");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.gupshup.io/wa/api/v1/template/msg");
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("destination")).toBe("919999999999");
    const tpl = JSON.parse(form.get("template")!);
    expect(tpl).toEqual({
      id: "appointment_reminder",
      params: ["Sid", "Friday 3pm"],
    });
  });

  it("throws a clean ApiError when Gupshup responds with status=error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ status: "error", message: "Quota exceeded" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { gupshupProvider } = await import("./gupshup");
    await expect(
      gupshupProvider.sendText({
        phoneNumberId: "n/a",
        accessToken: "n/a",
        to: "919999999999",
        body: "hi",
      }),
    ).rejects.toMatchObject({ statusCode: 200, message: /Quota exceeded/ });
  });

  it("refuses to send when GUPSHUP_API_KEY etc. are missing", async () => {
    delete process.env.GUPSHUP_API_KEY;

    const { gupshupProvider } = await import("./gupshup");
    await expect(
      gupshupProvider.sendText({
        phoneNumberId: "n/a",
        accessToken: "n/a",
        to: "919999999999",
        body: "hi",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /Gupshup adapter is not configured/,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers ctx.config over env vars (T-005d)", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ status: "submitted", messageId: "gs-ctx-1" }),
    );
    // Env says one thing — context overrides with per-tenant credentials.
    process.env.GUPSHUP_API_KEY = "sk_env_default";
    process.env.GUPSHUP_APP_NAME = "EnvDefaultApp";
    process.env.GUPSHUP_SOURCE = "10000000000";

    const { gupshupProvider } = await import("./gupshup");
    await gupshupProvider.sendText(
      {
        phoneNumberId: "n/a",
        accessToken: "n/a",
        to: "919999999999",
        body: "tenant-specific creds",
      },
      {
        config: {
          apiKey: "sk_tenant_abc",
          appName: "TenantAbcApp",
          source: "919876543210",
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ apikey: "sk_tenant_abc" });
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("source")).toBe("919876543210"); // ctx value, not env
    expect(form.get("src.name")).toBe("TenantAbcApp");
  });

  it("falls through to env when ctx.config is missing required fields", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ status: "submitted", messageId: "gs-fallback-1" }),
    );

    const { gupshupProvider } = await import("./gupshup");
    await gupshupProvider.sendText(
      {
        phoneNumberId: "n/a",
        accessToken: "n/a",
        to: "919999999999",
        body: "partial ctx",
      },
      { config: { apiKey: "" /* incomplete */ } }, // missing appName + source
    );

    // Env values were used because ctx was incomplete.
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ apikey: "sk_test_gupshup" });
    const form = new URLSearchParams(init?.body as string);
    expect(form.get("source")).toBe("15551234567");
    expect(form.get("src.name")).toBe("NexaFlowDev");
  });
});
