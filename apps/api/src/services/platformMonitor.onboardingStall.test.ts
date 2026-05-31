import { describe, expect, it } from "vitest";
import { PlatformActionSeverity } from "@nexaflow/db";
import { classifyOnboardingStall } from "./platformMonitor.service";

describe("classifyOnboardingStall", () => {
  it("returns null when account is younger than 7 days", () => {
    // First-week effort spikes are common; don't escalate yet.
    const result = classifyOnboardingStall({
      accountAgeDays: 3,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null at exactly 6 days (boundary)", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 6,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null when account is 30+ days old (CHURN_RISK owns this)", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 35,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null when fully onboarded regardless of age", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 14,
      completedSteps: 4,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns MEDIUM when 7-14 days old AND <= 1 step done", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 10,
      completedSteps: 1,
      totalSteps: 4,
    });
    expect(result.severity).toBe(PlatformActionSeverity.MEDIUM);
  });

  it("returns MEDIUM at 0 steps after 7 days", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 8,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBe(PlatformActionSeverity.MEDIUM);
  });

  it("does NOT escalate a 7-14 day tenant with 2+ steps (decent progress)", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 10,
      completedSteps: 2,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns HIGH when 14-30 days old AND <= 2 steps done", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 20,
      completedSteps: 2,
      totalSteps: 4,
    });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
  });

  it("returns HIGH at the boundary day 14", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 14,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
  });

  it("does NOT escalate a 14-30 day tenant with 3 steps (one to go, still progressing)", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 25,
      completedSteps: 3,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null at exactly 30 days (boundary, CHURN_RISK territory)", () => {
    const result = classifyOnboardingStall({
      accountAgeDays: 30,
      completedSteps: 0,
      totalSteps: 4,
    });
    expect(result.severity).toBeNull();
  });
});
