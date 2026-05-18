import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  prismaCampaignFindMany: vi.fn(),
}));

vi.mock("../lib/queue", () => ({
  getCampaignQueue: () => ({ add: mocks.queueAdd, name: "campaign-dispatch" }),
  getQueueConnection: () => ({ url: "redis://test" }),
  QueueNames: { CAMPAIGN_DISPATCH: "campaign-dispatch" },
  trackWorker: () => undefined,
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    campaign: {
      findMany: mocks.prismaCampaignFindMany,
    },
  },
}));

// scanScheduledCampaigns isn't exported by name, but enqueueCampaign is.
// We invoke it directly. Tests below verify producer side; the worker
// processor is the same `dispatchCampaign(id)` covered indirectly elsewhere.

describe("campaign.service queue producer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueueCampaign uses a deterministic jobId so duplicates collapse", async () => {
    mocks.queueAdd.mockResolvedValue({ id: "job_1" });
    const { enqueueCampaign } = await import("./campaign.service");

    await enqueueCampaign("camp_abc");

    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mocks.queueAdd.mock.calls[0];
    expect(name).toBe("dispatch");
    expect(data).toEqual({ campaignId: "camp_abc" });
    expect(opts).toMatchObject({ jobId: "dispatch:camp_abc" });
  });

  it("re-enqueuing the same campaign reuses the same jobId (idempotent)", async () => {
    mocks.queueAdd.mockResolvedValue({ id: "job_1" });
    const { enqueueCampaign } = await import("./campaign.service");

    await enqueueCampaign("camp_abc");
    await enqueueCampaign("camp_abc");
    await enqueueCampaign("camp_abc");

    const jobIds = mocks.queueAdd.mock.calls.map(
      ([, , opts]) => (opts as { jobId: string }).jobId,
    );
    expect(jobIds).toEqual([
      "dispatch:camp_abc",
      "dispatch:camp_abc",
      "dispatch:camp_abc",
    ]);
  });
});
