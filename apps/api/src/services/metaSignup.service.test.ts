import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-004 — exercise the Embedded Signup orchestrator with fetch mocked.
// The encryption + persist path uses the real tokenCrypto + a mocked
// prisma so we can assert the data we'd write without touching the DB.

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      update: mocks.tenantUpdate,
    },
  },
}));

describe("metaSignup.service", () => {
  const originalFetch = global.fetch;
  const env = process.env;
  const fetchMock = vi.fn();

  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env = {
      ...env,
      META_APP_ID: "test_app_id",
      META_APP_SECRET: "test_app_secret",
      TENANT_TOKEN_ENCRYPTION_KEY:
        "test-kek-with-enough-entropy-for-hkdf-12345",
    };
    fetchMock.mockReset();
    mocks.tenantFindUnique.mockReset();
    mocks.tenantUpdate.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  function jsonResponse(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("happy path: exchange → subscribe → persist encrypted token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "EAAlonglivedtoken_X1Y2Z3",
          token_type: "bearer",
          expires_in: 60 * 60 * 24 * 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.tenantUpdate.mockImplementation(async ({ data }) => data);

    const { completeEmbeddedSignup } = await import("./metaSignup.service");
    const result = await completeEmbeddedSignup({
      tenantId: "t_1",
      input: {
        code: "code_xyz",
        businessId: "biz_1",
        wabaId: "waba_2",
        phoneNumberId: "phone_3",
      },
    });

    expect(result).toMatchObject({
      tenantId: "t_1",
      metaBusinessId: "biz_1",
      wabaId: "waba_2",
      phoneNumberId: "phone_3",
      webhookSubscribed: true,
    });
    // Token preview never reveals more than first 6 + last 4 chars.
    expect(result.accessTokenPreview).toBe("EAAlon…Y2Z3");

    // The persisted access token is encrypted, never plain.
    const updateCall = mocks.tenantUpdate.mock.calls[0][0];
    expect(updateCall.data.wabaAccessToken).not.toContain("EAAlonglivedtoken");
    expect(updateCall.data.wabaAccessToken.startsWith("v1:")).toBe(true);
    expect(updateCall.data.metaBusinessId).toBe("biz_1");
    expect(updateCall.data.wabaId).toBe("waba_2");
    expect(updateCall.data.wabaPhoneNumber).toBe("phone_3");
  });

  it("refuses to start when META_APP_ID / META_APP_SECRET are placeholder values", async () => {
    process.env.META_APP_ID = "your_meta_app_id"; // .env.example placeholder
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });

    const { completeEmbeddedSignup } = await import("./metaSignup.service");
    await expect(
      completeEmbeddedSignup({
        tenantId: "t_1",
        input: {
          code: "code_xyz",
          businessId: "biz_1",
          wabaId: "waba_2",
          phoneNumberId: "phone_3",
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /Meta Embedded Signup is not configured/,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("bubbles Meta OAuth errors with the Meta-provided message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: {
          message: "Invalid verification code format.",
          type: "OAuthException",
        },
      }),
    );
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });

    const { completeEmbeddedSignup } = await import("./metaSignup.service");
    await expect(
      completeEmbeddedSignup({
        tenantId: "t_1",
        input: {
          code: "bad_code",
          businessId: "biz_1",
          wabaId: "waba_2",
          phoneNumberId: "phone_3",
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /Invalid verification code format/,
    });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("persists the token even when the subscribe step fails (operator can retry)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "EAA_okay_token_a1b2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(500, { error: { message: "internal" } }),
      );
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.tenantUpdate.mockImplementation(async ({ data }) => data);

    const { completeEmbeddedSignup } = await import("./metaSignup.service");
    const result = await completeEmbeddedSignup({
      tenantId: "t_1",
      input: {
        code: "code_xyz",
        businessId: "biz_1",
        wabaId: "waba_2",
        phoneNumberId: "phone_3",
      },
    });

    expect(result.webhookSubscribed).toBe(false);
    // Token still persisted (encrypted) so the operator only retries the
    // subscribe step, not the whole onboarding.
    const updateCall = mocks.tenantUpdate.mock.calls[0][0];
    expect(updateCall.data.wabaAccessToken.startsWith("v1:")).toBe(true);
  });

  it("rejects 404 when the tenant doesn't exist", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);

    const { completeEmbeddedSignup } = await import("./metaSignup.service");
    await expect(
      completeEmbeddedSignup({
        tenantId: "t_missing",
        input: {
          code: "code",
          businessId: "b",
          wabaId: "w",
          phoneNumberId: "p",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- syncWhatsAppBusinessProfile (T-004 follow-up) -------------------

  it("syncs business profile: phone-number verified_name wins over WABA name", async () => {
    fetchMock
      // first call: phone-number profile
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              about: "We sell artisanal coffee.",
              verified_name: "Cutz & Bangs Coffee",
              vertical: "Restaurant",
            },
          ],
        }),
      )
      // second call: WABA profile
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: "Cutz & Bangs LLC",
          vertical: "Other",
        }),
      );
    mocks.tenantFindUnique.mockResolvedValue({
      wabaId: "waba_2",
      wabaPhoneNumber: "phone_3",
      // valid envelope-encrypted token so decryptTokenIfNeeded round-trips.
      // simpler: store plaintext; decryptTokenIfNeeded passes it through.
      wabaAccessToken: "plain_token",
    });
    mocks.tenantUpdate.mockImplementation(async ({ data }) => data);

    const { syncWhatsAppBusinessProfile } = await import(
      "./metaSignup.service"
    );
    const result = await syncWhatsAppBusinessProfile({ tenantId: "t_1" });
    expect(result.name).toBe("Cutz & Bangs Coffee");
    expect(result.vertical).toBe("Restaurant");
    expect(result.about).toBe("We sell artisanal coffee.");

    const updateCall = mocks.tenantUpdate.mock.calls[0][0];
    expect(updateCall.data.wabaBusinessName).toBe("Cutz & Bangs Coffee");
    expect(updateCall.data.wabaBusinessVertical).toBe("Restaurant");
    expect(updateCall.data.wabaBusinessProfileSyncedAt).toBeInstanceOf(Date);
  });

  it("falls back to WABA name when phone-number verified_name is empty", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ about: "" }] }))
      .mockResolvedValueOnce(
        jsonResponse(200, { name: "Acme Corp", vertical: "Retail" }),
      );
    mocks.tenantFindUnique.mockResolvedValue({
      wabaId: "waba_2",
      wabaPhoneNumber: "phone_3",
      wabaAccessToken: "plain_token",
    });
    mocks.tenantUpdate.mockImplementation(async ({ data }) => data);

    const { syncWhatsAppBusinessProfile } = await import(
      "./metaSignup.service"
    );
    const result = await syncWhatsAppBusinessProfile({ tenantId: "t_1" });
    expect(result.name).toBe("Acme Corp");
    expect(result.vertical).toBe("Retail");
    expect(result.about).toBeNull();
  });

  it("rejects when WhatsApp isn't connected yet", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      wabaId: null,
      wabaPhoneNumber: null,
      wabaAccessToken: null,
    });

    const { syncWhatsAppBusinessProfile } = await import(
      "./metaSignup.service"
    );
    await expect(
      syncWhatsAppBusinessProfile({ tenantId: "t_1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /WhatsApp must be connected/,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Meta error messages from the phone-profile endpoint", async () => {
    // Both fetches run via Promise.all — mock both so only the first
    // rejects with the message we're asserting on.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(403, {
          error: { message: "Insufficient permissions on this WABA." },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { name: "ignored" }));
    mocks.tenantFindUnique.mockResolvedValue({
      wabaId: "waba_2",
      wabaPhoneNumber: "phone_3",
      wabaAccessToken: "plain_token",
    });

    const { syncWhatsAppBusinessProfile } = await import(
      "./metaSignup.service"
    );
    await expect(
      syncWhatsAppBusinessProfile({ tenantId: "t_1" }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: /Insufficient permissions/,
    });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });
});
