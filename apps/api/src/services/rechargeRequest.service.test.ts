import { describe, expect, it } from "vitest";
import {
  assertCanTransitionStatus,
  canTransitionStatus,
  sanitizeNote,
  sanitizeProofUrl,
  sanitizeReference,
} from "./rechargeRequest.service";

describe("canTransitionStatus", () => {
  it("PENDING → APPROVED is allowed", () => {
    expect(canTransitionStatus("PENDING", "APPROVED")).toBe(true);
  });

  it("PENDING → REJECTED is allowed", () => {
    expect(canTransitionStatus("PENDING", "REJECTED")).toBe(true);
  });

  it("APPROVED is terminal — no further transitions", () => {
    for (const target of ["PENDING", "REJECTED"] as const) {
      expect(canTransitionStatus("APPROVED", target)).toBe(false);
    }
  });

  it("REJECTED is terminal — no further transitions", () => {
    for (const target of ["PENDING", "APPROVED"] as const) {
      expect(canTransitionStatus("REJECTED", target)).toBe(false);
    }
  });

  it("self-transitions are forbidden", () => {
    for (const s of ["PENDING", "APPROVED", "REJECTED"] as const) {
      expect(canTransitionStatus(s, s)).toBe(false);
    }
  });
});

describe("assertCanTransitionStatus", () => {
  it("throws on a terminal-→-anything transition", () => {
    expect(() => assertCanTransitionStatus("APPROVED", "REJECTED")).toThrow(
      /transition/i,
    );
  });

  it("does not throw on a legal transition", () => {
    expect(() => assertCanTransitionStatus("PENDING", "APPROVED")).not.toThrow();
  });
});

describe("sanitizeProofUrl", () => {
  it("returns null for null / undefined / empty", () => {
    expect(sanitizeProofUrl(null)).toBeNull();
    expect(sanitizeProofUrl(undefined)).toBeNull();
    expect(sanitizeProofUrl("")).toBeNull();
    expect(sanitizeProofUrl("   ")).toBeNull();
  });

  it("accepts an https URL", () => {
    expect(sanitizeProofUrl("https://files.example.com/proof.pdf")).toBe(
      "https://files.example.com/proof.pdf",
    );
  });

  it("accepts an http URL", () => {
    expect(sanitizeProofUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("rejects javascript: scheme (XSS surface)", () => {
    expect(() =>
      sanitizeProofUrl("javascript:alert('x')"),
    ).toThrow(/http/);
  });

  it("rejects data: scheme", () => {
    expect(() => sanitizeProofUrl("data:text/html,<script>")).toThrow(/http/);
  });

  it("rejects relative paths", () => {
    expect(() => sanitizeProofUrl("/admin/keys")).toThrow(/http/);
  });

  it("rejects oversized URLs (>1024)", () => {
    expect(() =>
      sanitizeProofUrl(`https://example.com/${"a".repeat(1100)}`),
    ).toThrow(/1024/);
  });

  it("rejects non-string input", () => {
    expect(() => sanitizeProofUrl(42)).toThrow(/string/i);
  });
});

describe("sanitizeReference", () => {
  it("returns null for null / undefined / empty", () => {
    expect(sanitizeReference(null)).toBeNull();
    expect(sanitizeReference(undefined)).toBeNull();
    expect(sanitizeReference("   ")).toBeNull();
  });

  it("trims and caps at 80 characters", () => {
    expect(sanitizeReference("  UTR1234567890  ")).toBe("UTR1234567890");
    expect(sanitizeReference("x".repeat(100))?.length).toBe(80);
  });

  it("silently returns null for non-string (forgiving — reference is optional)", () => {
    expect(sanitizeReference(42)).toBeNull();
  });
});

describe("sanitizeNote", () => {
  it("returns null for null / undefined / empty", () => {
    expect(sanitizeNote(null, "x")).toBeNull();
    expect(sanitizeNote("   ", "x")).toBeNull();
  });

  it("trims + caps at 1024", () => {
    expect(sanitizeNote("  hello  ", "x")).toBe("hello");
    expect(sanitizeNote("x".repeat(2000), "x")?.length).toBe(1024);
  });

  it("rejects non-string input loudly (label echoed in error)", () => {
    expect(() => sanitizeNote(42, "customerNote")).toThrow(/customerNote/);
  });
});
