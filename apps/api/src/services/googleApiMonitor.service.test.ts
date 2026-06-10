import { describe, expect, it } from "vitest";
import { GoogleApiLogStatus } from "@nexaflow/db";
import { deriveConnectionState, summarizeLogs, toSafeLog } from "./googleApiMonitor.service";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("deriveConnectionState", () => {
  it("is DISCONNECTED without a credential (even if recently synced)", () => {
    expect(
      deriveConnectionState({ hasCredential: false, lastSyncedAt: NOW, recentErrorCount: 0, now: NOW }),
    ).toBe("DISCONNECTED");
  });

  it("is ERROR when there are recent errors", () => {
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: NOW, recentErrorCount: 2, now: NOW }),
    ).toBe("ERROR");
  });

  it("is STALE when never synced or synced too long ago", () => {
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: null, recentErrorCount: 0, now: NOW }),
    ).toBe("STALE");
    const old = new Date(NOW.getTime() - 48 * 3_600_000);
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: old, recentErrorCount: 0, now: NOW }),
    ).toBe("STALE");
  });

  it("is CONNECTED with a credential, recent sync and no errors", () => {
    const recent = new Date(NOW.getTime() - 2 * 3_600_000);
    expect(
      deriveConnectionState({ hasCredential: true, lastSyncedAt: recent, recentErrorCount: 0, now: NOW }),
    ).toBe("CONNECTED");
  });
});

describe("summarizeLogs", () => {
  it("counts by status, computes error rate and last error time", () => {
    const s = summarizeLogs([
      { status: GoogleApiLogStatus.OK, createdAt: "2026-06-10T10:00:00Z" },
      { status: GoogleApiLogStatus.OK, createdAt: "2026-06-10T10:05:00Z" },
      { status: GoogleApiLogStatus.ERROR, createdAt: "2026-06-10T11:00:00Z" },
      { status: GoogleApiLogStatus.RATE_LIMITED, createdAt: "2026-06-10T11:30:00Z" },
    ]);
    expect(s.total).toBe(4);
    expect(s.ok).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.rateLimited).toBe(1);
    expect(s.errorRate).toBe(0.5); // 2 non-OK of 4
    expect(s.lastErrorAt).toEqual(new Date("2026-06-10T11:30:00Z"));
  });

  it("returns a zeroed summary with no logs", () => {
    const s = summarizeLogs([]);
    expect(s).toEqual({ total: 0, ok: 0, errors: 0, rateLimited: 0, errorRate: 0, lastErrorAt: null });
  });
});

describe("toSafeLog", () => {
  it("projects the log row fields", () => {
    const safe = toSafeLog({
      id: "g1",
      tenantId: "t1",
      locationId: "loc1",
      operation: "locations.reviews.list",
      status: GoogleApiLogStatus.RATE_LIMITED,
      statusCode: 429,
      message: "quota exceeded",
      rateLimitRemaining: 0,
      durationMs: 120,
      createdAt: new Date("2026-06-10T11:30:00Z"),
    });
    expect(safe.operation).toBe("locations.reviews.list");
    expect(safe.status).toBe("RATE_LIMITED");
    expect(safe.statusCode).toBe(429);
    expect(safe.rateLimitRemaining).toBe(0);
  });
});
