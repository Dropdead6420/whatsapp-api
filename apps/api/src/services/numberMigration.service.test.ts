import { describe, expect, it } from "vitest";
import {
  allowedNextStatuses,
  assertCanTransition,
  canTransition,
  isCancellable,
  isTerminal,
  nextActionLabel,
  timestampFieldForStatus,
} from "./numberMigration.service";

describe("isTerminal", () => {
  it("flags the four terminal states", () => {
    for (const s of ["NOT_ELIGIBLE", "COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(isTerminal(s)).toBe(true);
    }
  });
  it("non-terminal states are not terminal", () => {
    for (const s of [
      "PENDING_ELIGIBILITY",
      "ELIGIBLE",
      "OTP_REQUESTED",
      "OTP_VERIFIED",
      "MIGRATING",
    ] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe("canTransition — happy path", () => {
  it("walks the full migration sequence", () => {
    expect(canTransition("PENDING_ELIGIBILITY", "ELIGIBLE")).toBe(true);
    expect(canTransition("ELIGIBLE", "OTP_REQUESTED")).toBe(true);
    expect(canTransition("OTP_REQUESTED", "OTP_VERIFIED")).toBe(true);
    expect(canTransition("OTP_VERIFIED", "MIGRATING")).toBe(true);
    expect(canTransition("MIGRATING", "COMPLETED")).toBe(true);
  });
});

describe("canTransition — off-ramps", () => {
  it("PENDING_ELIGIBILITY can go NOT_ELIGIBLE", () => {
    expect(canTransition("PENDING_ELIGIBILITY", "NOT_ELIGIBLE")).toBe(true);
  });

  it("every non-terminal state can FAIL or CANCEL", () => {
    for (const s of [
      "PENDING_ELIGIBILITY",
      "ELIGIBLE",
      "OTP_REQUESTED",
      "OTP_VERIFIED",
      "MIGRATING",
    ] as const) {
      expect(canTransition(s, "FAILED")).toBe(true);
      expect(canTransition(s, "CANCELLED")).toBe(true);
    }
  });

  it("NOT_ELIGIBLE is only reachable from PENDING_ELIGIBILITY", () => {
    expect(canTransition("ELIGIBLE", "NOT_ELIGIBLE")).toBe(false);
    expect(canTransition("OTP_VERIFIED", "NOT_ELIGIBLE")).toBe(false);
  });
});

describe("canTransition — illegal moves", () => {
  it("self-transitions are forbidden (incl. OTP resend)", () => {
    for (const s of [
      "PENDING_ELIGIBILITY",
      "OTP_REQUESTED",
      "MIGRATING",
      "COMPLETED",
    ] as const) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("cannot skip steps (ELIGIBLE → MIGRATING)", () => {
    expect(canTransition("ELIGIBLE", "MIGRATING")).toBe(false);
    expect(canTransition("PENDING_ELIGIBILITY", "OTP_REQUESTED")).toBe(false);
  });

  it("cannot move backwards (OTP_VERIFIED → OTP_REQUESTED)", () => {
    expect(canTransition("OTP_VERIFIED", "OTP_REQUESTED")).toBe(false);
  });

  it("terminal states go nowhere", () => {
    for (const s of ["NOT_ELIGIBLE", "COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(allowedNextStatuses(s)).toEqual([]);
      expect(canTransition(s, "MIGRATING")).toBe(false);
    }
  });
});

describe("assertCanTransition", () => {
  it("throws on an illegal transition", () => {
    expect(() => assertCanTransition("COMPLETED", "MIGRATING")).toThrow(
      /transition/i,
    );
  });
  it("does not throw on a legal one", () => {
    expect(() => assertCanTransition("ELIGIBLE", "OTP_REQUESTED")).not.toThrow();
  });
});

describe("nextActionLabel", () => {
  it("gives an action for each live state", () => {
    expect(nextActionLabel("ELIGIBLE")).toMatch(/request/i);
    expect(nextActionLabel("OTP_REQUESTED")).toMatch(/code/i);
    expect(nextActionLabel("OTP_VERIFIED")).toMatch(/start/i);
  });
  it("returns null for terminal states", () => {
    for (const s of ["COMPLETED", "FAILED", "CANCELLED", "NOT_ELIGIBLE"] as const) {
      expect(nextActionLabel(s)).toBeNull();
    }
  });
});

describe("timestampFieldForStatus", () => {
  it("maps states to their stamp column", () => {
    expect(timestampFieldForStatus("ELIGIBLE")).toBe("eligibilityCheckedAt");
    expect(timestampFieldForStatus("NOT_ELIGIBLE")).toBe("eligibilityCheckedAt");
    expect(timestampFieldForStatus("OTP_REQUESTED")).toBe("otpRequestedAt");
    expect(timestampFieldForStatus("OTP_VERIFIED")).toBe("otpVerifiedAt");
    expect(timestampFieldForStatus("COMPLETED")).toBe("completedAt");
  });
  it("returns null for states without a dedicated stamp", () => {
    expect(timestampFieldForStatus("PENDING_ELIGIBILITY")).toBeNull();
    expect(timestampFieldForStatus("MIGRATING")).toBeNull();
    expect(timestampFieldForStatus("FAILED")).toBeNull();
    expect(timestampFieldForStatus("CANCELLED")).toBeNull();
  });
});

describe("isCancellable", () => {
  it("non-terminal = cancellable, terminal = not", () => {
    expect(isCancellable("OTP_REQUESTED")).toBe(true);
    expect(isCancellable("MIGRATING")).toBe(true);
    expect(isCancellable("COMPLETED")).toBe(false);
    expect(isCancellable("CANCELLED")).toBe(false);
  });
});
