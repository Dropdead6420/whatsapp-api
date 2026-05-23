import { describe, it, expect } from "vitest";
import { assertSafeOutboundUrl } from "./ssrfGuard";

describe("assertSafeOutboundUrl", () => {
  it("allows public https URLs with literal IP", async () => {
    const url = await assertSafeOutboundUrl("https://93.184.216.34/hook");
    expect(url.hostname).toBe("93.184.216.34");
  });

  it("rejects localhost", async () => {
    await expect(assertSafeOutboundUrl("http://localhost:3000/hook")).rejects.toThrow(
      /not allowed/i,
    );
  });

  it("rejects private IPv4 literals", async () => {
    await expect(assertSafeOutboundUrl("http://192.168.1.1/hook")).rejects.toThrow(
      /private/i,
    );
  });

  it("rejects file scheme", async () => {
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
  });
});
