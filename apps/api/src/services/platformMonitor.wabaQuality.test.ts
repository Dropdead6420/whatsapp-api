import { describe, expect, it } from "vitest";
import { classifyWabaQuality } from "./platformMonitor.service";

describe("classifyWabaQuality", () => {
  it("GREEN / CONNECTED → no item", () => {
    expect(
      classifyWabaQuality({ qualityRating: "GREEN", accountStatus: "CONNECTED" })
        .severity,
    ).toBeNull();
  });

  it("YELLOW rating → MEDIUM", () => {
    const c = classifyWabaQuality({ qualityRating: "YELLOW", accountStatus: "CONNECTED" });
    expect(c.severity).toBe("MEDIUM");
    expect(c.reason).toMatch(/yellow/i);
  });

  it("RED rating → HIGH", () => {
    const c = classifyWabaQuality({ qualityRating: "RED", accountStatus: "CONNECTED" });
    expect(c.severity).toBe("HIGH");
    expect(c.reason).toMatch(/red/i);
  });

  it("FLAGGED account → HIGH even with a GREEN rating", () => {
    const c = classifyWabaQuality({ qualityRating: "GREEN", accountStatus: "FLAGGED" });
    expect(c.severity).toBe("HIGH");
    expect(c.reason).toMatch(/flagged/i);
  });

  it("RESTRICTED account → URGENT", () => {
    expect(
      classifyWabaQuality({ qualityRating: "YELLOW", accountStatus: "RESTRICTED" })
        .severity,
    ).toBe("URGENT");
  });

  it("DISABLED account → URGENT (overrides rating)", () => {
    expect(
      classifyWabaQuality({ qualityRating: "RED", accountStatus: "DISABLED" })
        .severity,
    ).toBe("URGENT");
  });

  it("is case-insensitive", () => {
    expect(classifyWabaQuality({ qualityRating: "red" }).severity).toBe("HIGH");
    expect(classifyWabaQuality({ accountStatus: "disabled" }).severity).toBe(
      "URGENT",
    );
  });

  it("null / unknown / empty → no item (don't flag on missing data)", () => {
    expect(classifyWabaQuality({}).severity).toBeNull();
    expect(classifyWabaQuality({ qualityRating: null }).severity).toBeNull();
    expect(classifyWabaQuality({ qualityRating: "UNKNOWN" }).severity).toBeNull();
    expect(classifyWabaQuality({ qualityRating: "  " }).severity).toBeNull();
  });

  it("escalation order URGENT > HIGH > MEDIUM holds when signals combine", () => {
    // disabled (URGENT) beats red (HIGH)
    expect(
      classifyWabaQuality({ qualityRating: "RED", accountStatus: "DISABLED" }).severity,
    ).toBe("URGENT");
    // flagged (HIGH) beats yellow (MEDIUM)
    expect(
      classifyWabaQuality({ qualityRating: "YELLOW", accountStatus: "FLAGGED" }).severity,
    ).toBe("HIGH");
  });
});
