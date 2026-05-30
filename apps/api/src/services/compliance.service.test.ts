import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
  checkFindFirst: vi.fn(),
  checkFindMany: vi.fn(),
  checkCreate: vi.fn(),
  checkUpdate: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      update: mocks.tenantUpdate,
    },
    complianceCheck: {
      findFirst: mocks.checkFindFirst,
      findMany: mocks.checkFindMany,
      create: mocks.checkCreate,
      update: mocks.checkUpdate,
    },
  },
  ComplianceMode: {
    MANUAL: "MANUAL",
    ASSISTED: "ASSISTED",
    AUTOPILOT: "AUTOPILOT",
  },
  ComplianceScope: {
    CAMPAIGN: "CAMPAIGN",
    DRIP_STEP: "DRIP_STEP",
    TEMPLATE: "TEMPLATE",
    REPLY: "REPLY",
  },
  ComplianceVerdict: {
    PASS: "PASS",
    REVIEW: "REVIEW",
    BLOCK: "BLOCK",
  },
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

const NOW = new Date("2026-05-30T00:00:00Z");

function fakeCheck(overrides: Record<string, unknown> = {}) {
  return {
    id: "chk_1",
    tenantId: "t_1",
    scope: "CAMPAIGN",
    refId: null,
    content: "hello",
    contentHash: "hash",
    verdict: "PASS",
    score: 5,
    violations: [],
    rewrite: null,
    reasoning: "clean",
    mode: "ASSISTED",
    overridden: false,
    overriddenReason: null,
    overriddenByUserId: null,
    createdAt: NOW,
    createdByUserId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantFindUnique.mockResolvedValue({ complianceMode: null });
  mocks.checkFindFirst.mockResolvedValue(null);
  mocks.checkCreate.mockImplementation(async ({ data }) =>
    fakeCheck({ ...data, id: "chk_new", createdAt: NOW }),
  );
});

describe("compliance.service", () => {
  it("blocks hard-risk heuristic phrases", async () => {
    const { ComplianceScope, runComplianceCheck } = await import(
      "./compliance.service"
    );

    const result = await runComplianceCheck({
      tenantId: "t_1",
      scope: ComplianceScope.CAMPAIGN,
      content: "Guaranteed profit with 100% guaranteed results!!!",
      useAi: false,
    });

    expect(result.check.verdict).toBe("BLOCK");
    expect(result.decision.blocked).toBe(true);
    expect(mocks.checkCreate.mock.calls[0][0].data.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "hard_policy_phrase" }),
      ]),
    );
  });

  it("reuses a recent cached analysis without calling AI again", async () => {
    const cached = fakeCheck({
      id: "chk_cached",
      contentHash: "cached_hash",
      refId: "campaign_1",
      mode: "ASSISTED",
    });
    mocks.checkFindFirst.mockResolvedValue(cached);

    const { ComplianceScope, runComplianceCheck } = await import(
      "./compliance.service"
    );
    const result = await runComplianceCheck({
      tenantId: "t_1",
      scope: ComplianceScope.CAMPAIGN,
      refId: "campaign_1",
      content: "Normal appointment reminder.",
      useAi: true,
    });

    expect(result.cached).toBe(true);
    expect(result.check.id).toBe("chk_cached");
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
    expect(mocks.checkCreate).not.toHaveBeenCalled();
  });

  it("falls back to heuristic output when the AI review fails", async () => {
    mocks.runTenantLlmJson.mockRejectedValue(new Error("anthropic 503"));

    const { ComplianceScope, runComplianceCheck } = await import(
      "./compliance.service"
    );
    const result = await runComplianceCheck({
      tenantId: "t_1",
      scope: ComplianceScope.TEMPLATE,
      content: "Your booking is confirmed for tomorrow.",
      useAi: true,
    });

    expect(result.check.verdict).toBe("PASS");
    expect(result.check.reasoning).toContain("AI review skipped or failed");
  });

  it("autopilot blocks REVIEW verdicts without override", async () => {
    const { ComplianceMode, ComplianceScope, runComplianceCheck } = await import(
      "./compliance.service"
    );
    const result = await runComplianceCheck({
      tenantId: "t_1",
      scope: ComplianceScope.REPLY,
      content: "Click now for this limited time winner offer",
      mode: ComplianceMode.AUTOPILOT,
      useAi: false,
    });

    expect(result.check.verdict).toBe("REVIEW");
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.blocked).toBe(true);
  });

  it("persists sparse mode config and clears per-scope overrides", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      complianceMode: { default: "ASSISTED", REPLY: "AUTOPILOT" },
    });
    mocks.tenantUpdate.mockResolvedValue({});

    const { ComplianceMode, setTenantComplianceModeConfig } = await import(
      "./compliance.service"
    );

    await setTenantComplianceModeConfig("t_1", {
      default: ComplianceMode.MANUAL,
      CAMPAIGN: ComplianceMode.AUTOPILOT,
      REPLY: null,
    });

    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: { id: "t_1" },
      data: {
        complianceMode: {
          default: "MANUAL",
          CAMPAIGN: "AUTOPILOT",
        },
      },
    });
  });

  it("only allows ASSISTED REVIEW checks to be overridden", async () => {
    mocks.checkFindFirst.mockResolvedValueOnce(
      fakeCheck({ verdict: "BLOCK", mode: "ASSISTED" }),
    );
    const { overrideComplianceCheck } = await import("./compliance.service");
    await expect(
      overrideComplianceCheck({
        tenantId: "t_1",
        checkId: "chk_1",
        userId: "u_1",
        reason: "Human reviewed and accepted.",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    mocks.checkFindFirst.mockResolvedValueOnce(
      fakeCheck({ verdict: "REVIEW", mode: "ASSISTED" }),
    );
    mocks.checkUpdate.mockResolvedValue(
      fakeCheck({
        verdict: "REVIEW",
        mode: "ASSISTED",
        overridden: true,
        overriddenByUserId: "u_1",
      }),
    );

    const updated = await overrideComplianceCheck({
      tenantId: "t_1",
      checkId: "chk_1",
      userId: "u_1",
      reason: "Human reviewed and accepted.",
    });

    expect(updated.overridden).toBe(true);
    expect(mocks.checkUpdate).toHaveBeenCalledWith({
      where: { id: "chk_1" },
      data: expect.objectContaining({
        overridden: true,
        overriddenReason: "Human reviewed and accepted.",
        overriddenByUserId: "u_1",
      }),
    });
  });
});
