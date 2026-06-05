import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateSecret,
  totp,
  verifyTotp,
} from "./twoFactor.service";

// RFC 6238 reference secret: ASCII "12345678901234567890" (20 bytes).
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("decodes the RFC secret to the ASCII bytes", () => {
    expect(base32Decode(RFC_SECRET_B32).toString("utf8")).toBe(
      "12345678901234567890",
    );
  });
  it("round-trips arbitrary bytes", () => {
    const buf = Buffer.from("the quick brown fox");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
  it("is case-insensitive and ignores padding/spaces", () => {
    const a = base32Decode(RFC_SECRET_B32);
    const b = base32Decode(RFC_SECRET_B32.toLowerCase() + "===");
    expect(a.equals(b)).toBe(true);
  });
});

describe("totp (RFC 6238 SHA1 vectors, 6-digit)", () => {
  // 8-digit RFC codes truncated to the trailing 6 digits.
  const cases: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [time, code] of cases) {
    it(`T=${time} → ${code}`, () => {
      expect(totp(RFC_SECRET_B32, time)).toBe(code);
    });
  }
});

describe("verifyTotp", () => {
  it("accepts the current code", () => {
    expect(verifyTotp(RFC_SECRET_B32, "287082", 59, 1)).toBe(true);
  });
  it("tolerates one step of drift", () => {
    // 30s later still within ±1 window.
    expect(verifyTotp(RFC_SECRET_B32, "287082", 89, 1)).toBe(true);
  });
  it("rejects beyond the window", () => {
    expect(verifyTotp(RFC_SECRET_B32, "287082", 119, 1)).toBe(false);
  });
  it("rejects malformed tokens", () => {
    expect(verifyTotp(RFC_SECRET_B32, "12345", 59)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "abcdef", 59)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "", 59)).toBe(false);
  });
  it("rejects a wrong-but-valid-shape code", () => {
    expect(verifyTotp(RFC_SECRET_B32, "000000", 59, 1)).toBe(false);
  });
});

describe("generateSecret + otpauth", () => {
  it("produces a decodable base32 secret of ~32 chars (20 bytes)", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(s).length).toBe(20);
  });
  it("builds a scannable otpauth URL", () => {
    const url = buildOtpauthUrl("ABC234", "user@acme.com", "NexaFlow");
    expect(url.startsWith("otpauth://totp/NexaFlow:user%40acme.com?")).toBe(true);
    expect(url).toContain("secret=ABC234");
    expect(url).toContain("issuer=NexaFlow");
    expect(url).toContain("digits=6");
    expect(url).toContain("period=30");
  });
});
