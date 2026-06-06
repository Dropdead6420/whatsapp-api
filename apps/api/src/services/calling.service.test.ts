import { describe, expect, it } from "vitest";
import { CallDirection, CallStatus } from "@nexaflow/db";
import {
  buildCallSummary,
  formatCallDuration,
  toSafeCallLog,
} from "./calling.service";

describe("formatCallDuration", () => {
  it("formats minutes:seconds", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(9)).toBe("0:09");
    expect(formatCallDuration(90)).toBe("1:30");
  });
  it("formats hours:minutes:seconds past an hour", () => {
    expect(formatCallDuration(3661)).toBe("1:01:01");
  });
  it("clamps negative / garbage to 0:00", () => {
    expect(formatCallDuration(-5)).toBe("0:00");
    expect(formatCallDuration(NaN)).toBe("0:00");
  });
});

describe("buildCallSummary", () => {
  it("describes an outbound completed call", () => {
    const s = buildCallSummary({
      direction: CallDirection.OUTBOUND,
      status: CallStatus.COMPLETED,
      durationSeconds: 200,
      party: "Riya",
    });
    expect(s).toBe("Outbound call to Riya — 3:20, completed.");
  });
  it("humanizes underscored statuses and inbound direction", () => {
    const s = buildCallSummary({
      direction: CallDirection.INBOUND,
      status: CallStatus.NO_ANSWER,
      durationSeconds: 0,
      party: "+1555",
    });
    expect(s).toContain("Inbound call from +1555");
    expect(s).toContain("no answer");
  });
  it("appends the first transcript line when present", () => {
    const s = buildCallSummary({
      direction: CallDirection.INBOUND,
      status: CallStatus.COMPLETED,
      durationSeconds: 60,
      party: "Sam",
      transcript: "Customer asked about pricing. Then we discussed delivery.",
    });
    expect(s).toContain("Customer asked about pricing");
  });
});

describe("toSafeCallLog", () => {
  it("adds a durationLabel", () => {
    const safe = toSafeCallLog({
      id: "c1",
      tenantId: "t1",
      contactId: null,
      direction: CallDirection.OUTBOUND,
      status: CallStatus.COMPLETED,
      fromNumber: "+1",
      toNumber: "+2",
      durationSeconds: 75,
      recordingUrl: null,
      transcript: null,
      aiSummary: null,
      startedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(safe.durationLabel).toBe("1:15");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
