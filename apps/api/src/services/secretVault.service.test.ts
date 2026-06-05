import { describe, expect, it } from "vitest";
import { SecretScope } from "@nexaflow/db";
import { UserRole, ApiError } from "@nexaflow/shared";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import {
  captureLast4,
  deriveSecretContext,
  safeParseMetadata,
  toSafeSecret,
} from "./secretVault.service";

describe("deriveSecretContext", () => {
  it("maps SUPER_ADMIN to PLATFORM scope with no tenant", () => {
    expect(deriveSecretContext(UserRole.SUPER_ADMIN, "platform-tenant")).toEqual({
      scope: SecretScope.PLATFORM,
      tenantId: null,
    });
  });

  it("maps WHITE_LABEL_ADMIN to PARTNER scope with their tenant", () => {
    expect(deriveSecretContext(UserRole.WHITE_LABEL_ADMIN, "p1")).toEqual({
      scope: SecretScope.PARTNER,
      tenantId: "p1",
    });
  });

  it("maps BUSINESS_ADMIN to CUSTOMER scope with their tenant", () => {
    expect(deriveSecretContext(UserRole.BUSINESS_ADMIN, "c1")).toEqual({
      scope: SecretScope.CUSTOMER,
      tenantId: "c1",
    });
  });

  it("rejects a partner/customer without a tenant", () => {
    expect(() => deriveSecretContext(UserRole.WHITE_LABEL_ADMIN, null)).toThrow(
      ApiError,
    );
    expect(() => deriveSecretContext(UserRole.BUSINESS_ADMIN, undefined)).toThrow(
      ApiError,
    );
  });

  it("rejects roles that may not use the vault", () => {
    expect(() => deriveSecretContext(UserRole.AGENT, "c1")).toThrow(ApiError);
    expect(() => deriveSecretContext(undefined, "c1")).toThrow(ApiError);
  });
});

describe("captureLast4", () => {
  it("returns the last 4 characters", () => {
    expect(captureLast4("sk-abcdEFGH1234")).toBe("1234");
  });
  it("returns the whole value when shorter than 4", () => {
    expect(captureLast4("ab")).toBe("ab");
  });
  it("returns null for empty / whitespace", () => {
    expect(captureLast4("")).toBeNull();
    expect(captureLast4("   ")).toBeNull();
  });
});

describe("safeParseMetadata", () => {
  it("parses JSON objects", () => {
    expect(safeParseMetadata('{"keyId":"abc"}')).toEqual({ keyId: "abc" });
  });
  it("falls back to the raw string for non-JSON", () => {
    expect(safeParseMetadata("not-json")).toBe("not-json");
  });
  it("returns null for null", () => {
    expect(safeParseMetadata(null)).toBeNull();
  });
});

describe("toSafeSecret", () => {
  const row = {
    id: "s1",
    scope: SecretScope.CUSTOMER,
    tenantId: "c1",
    provider: "OPENAI" as const,
    label: "Prod OpenAI",
    last4: "1234",
    metadata: '{"org":"acme"}',
    status: "ACTIVE" as const,
    lastRotatedAt: null,
    lastTestedAt: null,
    lastTestOk: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  it("exposes the masked last4 + parsed metadata", () => {
    const safe = toSafeSecret(row);
    expect(safe.last4).toBe("1234");
    expect(safe.metadata).toEqual({ org: "acme" });
    expect(safe.label).toBe("Prod OpenAI");
  });

  it("never leaks ciphertext", () => {
    // Even if a row carries ciphertext, the safe view must drop it.
    const withCipher = { ...row, ciphertext: encryptToken("super-secret") };
    const safe = toSafeSecret(withCipher);
    expect((safe as Record<string, unknown>).ciphertext).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("super-secret");
  });
});

describe("envelope crypto round-trip (vault storage)", () => {
  it("encrypts then decrypts back to the original", () => {
    const plain = "nxf_live_sk-1234567890";
    const blob = encryptToken(plain);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(plain);
    expect(decryptToken(blob)).toBe(plain);
  });
});
