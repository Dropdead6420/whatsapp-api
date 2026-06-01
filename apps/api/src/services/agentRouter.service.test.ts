import { describe, expect, it } from "vitest";
import { rankBestAgent } from "./agentRouter.service";

function agent(overrides: Partial<Parameters<typeof rankBestAgent>[0][number]> = {}) {
  return {
    userId: "u_default",
    name: "Default Agent",
    email: "default@example.com",
    openConversationCount: 5,
    tenureMs: 1_000_000,
    ...overrides,
  };
}

describe("rankBestAgent", () => {
  it("returns null on an empty pool", () => {
    expect(rankBestAgent([])).toBeNull();
  });

  it("returns the single agent unchanged when pool size = 1", () => {
    const only = agent({ userId: "alone", name: "Solo" });
    expect(rankBestAgent([only])).toBe(only);
  });

  it("picks the agent with the lowest open-conversation count", () => {
    const result = rankBestAgent([
      agent({ userId: "busy", openConversationCount: 10 }),
      agent({ userId: "free", openConversationCount: 1 }),
      agent({ userId: "medium", openConversationCount: 4 }),
    ]);
    expect(result?.userId).toBe("free");
  });

  it("ties on load → most senior (highest tenureMs) wins", () => {
    const result = rankBestAgent([
      agent({ userId: "junior", openConversationCount: 3, tenureMs: 100 }),
      agent({ userId: "senior", openConversationCount: 3, tenureMs: 1_000_000 }),
      agent({ userId: "midcareer", openConversationCount: 3, tenureMs: 5_000 }),
    ]);
    expect(result?.userId).toBe("senior");
  });

  it("ties on load + tenure → stable ordering by lowest userId", () => {
    const result = rankBestAgent([
      agent({ userId: "zeta", openConversationCount: 0, tenureMs: 100 }),
      agent({ userId: "alpha", openConversationCount: 0, tenureMs: 100 }),
      agent({ userId: "beta", openConversationCount: 0, tenureMs: 100 }),
    ]);
    expect(result?.userId).toBe("alpha");
  });

  it("load beats tenure (senior but overloaded loses)", () => {
    const result = rankBestAgent([
      agent({ userId: "senior_overloaded", openConversationCount: 20, tenureMs: 99_999_999 }),
      agent({ userId: "junior_free", openConversationCount: 2, tenureMs: 1 }),
    ]);
    expect(result?.userId).toBe("junior_free");
  });

  it("treats 0-load as the best (no false-tie with negative or NaN)", () => {
    const result = rankBestAgent([
      agent({ userId: "idle", openConversationCount: 0 }),
      agent({ userId: "one", openConversationCount: 1 }),
    ]);
    expect(result?.userId).toBe("idle");
  });

  it("does not mutate the input array", () => {
    const pool = [
      agent({ userId: "a", openConversationCount: 5 }),
      agent({ userId: "b", openConversationCount: 1 }),
      agent({ userId: "c", openConversationCount: 3 }),
    ];
    const snapshot = pool.map((p) => p.userId);
    rankBestAgent(pool);
    expect(pool.map((p) => p.userId)).toEqual(snapshot);
  });

  it("handles a large pool deterministically", () => {
    const pool = Array.from({ length: 50 }, (_, i) =>
      agent({
        userId: `u_${i.toString().padStart(2, "0")}`,
        openConversationCount: i % 5, // 0, 1, 2, 3, 4 cycling
        tenureMs: i * 1000,
      }),
    );
    const result = rankBestAgent(pool);
    // load=0 candidates are u_00, u_05, u_10, u_15, ..., u_45
    // tenure tiebreaker → u_45 (highest tenure among load=0)
    expect(result?.userId).toBe("u_45");
  });
});
