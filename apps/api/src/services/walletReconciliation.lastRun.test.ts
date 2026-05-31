import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobs: vi.fn(),
}));

// The wallet reconciliation service imports prisma + queue helpers + bullmq
// only for the parts of the file we don't exercise in this test — we stub
// them out so the import path resolves without needing a real DB/Redis.
vi.mock("@nexaflow/db", () => ({
  prisma: {},
  Prisma: {},
}));

vi.mock("../lib/queue", () => ({
  getWalletReconciliationQueue: () => ({ getJobs: mocks.getJobs }),
  getQueueConnection: vi.fn(),
  trackWorker: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: class {},
}));

import { getLastReconciliationRun } from "./walletReconciliation.service";

const SCAN_JOB_NAME = "wallet-reconciliation-scan";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLastReconciliationRun", () => {
  it("returns null when the queue has no completed jobs", async () => {
    mocks.getJobs.mockResolvedValue([]);

    const result = await getLastReconciliationRun();

    expect(result).toBeNull();
    expect(mocks.getJobs).toHaveBeenCalledWith(["completed"], 0, 50);
  });

  it("returns null when no completed jobs are reconciliation scans", async () => {
    mocks.getJobs.mockResolvedValue([
      { id: "j1", name: "other-job", finishedOn: 1000, returnvalue: {} },
    ]);

    const result = await getLastReconciliationRun();

    expect(result).toBeNull();
  });

  it("returns the freshest scan by finishedOn (not list order)", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "older",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: { scanned: 10, clean: 10, drifted: 0, items: [] },
      },
      {
        id: "newer",
        name: SCAN_JOB_NAME,
        finishedOn: 5000,
        returnvalue: { scanned: 25, clean: 24, drifted: 1, items: [] },
      },
      {
        id: "middle",
        name: SCAN_JOB_NAME,
        finishedOn: 3000,
        returnvalue: { scanned: 15, clean: 15, drifted: 0, items: [] },
      },
    ]);

    const result = await getLastReconciliationRun();

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe("newer");
    expect(result!.ranAt.getTime()).toBe(5000);
    expect(result!.result.drifted).toBe(1);
  });

  it("skips scans without finishedOn (still running)", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "running",
        name: SCAN_JOB_NAME,
        finishedOn: null,
        returnvalue: undefined,
      },
      {
        id: "done",
        name: SCAN_JOB_NAME,
        finishedOn: 500,
        returnvalue: { scanned: 5, clean: 5, drifted: 0, items: [] },
      },
    ]);

    const result = await getLastReconciliationRun();

    expect(result!.jobId).toBe("done");
  });

  it("returns null when the freshest scan has no returnvalue (legacy job)", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "legacy",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: undefined,
      },
    ]);

    const result = await getLastReconciliationRun();

    expect(result).toBeNull();
  });

  it("returns null when the queue introspection throws", async () => {
    mocks.getJobs.mockRejectedValue(new Error("Redis disconnected"));

    const result = await getLastReconciliationRun();

    expect(result).toBeNull();
  });

  it("ignores foreign job names even when they're newer", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "fresh_unrelated",
        name: "campaign-dispatch",
        finishedOn: 9999,
        returnvalue: { campaigns: 12 },
      },
      {
        id: "old_recon",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: { scanned: 3, clean: 3, drifted: 0, items: [] },
      },
    ]);

    const result = await getLastReconciliationRun();

    expect(result!.jobId).toBe("old_recon");
  });
});
