import { afterEach, describe, expect, it } from "vitest";
import { AI_FEATURE_ACTION, getAiCostCredits } from "./billing.service";
import { KNOWN_CREDIT_ACTIONS } from "./creditRule.service";

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

describe("AI_FEATURE_ACTION → Credit Engine catalog mapping", () => {
  const catalogActions = new Set(KNOWN_CREDIT_ACTIONS.map((a) => a.action));

  it("maps every GMB AI feature to a real, configurable catalog action", () => {
    // A mapping to a non-existent action would silently fall back to the
    // default cost forever — so each target must exist in the catalog.
    for (const [feature, action] of Object.entries(AI_FEATURE_ACTION)) {
      expect(catalogActions.has(action), `${feature} → ${action} missing from KNOWN_CREDIT_ACTIONS`).toBe(true);
    }
  });

  it("covers all seven GMB AI features", () => {
    expect(Object.keys(AI_FEATURE_ACTION).sort()).toEqual([
      "gmb_description_optimizer",
      "gmb_image_generation",
      "gmb_keyword_finder",
      "gmb_post_caption",
      "gmb_ranking_advisor",
      "gmb_report",
      "gmb_review_reply",
    ]);
  });
});
