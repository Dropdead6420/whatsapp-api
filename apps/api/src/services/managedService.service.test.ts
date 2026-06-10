import { describe, expect, it } from "vitest";
import { ManagedServiceInterval, ManagedServiceStatus } from "@nexaflow/db";
import {
  canTransition,
  summarizeEngagements,
  toSafeEngagement,
  toSafePackage,
} from "./managedService.service";

const S = ManagedServiceStatus;

describe("canTransition", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransition(S.REQUESTED, S.ACTIVE)).toBe(true);
    expect(canTransition(S.REQUESTED, S.CANCELLED)).toBe(true);
    expect(canTransition(S.ACTIVE, S.PAUSED)).toBe(true);
    expect(canTransition(S.ACTIVE, S.COMPLETED)).toBe(true);
    expect(canTransition(S.PAUSED, S.ACTIVE)).toBe(true);
  });

  it("rejects illegal or terminal transitions and self-transitions", () => {
    expect(canTransition(S.REQUESTED, S.COMPLETED)).toBe(false); // must go ACTIVE first
    expect(canTransition(S.COMPLETED, S.ACTIVE)).toBe(false); // terminal
    expect(canTransition(S.CANCELLED, S.ACTIVE)).toBe(false); // terminal
    expect(canTransition(S.ACTIVE, S.ACTIVE)).toBe(false); // no self-transition
  });
});

describe("summarizeEngagements", () => {
  it("counts engagements by status", () => {
    const s = summarizeEngagements([
      { status: S.REQUESTED },
      { status: S.ACTIVE },
      { status: S.ACTIVE },
      { status: S.COMPLETED },
      { status: S.CANCELLED },
    ]);
    expect(s).toEqual({ total: 5, requested: 1, active: 2, paused: 0, completed: 1, cancelled: 1 });
  });
});

describe("toSafePackage", () => {
  it("exposes catalog fields including deliverables and price", () => {
    const pkg = toSafePackage({
      id: "p1",
      key: "gmb-management",
      name: "Monthly GMB Management",
      description: "Done-for-you",
      category: "GMB",
      priceCents: 9900,
      currency: "USD",
      interval: ManagedServiceInterval.MONTHLY,
      deliverables: ["4 posts", "review replies"],
      isActive: true,
      sortOrder: 1,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
    });
    expect(pkg.key).toBe("gmb-management");
    expect(pkg.priceCents).toBe(9900);
    expect(pkg.deliverables).toEqual(["4 posts", "review replies"]);
  });
});

describe("toSafeEngagement", () => {
  it("exposes engagement fields but hides createdByUserId", () => {
    const e = toSafeEngagement({
      id: "e1",
      tenantId: "t1",
      packageId: "p1",
      locationId: "loc1",
      status: ManagedServiceStatus.ACTIVE,
      notes: "kickoff done",
      priceCentsSnapshot: 9900,
      currency: "USD",
      startedAt: new Date("2026-06-02"),
      completedAt: null,
      assignedToUserId: "staff_1",
      createdByUserId: "admin_1",
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-02"),
    });
    expect(e.status).toBe("ACTIVE");
    expect(e.priceCentsSnapshot).toBe(9900);
    expect(e.assignedToUserId).toBe("staff_1");
    expect((e as Record<string, unknown>).createdByUserId).toBeUndefined();
  });
});
