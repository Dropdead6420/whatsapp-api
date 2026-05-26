import { beforeEach, describe, expect, it, vi } from "vitest";

// T-023: tests for the wallet reconciliation service. The BullMQ worker
// is exercised in integration tests (or in production); here we focus
// on the pure logic: ledger sum, last-snapshot, drift detection.

const mocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn(),
  walletFindMany: vi.fn(),
  txGroupBy: vi.fn(),
  txFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  userFindFirst: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    wallet: {
      findUnique: mocks.walletFindUnique,
      findMany: mocks.walletFindMany,
    },
    walletTransaction: {
      groupBy: mocks.txGroupBy,
      findFirst: mocks.txFindFirst,
    },
    auditLog: { create: mocks.auditCreate },
    user: { findFirst: mocks.userFindFirst },
    $queryRaw: vi.fn(),
  },
}));

// Stub out the BullMQ queue helper so importing the service file
// doesn't try to connect to Redis.
vi.mock("../lib/queue", () => ({
  getQueueConnection: vi.fn(),
  getWalletReconciliationQueue: vi.fn(),
  trackWorker: vi.fn(),
}));

import {
  reconcileWallet,
  reconcileAllWallets,
} from "./walletReconciliation.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindFirst.mockResolvedValue({ id: "admin_1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit_1" });
});

describe("reconcileWallet", () => {
  it("throws when wallet not found", async () => {
    mocks.walletFindUnique.mockResolvedValue(null);
    await expect(reconcileWallet("wallet_missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("returns no-drift result when declared == ledgerSum == lastSnapshot", async () => {
    mocks.walletFindUnique.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      balanceCredits: 800,
    });
    mocks.txGroupBy.mockResolvedValue([
      { direction: "CREDIT", _sum: { amountCredits: 1000 }, _count: { _all: 5 } },
      { direction: "DEBIT", _sum: { amountCredits: 200 }, _count: { _all: 3 } },
    ]);
    mocks.txFindFirst.mockResolvedValue({ balanceAfterCredits: 800 });

    const result = await reconcileWallet("w1");
    expect(result.declared).toBe(800);
    expect(result.ledgerSum).toBe(800);
    expect(result.lastSnapshot).toBe(800);
    expect(result.driftFromLedger).toBe(0);
    expect(result.driftFromSnapshot).toBe(0);
    expect(result.hasDrift).toBe(false);
    expect(result.txCount).toBe(8);
  });

  it("detects positive drift (wallet has more than ledger says)", async () => {
    mocks.walletFindUnique.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      balanceCredits: 1000,
    });
    // ledger says 500 net but column says 1000 - drift of 500
    mocks.txGroupBy.mockResolvedValue([
      { direction: "CREDIT", _sum: { amountCredits: 600 }, _count: { _all: 2 } },
      { direction: "DEBIT", _sum: { amountCredits: 100 }, _count: { _all: 1 } },
    ]);
    mocks.txFindFirst.mockResolvedValue({ balanceAfterCredits: 500 });

    const result = await reconcileWallet("w1");
    expect(result.ledgerSum).toBe(500);
    expect(result.lastSnapshot).toBe(500);
    expect(result.driftFromLedger).toBe(500);
    expect(result.driftFromSnapshot).toBe(500);
    expect(result.hasDrift).toBe(true);
  });

  it("detects negative drift (wallet shows less than ledger total)", async () => {
    mocks.walletFindUnique.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      balanceCredits: 50,
    });
    mocks.txGroupBy.mockResolvedValue([
      { direction: "CREDIT", _sum: { amountCredits: 200 }, _count: { _all: 2 } },
      { direction: "DEBIT", _sum: { amountCredits: 100 }, _count: { _all: 1 } },
    ]);
    mocks.txFindFirst.mockResolvedValue({ balanceAfterCredits: 100 });

    const result = await reconcileWallet("w1");
    expect(result.driftFromLedger).toBe(-50);
    expect(result.driftFromSnapshot).toBe(-50);
    expect(result.hasDrift).toBe(true);
  });

  it("handles empty ledger (new wallet, balance 0)", async () => {
    mocks.walletFindUnique.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      balanceCredits: 0,
    });
    mocks.txGroupBy.mockResolvedValue([]); // no transactions
    mocks.txFindFirst.mockResolvedValue(null);

    const result = await reconcileWallet("w1");
    expect(result.ledgerSum).toBe(0);
    expect(result.lastSnapshot).toBeNull();
    expect(result.driftFromLedger).toBe(0);
    expect(result.driftFromSnapshot).toBeNull();
    expect(result.hasDrift).toBe(false);
    expect(result.txCount).toBe(0);
  });

  it("flags drift when only the snapshot disagrees", async () => {
    // Ledger sum and declared match, but the latest snapshot is wrong —
    // can happen if a transaction wrote balanceAfterCredits before the
    // wallet column was updated and the bug got rolled back.
    mocks.walletFindUnique.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      balanceCredits: 500,
    });
    mocks.txGroupBy.mockResolvedValue([
      { direction: "CREDIT", _sum: { amountCredits: 700 }, _count: { _all: 3 } },
      { direction: "DEBIT", _sum: { amountCredits: 200 }, _count: { _all: 2 } },
    ]);
    mocks.txFindFirst.mockResolvedValue({ balanceAfterCredits: 480 }); // stale

    const result = await reconcileWallet("w1");
    expect(result.driftFromLedger).toBe(0);
    expect(result.driftFromSnapshot).toBe(20);
    expect(result.hasDrift).toBe(true);
  });
});

