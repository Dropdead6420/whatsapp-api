import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  configUpdate: vi.fn(),
  seqFindFirst: vi.fn(),
  scoreFindFirst: vi.fn(),
  scoreFindMany: vi.fn(),
  contactFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  enrollContact: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    retentionConfig: {
      findUnique: mocks.configFindUnique,
      update: mocks.configUpdate,
    },
    dripSequence: { findFirst: mocks.seqFindFirst },
    contactRetentionScore: {
      findFirst: mocks.scoreFindFirst,
      findMany: mocks.scoreFindMany,
    },
    contact: { findMany: mocks.contactFindMany },
    dripEnrollment: { findMany: mocks.enrollmentFindMany },
  },
  Prisma: {},
  RetentionTier: {
    ACTIVE: "ACTIVE",
    COOLING: "COOLING",
    DORMANT: "DORMANT",
    LOST: "LOST",
  },
  RetentionMode: {
    MANUAL: "MANUAL",
    ASSISTED: "ASSISTED",
    AUTOPILOT: "AUTOPILOT",
  },
  DripSequenceStatus: {
    DRAFT: "DRAFT",
    ACTIVE: "ACTIVE",
    PAUSED: "PAUSED",
  },
  LifecycleStage: {
    LEAD: "LEAD",
    PROSPECT: "PROSPECT",
    CUSTOMER: "CUSTOMER",
    REPEAT_CUSTOMER: "REPEAT_CUSTOMER",
    VIP: "VIP",
    CHURNED: "CHURNED",
  },
}));

vi.mock("./dripSequence.service", () => ({
  enrollContact: mocks.enrollContact,
}));

import { runRetentionAutopilot } from "./contactRetention.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scoreFindFirst.mockResolvedValue({ dayKey: "2026-05-30" });
  mocks.seqFindFirst.mockResolvedValue({ status: "ACTIVE" });
  mocks.configUpdate.mockResolvedValue({});
});

describe("runRetentionAutopilot", () => {
  it("no-ops in MANUAL mode", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "MANUAL",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 50,
    });

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.enrolled).toBe(0);
    expect(result.candidates).toBe(0);
    expect(result.reason).toMatch(/MANUAL/);
    expect(mocks.enrollContact).not.toHaveBeenCalled();
  });

  it("reports when no win-back sequence is configured", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "AUTOPILOT",
      winbackSequenceId: null,
      maxEnrollPerRun: 50,
    });

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.reason).toMatch(/No win-back sequence/);
    expect(mocks.enrollContact).not.toHaveBeenCalled();
  });

  it("refuses to enroll when the win-back sequence is not ACTIVE", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "AUTOPILOT",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 50,
    });
    mocks.seqFindFirst.mockResolvedValue({ status: "DRAFT" });

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.reason).toMatch(/not ACTIVE/);
    expect(mocks.enrollContact).not.toHaveBeenCalled();
  });

  it("ASSISTED surfaces candidates without enrolling", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "ASSISTED",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 50,
    });
    mocks.scoreFindMany.mockResolvedValue([
      { contactId: "c1" },
      { contactId: "c2" },
    ]);
    mocks.contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mocks.enrollmentFindMany.mockResolvedValue([]);

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.candidates).toBe(2);
    expect(result.enrolled).toBe(0);
    expect(result.reason).toMatch(/ASSISTED/);
    expect(mocks.enrollContact).not.toHaveBeenCalled();
  });

  it("AUTOPILOT enrolls only eligible, non-enrolled dormant contacts", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "AUTOPILOT",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 50,
    });
    // c1, c2, c3 dormant; c3 opted out (excluded by contact query);
    // c2 already enrolled → only c1 should enroll.
    mocks.scoreFindMany.mockResolvedValue([
      { contactId: "c1" },
      { contactId: "c2" },
      { contactId: "c3" },
    ]);
    mocks.contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    mocks.enrollmentFindMany.mockResolvedValue([{ contactId: "c2" }]);
    mocks.enrollContact.mockResolvedValue({ id: "enr_1" });

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.candidates).toBe(1);
    expect(result.enrolled).toBe(1);
    expect(mocks.enrollContact).toHaveBeenCalledTimes(1);
    expect(mocks.enrollContact).toHaveBeenCalledWith({
      tenantId: "t1",
      sequenceId: "seq_1",
      contactId: "c1",
    });
    expect(mocks.configUpdate).toHaveBeenCalled();
  });

  it("respects maxEnrollPerRun as a hard cap", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "AUTOPILOT",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 2,
    });
    const dormant = ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ contactId: id }));
    mocks.scoreFindMany.mockResolvedValue(dormant);
    mocks.contactFindMany.mockResolvedValue(
      ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id })),
    );
    mocks.enrollmentFindMany.mockResolvedValue([]);
    mocks.enrollContact.mockResolvedValue({ id: "enr" });

    const result = await runRetentionAutopilot({ tenantId: "t1" });

    expect(result.candidates).toBe(2);
    expect(result.enrolled).toBe(2);
    expect(mocks.enrollContact).toHaveBeenCalledTimes(2);
  });

  it("dryRun returns candidates without enrolling even in AUTOPILOT", async () => {
    mocks.configFindUnique.mockResolvedValue({
      mode: "AUTOPILOT",
      winbackSequenceId: "seq_1",
      maxEnrollPerRun: 50,
    });
    mocks.scoreFindMany.mockResolvedValue([{ contactId: "c1" }]);
    mocks.contactFindMany.mockResolvedValue([{ id: "c1" }]);
    mocks.enrollmentFindMany.mockResolvedValue([]);

    const result = await runRetentionAutopilot({ tenantId: "t1", dryRun: true });

    expect(result.candidates).toBe(1);
    expect(result.enrolled).toBe(0);
    expect(mocks.enrollContact).not.toHaveBeenCalled();
  });
});
