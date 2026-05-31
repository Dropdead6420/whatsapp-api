import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proposalFindFirst: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalUpdate: vi.fn(),
  proposalCreate: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    proposal: {
      findFirst: mocks.proposalFindFirst,
      findUnique: mocks.proposalFindUnique,
      update: mocks.proposalUpdate,
      create: mocks.proposalCreate,
    },
  },
  Prisma: {},
  ProposalStatus: {
    DRAFT: "DRAFT",
    SENT: "SENT",
    ACCEPTED: "ACCEPTED",
    DECLINED: "DECLINED",
  },
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

import { ProposalStatus } from "@nexaflow/db";
import {
  generateProposalDraft,
  getPublicProposalByToken,
  updateProposalStatus,
} from "./proposal.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateProposalDraft", () => {
  const brief = { prospectName: "Acme Co", industry: "retail", currency: "USD" };

  it("returns an AI-sourced draft and sanitizes fields", async () => {
    mocks.runTenantLlmJson.mockResolvedValue({
      title: "Proposal for Acme Co",
      executiveSummary: "We will turn WhatsApp into Acme's best channel.",
      painPoints: ["Slow replies", "No tracking"],
      recommendedPlan: {
        name: "Growth",
        priceMonthly: 9999,
        currency: "USD",
        features: ["Team inbox", "AI agent"],
      },
      roiEstimate: { summary: "Fast ROI", metrics: [{ label: "Speed", value: "↑" }] },
      timeline: [{ phase: "Week 1", duration: "5 days", detail: "Onboard" }],
      callToAction: "Let's start.",
    });

    const result = await generateProposalDraft({
      partnerTenantId: "partner_1",
      brief,
    });

    expect(result.source).toBe("ai");
    expect(result.estimatedValue).toBe(9999);
    expect(result.currency).toBe("USD");
    expect(result.content.painPoints).toEqual(["Slow replies", "No tracking"]);
    expect(result.content.recommendedPlan.features).toHaveLength(2);
    expect(mocks.runTenantLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "partner_1", feature: "proposal_generator" }),
    );
  });

  it("falls back to a deterministic draft when the LLM throws", async () => {
    mocks.runTenantLlmJson.mockRejectedValue(new Error("no api key"));

    const result = await generateProposalDraft({
      partnerTenantId: "partner_1",
      brief: { prospectName: "Beta Clinic", industry: "healthcare" },
    });

    expect(result.source).toBe("fallback");
    expect(result.content.painPoints.length).toBeGreaterThan(0);
    expect(result.content.timeline.length).toBeGreaterThan(0);
    expect(result.title).toContain("Beta Clinic");
  });

  it("falls back when the LLM returns an empty object", async () => {
    mocks.runTenantLlmJson.mockResolvedValue({});

    const result = await generateProposalDraft({
      partnerTenantId: "partner_1",
      brief,
    });

    expect(result.source).toBe("fallback");
  });
});

describe("updateProposalStatus", () => {
  it("rejects an illegal regression (ACCEPTED → DRAFT)", async () => {
    mocks.proposalFindFirst.mockResolvedValue({
      id: "pr_1",
      partnerTenantId: "partner_1",
      status: "ACCEPTED",
      sentAt: new Date(),
    });

    await expect(
      updateProposalStatus({
        partnerTenantId: "partner_1",
        proposalId: "pr_1",
        status: ProposalStatus.DRAFT,
      }),
    ).rejects.toThrow(/back to DRAFT/);
    expect(mocks.proposalUpdate).not.toHaveBeenCalled();
  });

  it("stamps sentAt the first time it moves to SENT", async () => {
    mocks.proposalFindFirst.mockResolvedValue({
      id: "pr_1",
      partnerTenantId: "partner_1",
      status: "DRAFT",
      sentAt: null,
    });
    mocks.proposalUpdate.mockImplementation(({ data }: { data: unknown }) => ({
      id: "pr_1",
      ...(data as object),
    }));

    await updateProposalStatus({
      partnerTenantId: "partner_1",
      proposalId: "pr_1",
      status: ProposalStatus.SENT,
    });

    const call = mocks.proposalUpdate.mock.calls[0][0];
    expect(call.data.status).toBe("SENT");
    expect(call.data.sentAt).toBeInstanceOf(Date);
  });

  it("allows correcting ACCEPTED → DECLINED", async () => {
    mocks.proposalFindFirst.mockResolvedValue({
      id: "pr_1",
      partnerTenantId: "partner_1",
      status: "ACCEPTED",
      sentAt: new Date(),
    });
    mocks.proposalUpdate.mockResolvedValue({ id: "pr_1", status: "DECLINED" });

    const updated = await updateProposalStatus({
      partnerTenantId: "partner_1",
      proposalId: "pr_1",
      status: ProposalStatus.DECLINED,
    });

    expect(updated.status).toBe("DECLINED");
  });

  it("scopes the lookup to the owning partner", async () => {
    mocks.proposalFindFirst.mockResolvedValue(null);

    await expect(
      updateProposalStatus({
        partnerTenantId: "partner_1",
        proposalId: "pr_other",
        status: ProposalStatus.SENT,
      }),
    ).rejects.toThrow(/not found/i);

    expect(mocks.proposalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pr_other", partnerTenantId: "partner_1" },
      }),
    );
  });
});

describe("getPublicProposalByToken", () => {
  const baseProposal = {
    shareToken: "share_token_123",
    prospectName: "Acme Co",
    industry: "retail",
    title: "NexaFlow proposal for Acme",
    currency: "USD",
    estimatedValue: 9999,
    content: {
      executiveSummary: "Summary",
      painPoints: ["Slow replies"],
      recommendedPlan: {
        name: "Growth",
        priceMonthly: 9999,
        currency: "USD",
        features: ["Team inbox"],
      },
      roiEstimate: { summary: "ROI", metrics: [{ label: "Speed", value: "Fast" }] },
      timeline: [{ phase: "Week 1", duration: "5 days", detail: "Setup" }],
      callToAction: "Start now.",
    },
    sentAt: new Date("2026-05-01T00:00:00.000Z"),
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    partnerTenant: {
      name: "Partner Co",
      domain: "partner.example",
      logoUrl: null,
      brandColors: null,
    },
  };

  it("returns SENT proposals by share token", async () => {
    mocks.proposalFindUnique.mockResolvedValue({
      ...baseProposal,
      status: "SENT",
    });

    const result = await getPublicProposalByToken("share_token_123");

    expect(result.partner.name).toBe("Partner Co");
    expect(result.content.recommendedPlan.name).toBe("Growth");
    expect(mocks.proposalFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shareToken: "share_token_123" },
      }),
    );
  });

  it("hides DRAFT and DECLINED proposals", async () => {
    mocks.proposalFindUnique.mockResolvedValue({
      ...baseProposal,
      status: "DRAFT",
    });

    await expect(getPublicProposalByToken("share_token_123")).rejects.toThrow(
      /not found/i,
    );

    mocks.proposalFindUnique.mockResolvedValue({
      ...baseProposal,
      status: "DECLINED",
    });

    await expect(getPublicProposalByToken("share_token_123")).rejects.toThrow(
      /not found/i,
    );
  });
});
