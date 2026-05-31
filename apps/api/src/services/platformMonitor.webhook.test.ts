import { describe, expect, it } from "vitest";
import { PlatformActionSeverity } from "@nexaflow/db";
import { classifyWebhookHealth } from "./platformMonitor.service";

describe("classifyWebhookHealth", () => {
  it("returns null severity below the minimum volume gate", () => {
    expect(classifyWebhookHealth({ total: 5, failures: 5 })).toEqual({
      severity: null,
      shouldAutoDisable: false,
      rate: 0,
    });
  });

  it("returns null at exactly volume 9 even when fully failing", () => {
    expect(classifyWebhookHealth({ total: 9, failures: 9 })).toEqual({
      severity: null,
      shouldAutoDisable: false,
      rate: 0,
    });
  });

  it("returns null when failure rate is below 50%", () => {
    const result = classifyWebhookHealth({ total: 20, failures: 5 });
    expect(result.severity).toBeNull();
    expect(result.shouldAutoDisable).toBe(false);
  });

  it("returns HIGH at 50%+ failure rate", () => {
    const result = classifyWebhookHealth({ total: 10, failures: 5 });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
    expect(result.shouldAutoDisable).toBe(false);
    expect(result.rate).toBeCloseTo(0.5, 5);
  });

  it("returns URGENT at 80%+ failure rate, no auto-disable", () => {
    const result = classifyWebhookHealth({ total: 10, failures: 8 });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.shouldAutoDisable).toBe(false);
  });

  it("does NOT auto-disable at 95%+ if volume < 20", () => {
    const result = classifyWebhookHealth({ total: 15, failures: 15 });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.shouldAutoDisable).toBe(false);
  });

  it("auto-disables only at 95%+ failure AND volume >= 20", () => {
    const result = classifyWebhookHealth({ total: 20, failures: 19 });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.shouldAutoDisable).toBe(true);
    expect(result.rate).toBeCloseTo(0.95, 5);
  });

  it("auto-disables a 100%-failing 100-event stream", () => {
    const result = classifyWebhookHealth({ total: 100, failures: 100 });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.shouldAutoDisable).toBe(true);
    expect(result.rate).toBe(1);
  });

  it("does NOT auto-disable just because total >= 20 — rate gates everything", () => {
    // 60% failure: well above the auto-disable volume floor but well below
    // its rate floor. Should land HIGH, not URGENT, not auto-disabled.
    const result = classifyWebhookHealth({ total: 100, failures: 60 });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
    expect(result.shouldAutoDisable).toBe(false);
  });

  it("treats zero failures cleanly", () => {
    const result = classifyWebhookHealth({ total: 100, failures: 0 });
    expect(result.severity).toBeNull();
    expect(result.rate).toBe(0);
  });
});
