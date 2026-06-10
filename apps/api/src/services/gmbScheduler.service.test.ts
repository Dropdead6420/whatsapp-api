import { describe, expect, it } from "vitest";
import { GmbPostStatus } from "@nexaflow/db";
import { selectDuePosts } from "./gmbScheduler.service";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("selectDuePosts", () => {
  it("selects only SCHEDULED posts whose scheduledAt is at or before now", () => {
    const posts = [
      { id: "due", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-06-10T11:00:00Z" },
      { id: "exactly-now", status: GmbPostStatus.SCHEDULED, scheduledAt: NOW },
      { id: "future", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-06-11T00:00:00Z" },
      { id: "draft", status: GmbPostStatus.DRAFT, scheduledAt: "2026-06-01T00:00:00Z" },
      { id: "no-date", status: GmbPostStatus.SCHEDULED, scheduledAt: null },
      { id: "published", status: GmbPostStatus.PUBLISHED, scheduledAt: "2026-06-01T00:00:00Z" },
    ];
    const due = selectDuePosts(posts, NOW).map((p) => p.id);
    expect(due).toEqual(["due", "exactly-now"]);
  });

  it("returns an empty array when nothing is due", () => {
    const posts = [
      { id: "future", status: GmbPostStatus.SCHEDULED, scheduledAt: "2026-12-01T00:00:00Z" },
    ];
    expect(selectDuePosts(posts, NOW)).toEqual([]);
  });
});
