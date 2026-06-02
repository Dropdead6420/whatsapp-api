import { describe, expect, it } from "vitest";
import { decodeJwtPayload, isImpersonating } from "./jwtDecode";

function encodePayload(payload: Record<string, unknown>): string {
  // Hand-build a fake JWT: header.payload.signature. Signature is
  // garbage — the decoder doesn't verify, that's the server's job.
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signaturegarbage`;
}

describe("decodeJwtPayload", () => {
  it("returns null on falsy input", () => {
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("returns null on non-string input (defense in depth)", () => {
    expect(decodeJwtPayload(123 as unknown as string)).toBeNull();
  });

  it("returns null when the token doesn't have 3 segments", () => {
    expect(decodeJwtPayload("header.payload")).toBeNull();
    expect(decodeJwtPayload("not-a-token")).toBeNull();
    expect(decodeJwtPayload("a.b.c.d")).toBeNull();
  });

  it("returns null when payload isn't valid base64", () => {
    expect(decodeJwtPayload("header.!!!!.sig")).toBeNull();
  });

  it("returns null when payload isn't JSON", () => {
    const notJson = Buffer.from("not json at all").toString("base64url");
    expect(decodeJwtPayload(`header.${notJson}.sig`)).toBeNull();
  });

  it("returns null when payload is a JSON primitive (not an object)", () => {
    const numberToken = Buffer.from("42").toString("base64url");
    expect(decodeJwtPayload(`header.${numberToken}.sig`)).toBeNull();
    const nullToken = Buffer.from("null").toString("base64url");
    expect(decodeJwtPayload(`header.${nullToken}.sig`)).toBeNull();
  });

  it("decodes a well-formed payload", () => {
    const token = encodePayload({
      userId: "u_42",
      role: "BUSINESS_ADMIN",
      tenantId: "t_1",
    });
    expect(decodeJwtPayload(token)).toMatchObject({
      userId: "u_42",
      role: "BUSINESS_ADMIN",
      tenantId: "t_1",
    });
  });

  it("preserves all claims including the impersonation pair", () => {
    const token = encodePayload({
      userId: "target_42",
      role: "BUSINESS_ADMIN",
      tenantId: "t_1",
      actorUserId: "admin_99",
      actorRole: "SUPER_ADMIN",
    });
    const decoded = decodeJwtPayload(token);
    expect(decoded?.actorUserId).toBe("admin_99");
    expect(decoded?.actorRole).toBe("SUPER_ADMIN");
  });
});

describe("isImpersonating", () => {
  it("returns false for an empty / invalid token", () => {
    expect(isImpersonating(null)).toBe(false);
    expect(isImpersonating(undefined)).toBe(false);
    expect(isImpersonating("garbage")).toBe(false);
  });

  it("returns false when the token has no actor claim", () => {
    const token = encodePayload({ userId: "u", role: "BUSINESS_ADMIN" });
    expect(isImpersonating(token)).toBe(false);
  });

  it("returns true when the token carries an actorUserId", () => {
    const token = encodePayload({
      userId: "target",
      actorUserId: "admin",
    });
    expect(isImpersonating(token)).toBe(true);
  });

  it("returns false when actorUserId is empty string (truthy check)", () => {
    const token = encodePayload({ userId: "target", actorUserId: "" });
    expect(isImpersonating(token)).toBe(false);
  });
});
