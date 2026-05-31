import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobs: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {},
  Prisma: {},
  DomainHealthOutcome: {},
  DomainStatus: {},
  DomainSslStatus: {},
  PlatformActionCode: {},
  PlatformActionSeverity: {},
  PlatformActionStatus: {},
}));

vi.mock("../lib/queue", () => ({
  getDomainHealthQueue: () => ({ getJobs: mocks.getJobs }),
  getQueueConnection: vi.fn(),
  QueueNames: { DOMAIN_HEALTH: "domain-health" },
  trackWorker: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: class {},
}));

import { getLastDomainHealthScan } from "./domainHealth.service";

const SCAN_JOB_NAME = "domain-health-scan";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLastDomainHealthScan", () => {
  it("returns null on an empty queue", async () => {
    mocks.getJobs.mockResolvedValue([]);

    const result = await getLastDomainHealthScan();

    expect(result).toBeNull();
    expect(mocks.getJobs).toHaveBeenCalledWith(["completed"], 0, 50);
  });

  it("returns null when no completed jobs match the scan name", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "j1",
        name: "wallet-reconciliation-scan",
        finishedOn: 5000,
        returnvalue: {},
      },
    ]);

    const result = await getLastDomainHealthScan();

    expect(result).toBeNull();
  });

  it("returns the freshest scan by finishedOn", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "old",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: { scanned: 10, escalated: 0 },
      },
      {
        id: "fresh",
        name: SCAN_JOB_NAME,
        finishedOn: 6000,
        returnvalue: { scanned: 25, escalated: 2 },
      },
      {
        id: "middle",
        name: SCAN_JOB_NAME,
        finishedOn: 3500,
        returnvalue: { scanned: 15, escalated: 1 },
      },
    ]);

    const result = await getLastDomainHealthScan();

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe("fresh");
    expect(result!.ranAt.getTime()).toBe(6000);
    expect(result!.result).toEqual({ scanned: 25, escalated: 2 });
  });

  it("skips still-running scans (no finishedOn)", async () => {
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
        finishedOn: 800,
        returnvalue: { scanned: 3, escalated: 0 },
      },
    ]);

    const result = await getLastDomainHealthScan();

    expect(result!.jobId).toBe("done");
  });

  it("returns null when the freshest scan has no returnvalue", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "legacy",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: undefined,
      },
    ]);

    const result = await getLastDomainHealthScan();

    expect(result).toBeNull();
  });

  it("returns null when queue introspection throws", async () => {
    mocks.getJobs.mockRejectedValue(new Error("Redis unavailable"));

    const result = await getLastDomainHealthScan();

    expect(result).toBeNull();
  });

  it("ignores other job names even when newer", async () => {
    mocks.getJobs.mockResolvedValue([
      {
        id: "fresh_other",
        name: "platform-monitor-scan",
        finishedOn: 9999,
        returnvalue: {},
      },
      {
        id: "old_recon",
        name: SCAN_JOB_NAME,
        finishedOn: 1000,
        returnvalue: { scanned: 3, escalated: 0 },
      },
    ]);

    const result = await getLastDomainHealthScan();

    expect(result!.jobId).toBe("old_recon");
  });
});
