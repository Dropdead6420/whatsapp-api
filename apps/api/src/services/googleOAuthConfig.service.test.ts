import { describe, expect, it } from "vitest";
import { normalizeGoogleConfigInput } from "./googleOAuthConfig.service";

describe("normalizeGoogleConfigInput", () => {
  it("trims client id / redirect / scope and coerces enabled", () => {
    expect(
      normalizeGoogleConfigInput({
        clientId: "  abc.apps.googleusercontent.com  ",
        redirectUri: "  https://x/callback  ",
        scope: "  https://www.googleapis.com/auth/business.manage  ",
        enabled: true,
      }),
    ).toEqual({
      clientId: "abc.apps.googleusercontent.com",
      redirectUri: "https://x/callback",
      scope: "https://www.googleapis.com/auth/business.manage",
      enabled: true,
    });
  });

  it("defaults a blank/missing scope to business.manage and enabled to false", () => {
    expect(normalizeGoogleConfigInput({ clientId: "id" })).toEqual({
      clientId: "id",
      redirectUri: "",
      scope: "https://www.googleapis.com/auth/business.manage",
      enabled: false,
    });
    expect(normalizeGoogleConfigInput({ scope: "   " }).scope).toBe("https://www.googleapis.com/auth/business.manage");
  });

  it("does not echo the client secret (handled separately, encrypted)", () => {
    const out = normalizeGoogleConfigInput({ clientId: "id", clientSecret: "supersecret" } as never);
    expect(Object.values(out)).not.toContain("supersecret");
  });
});
