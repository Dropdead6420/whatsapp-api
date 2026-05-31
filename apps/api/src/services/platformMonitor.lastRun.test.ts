import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobs: vi.fn(),
  add: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {},
  Prisma: {},
  TenantType: {},
  PlatformActionCode: {},
  PlatformActionSeverity: {},
  PlatformActionStatus: {},
  WalletRiskTier: {},
  WhatsAppProviderKey: {},
  ComplianceVerdict: {},
}));

vi.mock("./ai.service", () => ({ runTenantLlmJson: vi.fn() }));
vi.mock("./pushNotification.service", () => ({ sendToTenant: vi.fn() }));

vi.mock("../lib/queue", () => ({
  getPlatformMonitorQueue: () => ({
    getJobs: mocks.getJobs,
    add: mocks.add,
  }),
  getQueueConnection: vi.fn(),
  QueueNames: { PLATFORM_MONITOR: "platform-monitor" },
  trackWorker: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Worker: class {},
}));

import {
  getLastSummaryRun,
  triggerSummaryNow,
} from "./platformMonitor.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLastSummaryRun", () => {
  it("returns null when no completed jobs exist", async () => {
    mocks.getJobs.mockResolvedValue([]);

    const result = await getLastSummaryRun();

    expect(result).toBeNull();
    expect(mocks.getJobs).toHaveBeenCalledWith(["completed"], 0, 50);
  });

  it("returns null when no completed jobs are summary jobs", async () => {
    mocks.getJobs.mockResolvedValue([
      { id: "j1", name: "scan", finishedOn: 1000, returnvalue: {} },
      { id: "j2", name: "scan", finishedOn: 2000, returnvalue: {} },
    ]);

    const result = await getLastSummaryRun();

    expect(result).toBeNull();
  });

  it("returns the freshest summary job by finishedOn (not list order)", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "older",
        name: "summary",
        finishedOn: 1000,
        returnvalue: { pushed: false, reason: "stale" },
      },
      {
        id: "newer",
        name: "summary",
        finishedOn: 3000,
        returnvalue: { pushed: true, urgentCount: 2 },
      },
      {
        id: "middle",
        name: "summary",
        finishedOn: 2000,
        returnvalue: { pushed: false },
      },
    ]);

    const result = await getLastSummaryRun();

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe("newer");
    expect(result!.ranAt.getTime()).toBe(3000);
    expect(result!.result).toEqual({ pushed: true, urgentCount: 2 });
  });

  it("skips summary jobs without finishedOn (still running)", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "running",
        name: "summary",
        finishedOn: null,
        returnvalue: undefined,
      },
      {
        id: "done",
        name: "summary",
        finishedOn: 500,
        returnvalue: { pushed: false, reason: "clean" },
      },
    ]);

    const result = await getLastSummaryRun();

    expect(result!.jobId).toBe("done");
  });

  it("returns null when queue introspection throws", async () => {
    mocks.getJobs.mockRejectedValue(new Error("Redis disconnected"));

    const result = await getLastSummaryRun();

    expect(result).toBeNull();
  });

  it("ignores 'scan' jobs even when they're newer than summary jobs", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "fresh_scan",
        name: "scan",
        finishedOn: 5000,
        returnvalue: { walletItems: 3 },
      },
      {
        id: "old_summary",
        name: "summary",
        finishedOn: 1000,
        returnvalue: { pushed: false },
      },
    ]);

    const result = await getLastSummaryRun();

    expect(result!.jobId).toBe("old_summary");
  });
});

describe("triggerSummaryNow", () => {
  it("enqueues a summary job with the kind payload and a bucketed jobId", async () => {
    mocks.add.mockResolvedValue({ id: "job_42" });

    const result = await triggerSummaryNow();

    expect(result.jobId).toBe("job_42");
    expect(mocks.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mocks.add.mock.calls[0];
    expect(name).toBe("summary");
    expect(data).toEqual({ kind: "summary" });
    expect(opts.jobId).toMatch(/^summary-manual-\d+$/);
  });

  it("produces the same jobId within a 5-second bucket (double-tap dedupes)", async () => {
    mocks.add.mockResolvedValue({ id: "anything" });

    const before = Date.now();
    await triggerSummaryNow();
    await triggerSummaryNow();
    const after = Date.now();

    // Only if both calls happened in the same 5s bucket.
    const beforeBucket = Math.floor(before / 5000);
    const afterBucket = Math.floor(after / 5000);
    if (beforeBucket === afterBucket) {
      expect(mocks.add.mock.calls[0][2].jobId).toBe(
        mocks.add.mock.calls[1][2].jobId,
      );
    }
  });

  it("returns null jobId when the queue returns a job with no id", async () => {
    mocks.add.mockResolvedValue({ id: undefined });

    const result = await triggerSummaryNow();

    expect(result.jobId).toBeNull();
  });
});
