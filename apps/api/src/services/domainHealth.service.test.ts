import { describe, expect, it } from "vitest";
import { DomainHealthOutcome, PlatformActionSeverity } from "@nexaflow/db";
import { decideEscalation } from "./domainHealth.service";

describe("decideEscalation", () => {
  it("does not escalate when current sample is OK", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.OK,
        recent: [DomainHealthOutcome.OK, DomainHealthOutcome.DNS_DRIFT],
      }),
    ).toBeNull();
  });

  it("escalates SSL_FAILED immediately, no streak required", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.SSL_FAILED,
        recent: [DomainHealthOutcome.SSL_FAILED],
      }),
    ).toBe(PlatformActionSeverity.HIGH);
  });

  it("does NOT escalate a single DNS_DRIFT sample", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.DNS_DRIFT,
        recent: [DomainHealthOutcome.DNS_DRIFT, DomainHealthOutcome.OK],
      }),
    ).toBeNull();
  });

  it("does NOT escalate two consecutive non-OK samples", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.DNS_DRIFT,
        recent: [DomainHealthOutcome.DNS_DRIFT, DomainHealthOutcome.UNREACHABLE],
      }),
    ).toBeNull();
  });

  it("escalates three consecutive non-OK samples (DNS_DRIFT)", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.DNS_DRIFT,
        recent: [
          DomainHealthOutcome.DNS_DRIFT,
          DomainHealthOutcome.UNREACHABLE,
          DomainHealthOutcome.DNS_DRIFT,
        ],
      }),
    ).toBe(PlatformActionSeverity.HIGH);
  });

  it("breaks the streak on an OK in history", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.DNS_DRIFT,
        recent: [
          DomainHealthOutcome.DNS_DRIFT,
          DomainHealthOutcome.OK,
          DomainHealthOutcome.DNS_DRIFT,
          DomainHealthOutcome.DNS_DRIFT,
        ],
      }),
    ).toBeNull();
  });

  it("escalates four consecutive non-OK samples (still HIGH, not stacking)", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.UNREACHABLE,
        recent: [
          DomainHealthOutcome.UNREACHABLE,
          DomainHealthOutcome.UNREACHABLE,
          DomainHealthOutcome.UNREACHABLE,
          DomainHealthOutcome.UNREACHABLE,
        ],
      }),
    ).toBe(PlatformActionSeverity.HIGH);
  });

  it("escalates SSL_FAILED even if the prior streak was OK", () => {
    expect(
      decideEscalation({
        current: DomainHealthOutcome.SSL_FAILED,
        recent: [DomainHealthOutcome.SSL_FAILED, DomainHealthOutcome.OK, DomainHealthOutcome.OK],
      }),
    ).toBe(PlatformActionSeverity.HIGH);
  });
});
