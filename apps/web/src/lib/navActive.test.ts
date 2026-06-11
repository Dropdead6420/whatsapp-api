import { describe, expect, it } from "vitest";
import {
  activeHrefFromPath,
  isActiveRoute,
  routeMatchScore,
} from "./navActive";

describe("routeMatchScore", () => {
  it("returns -1 when nothing matches", () => {
    expect(routeMatchScore("/contacts", { href: "/inbox" })).toBe(-1);
  });

  it("returns a high score for an exact match", () => {
    const score = routeMatchScore("/inbox", { href: "/inbox" });
    expect(score).toBeGreaterThan(1000);
  });

  it("returns a lower score for a prefix match", () => {
    const score = routeMatchScore("/inbox/conv_123", { href: "/inbox" });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(1000);
  });

  it("scores longer prefixes higher than shorter ones (for the same pathname)", () => {
    const shallow = routeMatchScore("/inbox/conv_123", { href: "/inbox" });
    const deep = routeMatchScore("/inbox/conv_123", { href: "/inbox/conv_123" });
    expect(deep).toBeGreaterThan(shallow);
  });

  it("never picks /dashboard as a prefix match (only exact)", () => {
    // Without the blocklist, every /dashboard/<feature> page would
    // light up the "Overview" nav item.
    expect(routeMatchScore("/dashboard/ai-agents", { href: "/dashboard" })).toBe(-1);
    expect(routeMatchScore("/dashboard", { href: "/dashboard" })).toBeGreaterThan(0);
  });

  it("considers activeRoutes when scoring", () => {
    const item = { href: "/flows", activeRoutes: ["/flow-runs"] };
    expect(routeMatchScore("/flow-runs/abc", item)).toBeGreaterThanOrEqual(0);
  });

  it("rejects a partial-match prefix that isn't followed by a slash", () => {
    // "/inboxold" should NOT match "/inbox" — startsWith is dangerous
    // without the trailing slash check.
    expect(routeMatchScore("/inboxold", { href: "/inbox" })).toBe(-1);
  });
});

describe("isActiveRoute", () => {
  it("returns true for any non-negative score", () => {
    expect(isActiveRoute("/contacts", { href: "/contacts" })).toBe(true);
    expect(isActiveRoute("/contacts/c_1", { href: "/contacts" })).toBe(true);
  });

  it("returns false when there's no match", () => {
    expect(isActiveRoute("/inbox", { href: "/contacts" })).toBe(false);
  });
});

describe("activeHrefFromPath", () => {
  const sections = [
    {
      items: [
        { href: "/dashboard" },
        { href: "/dashboard/ai-agents" },
        { href: "/inbox" },
        { href: "/contacts" },
      ],
    },
  ];

  it("returns null when nothing matches", () => {
    expect(activeHrefFromPath("/unknown", sections)).toBeNull();
  });

  it("picks the exact-match entry over its parent prefix", () => {
    // The critical case: on /dashboard/ai-agents, exact wins.
    expect(activeHrefFromPath("/dashboard/ai-agents", sections)).toBe(
      "/dashboard/ai-agents",
    );
  });

  it("picks /dashboard exactly when on /dashboard", () => {
    expect(activeHrefFromPath("/dashboard", sections)).toBe("/dashboard");
  });

  it("never inherits Overview highlight on a dashboard subroute", () => {
    // Same point, different angle: on a subroute we don't have a
    // matching exact item for, the /dashboard blocklist means we
    // return null — NOT /dashboard.
    expect(activeHrefFromPath("/dashboard/unknown-thing", sections)).toBeNull();
  });

  it("uses prefix-match for non-dashboard parents", () => {
    expect(activeHrefFromPath("/contacts/c_1", sections)).toBe("/contacts");
  });

  it("picks the longest matching prefix when multiple match", () => {
    const nested = [
      {
        items: [
          { href: "/settings" },
          { href: "/settings/billing" },
        ],
      },
    ];
    expect(activeHrefFromPath("/settings/billing/invoices", nested)).toBe(
      "/settings/billing",
    );
  });

  it("walks across sections", () => {
    const multi = [
      { items: [{ href: "/dashboard" }] },
      { items: [{ href: "/inbox" }] },
    ];
    expect(activeHrefFromPath("/inbox", multi)).toBe("/inbox");
  });

  // Pins the GMB sidebar: the "Content" item (href /gmb) must NOT steal the
  // highlight from sibling /gmb-* pages, and the AI-tool pages folded under
  // Content (via activeRoutes) must light Content up.
  it("keeps the GMB Content (/gmb) item from over-matching /gmb-* siblings", () => {
    const gmb = [
      {
        items: [
          { href: "/gmb-dashboard" }, // Home
          { href: "/gmb-reputation" }, // Reputation
          { href: "/gmb", activeRoutes: ["/gmb", "/gmb-descriptions", "/gmb-images", "/gmb-advisor"] }, // Content
        ],
      },
    ];
    expect(activeHrefFromPath("/gmb-dashboard", gmb)).toBe("/gmb-dashboard");
    expect(activeHrefFromPath("/gmb-reputation", gmb)).toBe("/gmb-reputation");
    expect(activeHrefFromPath("/gmb", gmb)).toBe("/gmb");
    expect(activeHrefFromPath("/gmb-descriptions", gmb)).toBe("/gmb"); // folded tool → Content
    expect(activeHrefFromPath("/gmb-images", gmb)).toBe("/gmb");
  });
});
