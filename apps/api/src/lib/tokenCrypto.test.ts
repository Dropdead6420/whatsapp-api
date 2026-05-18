import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptToken,
  decryptTokenIfNeeded,
  encryptToken,
  isEncryptedToken,
} from "./tokenCrypto";

describe("tokenCrypto", () => {
  const originalKek = process.env.TENANT_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TENANT_TOKEN_ENCRYPTION_KEY =
      "test-kek-with-enough-entropy-for-hkdf-12345";
  });
  afterEach(() => {
    if (originalKek === undefined) {
      delete process.env.TENANT_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TENANT_TOKEN_ENCRYPTION_KEY = originalKek;
    }
  });

  it("round-trips a token through envelope encryption", () => {
    const plaintext = "EAAB123_long_meta_access_token_with_dots.and_dashes-456";
    const enc = encryptToken(plaintext);
    expect(isEncryptedToken(enc)).toBe(true);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(plaintext);
    expect(decryptToken(enc)).toBe(plaintext);
  });

  it("each encryption produces a different ciphertext (random DEK + IVs)", () => {
    const a = encryptToken("the-same-token");
    const b = encryptToken("the-same-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("the-same-token");
    expect(decryptToken(b)).toBe("the-same-token");
  });

  it("decryptTokenIfNeeded passes plaintext through untouched", () => {
    expect(decryptTokenIfNeeded("legacy-plaintext-token")).toBe(
      "legacy-plaintext-token",
    );
    expect(decryptTokenIfNeeded(null)).toBeNull();
    expect(decryptTokenIfNeeded(undefined)).toBeNull();
  });

  it("decryption fails when the KEK changes", () => {
    const enc = encryptToken("secret");
    process.env.TENANT_TOKEN_ENCRYPTION_KEY = "a-completely-different-kek-value";
    expect(() => decryptToken(enc)).toThrow();
  });
});
