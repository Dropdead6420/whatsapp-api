import { describe, expect, it } from "vitest";
import { ApiError } from "@nexaflow/shared";
import {
  normalizeCapabilities,
  normalizePhone,
  toSafeNumber,
} from "./virtualNumber.service";

describe("normalizePhone", () => {
  it("strips formatting and accepts E.164", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects non-E.164 input", () => {
    expect(() => normalizePhone("4155552671")).toThrow(ApiError); // no +
    expect(() => normalizePhone("+0123")).toThrow(ApiError); // leading 0 + too short
    expect(() => normalizePhone("not a phone")).toThrow(ApiError);
  });
});

describe("normalizeCapabilities", () => {
  it("keeps known capabilities, lowercased + de-duplicated", () => {
    expect(normalizeCapabilities(["Voice", "sms", "VOICE", "whatsapp"])).toEqual([
      "voice",
      "sms",
      "whatsapp",
    ]);
  });
  it("drops unknown values and non-arrays", () => {
    expect(normalizeCapabilities(["fax", "voice"])).toEqual(["voice"]);
    expect(normalizeCapabilities("voice")).toEqual([]);
    expect(normalizeCapabilities(undefined)).toEqual([]);
  });
});

describe("toSafeNumber", () => {
  it("exposes hasCredential, never the secretId", () => {
    const row = {
      id: "n1",
      tenantId: "t1",
      phoneNumber: "+14155552671",
      label: "Sales",
      countryCode: "US",
      provider: "twilio",
      capabilities: ["voice", "sms"],
      secretId: "sv_1",
      status: "ACTIVE" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const safe = toSafeNumber(row);
    expect(safe.hasCredential).toBe(true);
    expect((safe as Record<string, unknown>).secretId).toBeUndefined();
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
    expect(safe.capabilities).toEqual(["voice", "sms"]);
  });
});
