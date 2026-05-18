import { afterEach, describe, expect, it } from "vitest";
import { getAiCostCredits } from "./billing.service";

describe("billing.service AI cost mapping", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the global AI call cost by default", () => {
    process.env.AI_CALL_COST_CREDITS = "3";
    delete process.env.AI_CALL_COST_CREDITS_CAMPAIGN_AUTOPILOT;

    expect(getAiCostCredits("campaign_autopilot")).toBe(3);
  });

  it("uses a per-feature AI cost override when configured", () => {
    process.env.AI_CALL_COST_CREDITS = "1";
    process.env.AI_CALL_COST_CREDITS_CAMPAIGN_AUTOPILOT = "7";

    expect(getAiCostCredits("campaign_autopilot")).toBe(7);
    expect(getAiCostCredits("reply_suggestions")).toBe(1);
  });

  it("falls back to one credit for invalid values", () => {
    process.env.AI_CALL_COST_CREDITS = "free";
    process.env.AI_CALL_COST_CREDITS_AI_SUMMARIZE = "-10";

    expect(getAiCostCredits("copywriting")).toBe(1);
    expect(getAiCostCredits("ai_summarize")).toBe(1);
  });
});
