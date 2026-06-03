import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletType } from "@nexaflow/shared";

const mocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn(),
  adjustWalletIdempotent: vi.fn(),
  ensureWallet: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    wallet: {
      findUnique: mocks.walletFindUnique,
    },
  },
}));

vi.mock("./wallet.service", () => ({
  adjustWalletIdempotent: mocks.adjustWalletIdempotent,
  ensureWallet: mocks.ensureWallet,
}));

describe("billing.service wallet type split", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WALLET_BILLING_ENABLED = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("debits WhatsApp sends from the WhatsApp usage wallet", async () => {
    const { debitMessage } = await import("./billing.service");

    await debitMessage("tenant_1", "wamid_1");

    expect(mocks.adjustWalletIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_1",
        walletType: WalletType.WHATSAPP_USAGE,
        type: "MESSAGE_DEBIT",
        referenceType: "Message",
        referenceId: "wamid_1",
      }),
    );
  });

  it("debits AI calls from the AI credit wallet", async () => {
    const { debitAi } = await import("./billing.service");

    await debitAi("tenant_1", {
      aiUsageId: "ai_usage_1",
      feature: "reply_suggestions",
    });

    expect(mocks.adjustWalletIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_1",
        walletType: WalletType.AI_CREDIT,
        type: "AI_DEBIT",
        referenceType: "AiUsage",
        referenceId: "ai_usage_1",
      }),
    );
  });

  it("creates an empty AI credit wallet on first AI affordability check", async () => {
    mocks.walletFindUnique.mockResolvedValue(null);
    mocks.ensureWallet.mockResolvedValue({
      id: "wallet_ai_1",
      tenantId: "tenant_1",
      type: WalletType.AI_CREDIT,
      balanceCredits: 0,
    });

    const { assertCanAffordAi } = await import("./billing.service");

    await expect(assertCanAffordAi("tenant_1", "ai_agent")).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(mocks.walletFindUnique).toHaveBeenCalledWith({
      where: {
        tenantId_type: {
          tenantId: "tenant_1",
          type: WalletType.AI_CREDIT,
        },
      },
    });
    expect(mocks.ensureWallet).toHaveBeenCalledWith("tenant_1", WalletType.AI_CREDIT);
  });
});