describe("reconcileAllWallets", () => {
  it("returns empty summary for no wallets", async () => {
    mocks.walletFindMany.mockResolvedValue([]);
    const summary = await reconcileAllWallets();
    expect(summary.scanned).toBe(0);
    expect(summary.clean).toBe(0);
    expect(summary.drifted).toBe(0);
    expect(summary.drifts).toEqual([]);
  });

  it("counts clean + drifted across multiple wallets", async () => {
    mocks.walletFindMany.mockResolvedValue([{ id: "w_clean" }, { id: "w_drift" }]);

    // First wallet: clean
    mocks.walletFindUnique.mockResolvedValueOnce({
      id: "w_clean",
      tenantId: "t1",
      balanceCredits: 100,
    });
    mocks.txGroupBy.mockResolvedValueOnce([
      { direction: "CREDIT", _sum: { amountCredits: 100 }, _count: { _all: 1 } },
    ]);
    mocks.txFindFirst.mockResolvedValueOnce({ balanceAfterCredits: 100 });

    // Second wallet: drift
    mocks.walletFindUnique.mockResolvedValueOnce({
      id: "w_drift",
      tenantId: "t2",
      balanceCredits: 999,
    });
    mocks.txGroupBy.mockResolvedValueOnce([
      { direction: "CREDIT", _sum: { amountCredits: 100 }, _count: { _all: 1 } },
    ]);
    mocks.txFindFirst.mockResolvedValueOnce({ balanceAfterCredits: 100 });

    const summary = await reconcileAllWallets();
    expect(summary.scanned).toBe(2);
    expect(summary.clean).toBe(1);
    expect(summary.drifted).toBe(1);
    expect(summary.drifts[0].walletId).toBe("w_drift");
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mocks.auditCreate.mock.calls[0][0];
    expect(auditArgs.data.action).toBe("RECONCILIATION_DRIFT");
    expect(auditArgs.data.resource).toBe("Wallet");
    expect(auditArgs.data.resourceId).toBe("w_drift");
  });

  it("continues scanning when a single wallet errors", async () => {
    mocks.walletFindMany.mockResolvedValue([{ id: "w_ok" }, { id: "w_explode" }]);

    // First: clean
    mocks.walletFindUnique.mockResolvedValueOnce({
      id: "w_ok",
      tenantId: "t1",
      balanceCredits: 0,
    });
    mocks.txGroupBy.mockResolvedValueOnce([]);
    mocks.txFindFirst.mockResolvedValueOnce(null);

    // Second: throws — should be caught and the scan continues
    mocks.walletFindUnique.mockResolvedValueOnce(null); // triggers "not found" throw

    const summary = await reconcileAllWallets();
    expect(summary.scanned).toBe(2);
    expect(summary.clean).toBe(1);
    expect(summary.drifted).toBe(0);
  });

  it("continues when audit write fails (doesn't poison the scan)", async () => {
    mocks.walletFindMany.mockResolvedValue([{ id: "w_drift" }]);
    mocks.walletFindUnique.mockResolvedValue({
      id: "w_drift",
      tenantId: "t1",
      balanceCredits: 999,
    });
    mocks.txGroupBy.mockResolvedValue([]);
    mocks.txFindFirst.mockResolvedValue(null);
    mocks.auditCreate.mockRejectedValue(new Error("audit table down"));

    const summary = await reconcileAllWallets();
    expect(summary.scanned).toBe(1);
    expect(summary.drifted).toBe(1);
    // Drift still tracked in-memory even though the audit write failed.
    expect(summary.drifts).toHaveLength(1);
  });
});
