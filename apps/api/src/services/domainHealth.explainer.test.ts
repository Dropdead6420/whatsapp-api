import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  domainFindFirst: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    domain: { findFirst: mocks.domainFindFirst },
  },
  Prisma: {},
  DomainHealthOutcome: {
    OK: "OK",
    DNS_DRIFT: "DNS_DRIFT",
    SSL_FAILED: "SSL_FAILED",
    UNREACHABLE: "UNREACHABLE",
  },
  DomainStatus: {
    PENDING_DNS: "PENDING_DNS",
    DNS_FOUND: "DNS_FOUND",
    TXT_VERIFIED: "TXT_VERIFIED",
    SSL_PENDING: "SSL_PENDING",
    SSL_ACTIVE: "SSL_ACTIVE",
    LIVE: "LIVE",
    FAILED: "FAILED",
    SUSPENDED: "SUSPENDED",
  },
  DomainSslStatus: { PENDING: "PENDING", ACTIVE: "ACTIVE", FAILED: "FAILED" },
  PlatformActionCode: {},
  PlatformActionSeverity: {},
  PlatformActionStatus: {},
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

import { explainDomainError } from "./domainHealth.service";

const baseDomain = {
  id: "d_1",
  domain: "portal.acme.com",
  status: "LIVE",
  lastError: null,
  cnameHost: "portal.acme.com",
  cnameValue: "wl.nexaflow.app",
  txtHost: "_nexaflow_verify.portal.acme.com",
  txtValue: "nexaflow-verify=abc123",
  healthSamples: [] as Array<{
    outcome: string;
    cnameOk: boolean;
    txtOk: boolean;
    sslOk: boolean;
    error: string | null;
    observedAt: Date;
  }>,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("explainDomainError", () => {
  it("404s when the domain is not owned by the partner", async () => {
    mocks.domainFindFirst.mockResolvedValue(null);

    await expect(
      explainDomainError({ partnerTenantId: "p1", domainId: "d_other" }),
    ).rejects.toThrow(/not found/i);
    expect(mocks.domainFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d_other", partnerTenantId: "p1" },
      }),
    );
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("short-circuits to fallback (no LLM call) when there are no samples", async () => {
    mocks.domainFindFirst.mockResolvedValue({ ...baseDomain, healthSamples: [] });

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("fallback");
    expect(result.outcome).toBe("UNKNOWN");
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("short-circuits to fallback when latest sample is OK", async () => {
    mocks.domainFindFirst.mockResolvedValue({
      ...baseDomain,
      healthSamples: [
        {
          outcome: "OK",
          cnameOk: true,
          txtOk: true,
          sslOk: true,
          error: null,
          observedAt: new Date(),
        },
      ],
    });

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("fallback");
    expect(result.outcome).toBe("OK");
    expect(result.steps).toHaveLength(0);
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("calls the LLM for a DNS_DRIFT sample and returns sanitized AI output", async () => {
    mocks.domainFindFirst.mockResolvedValue({
      ...baseDomain,
      healthSamples: [
        {
          outcome: "DNS_DRIFT",
          cnameOk: false,
          txtOk: true,
          sslOk: false,
          error: "CNAME no longer resolves.",
          observedAt: new Date(),
        },
      ],
    });
    mocks.runTenantLlmJson.mockResolvedValue({
      summary: "Your CNAME is missing.",
      steps: ["Check DNS", "Add the CNAME", "  ", ""],
    });

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("ai");
    expect(result.outcome).toBe("DNS_DRIFT");
    expect(result.summary).toBe("Your CNAME is missing.");
    expect(result.steps).toEqual(["Check DNS", "Add the CNAME"]); // empties dropped
    expect(mocks.runTenantLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "p1",
        feature: "domain_error_explainer",
      }),
    );
  });

  it("falls back to the deterministic playbook when the LLM throws", async () => {
    mocks.domainFindFirst.mockResolvedValue({
      ...baseDomain,
      healthSamples: [
        {
          outcome: "SSL_FAILED",
          cnameOk: true,
          txtOk: true,
          sslOk: false,
          error: "SSL cert expired.",
          observedAt: new Date(),
        },
      ],
    });
    mocks.runTenantLlmJson.mockRejectedValue(new Error("no api key"));

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("fallback");
    expect(result.outcome).toBe("SSL_FAILED");
    expect(result.summary).toContain("portal.acme.com");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("falls back when the LLM returns an empty object", async () => {
    mocks.domainFindFirst.mockResolvedValue({
      ...baseDomain,
      healthSamples: [
        {
          outcome: "UNREACHABLE",
          cnameOk: false,
          txtOk: false,
          sslOk: false,
          error: "timeout",
          observedAt: new Date(),
        },
      ],
    });
    mocks.runTenantLlmJson.mockResolvedValue({});

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("fallback");
    expect(result.outcome).toBe("UNREACHABLE");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("scopes the lookup to the partner (cross-partner id guess never succeeds)", async () => {
    mocks.domainFindFirst.mockResolvedValue(null);

    await expect(
      explainDomainError({ partnerTenantId: "p1", domainId: "d_other_partner" }),
    ).rejects.toThrow(/not found/i);
    const call = mocks.domainFindFirst.mock.calls[0][0];
    expect(call.where).toEqual({
      id: "d_other_partner",
      partnerTenantId: "p1",
    });
  });

  it("includes the exact cname/txt values in the fallback DNS_DRIFT steps", async () => {
    mocks.domainFindFirst.mockResolvedValue({
      ...baseDomain,
      healthSamples: [
        {
          outcome: "DNS_DRIFT",
          cnameOk: false,
          txtOk: false,
          sslOk: false,
          error: "Both missing",
          observedAt: new Date(),
        },
      ],
    });
    mocks.runTenantLlmJson.mockRejectedValue(new Error("no api key"));

    const result = await explainDomainError({
      partnerTenantId: "p1",
      domainId: "d_1",
    });

    expect(result.source).toBe("fallback");
    expect(result.steps.join(" ")).toContain("portal.acme.com");
    expect(result.steps.join(" ")).toContain("wl.nexaflow.app");
    expect(result.steps.join(" ")).toContain("_nexaflow_verify");
    expect(result.steps.join(" ")).toContain("nexaflow-verify=abc123");
  });
});
