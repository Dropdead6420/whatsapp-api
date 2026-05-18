import { Prisma, prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  WalletBillingMode,
  WalletStatus,
  WalletTransactionDirection,
  WalletTransactionType,
} from "@nexaflow/shared";

type Tx = Prisma.TransactionClient;

export interface WalletEntryInput {
  tenantId: string;
  actorUserId?: string | null;
  type: WalletTransactionType;
  direction: WalletTransactionDirection;
  amountCredits: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  counterpartyWalletId?: string | null;
  metadata?: Record<string, unknown> | null;
}

function assertPositiveCredits(amountCredits: number): void {
  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "amountCredits must be a positive integer.",
    );
  }
}

async function ensureWalletTx(tx: Tx, tenantId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }

  return tx.wallet.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
}

async function applyWalletEntryTx(tx: Tx, input: WalletEntryInput) {
  assertPositiveCredits(input.amountCredits);
  const wallet = await ensureWalletTx(tx, input.tenantId);

  if (wallet.status !== WalletStatus.ACTIVE) {
    throw new ApiError(ErrorCodes.FORBIDDEN, 403, "Wallet is suspended.");
  }

  const signedAmount =
    input.direction === WalletTransactionDirection.CREDIT
      ? input.amountCredits
      : -input.amountCredits;
  const nextBalance = wallet.balanceCredits + signedAmount;

  if (
    input.direction === WalletTransactionDirection.DEBIT &&
    wallet.billingMode === WalletBillingMode.PREPAID &&
    nextBalance < 0
  ) {
    throw new ApiError(ErrorCodes.QUOTA_EXCEEDED, 402, "Insufficient wallet credits.");
  }

  if (
    input.direction === WalletTransactionDirection.DEBIT &&
    wallet.billingMode === WalletBillingMode.POSTPAID &&
    nextBalance < -wallet.creditLimit
  ) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      402,
      "Wallet credit line limit exceeded.",
    );
  }

  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balanceCredits: nextBalance },
  });

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      direction: input.direction,
      amountCredits: input.amountCredits,
      balanceAfterCredits: nextBalance,
      reason: input.reason,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      counterpartyWalletId: input.counterpartyWalletId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  return { wallet: updated, transaction };
}

export async function ensureWallet(tenantId: string) {
  return prisma.$transaction((tx) => ensureWalletTx(tx, tenantId), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function adjustWallet(input: WalletEntryInput) {
  return prisma.$transaction((tx) => applyWalletEntryTx(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function transferWalletCredits(input: {
  fromTenantId: string;
  toTenantId: string;
  amountCredits: number;
  reason: string;
  actorUserId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}) {
  assertPositiveCredits(input.amountCredits);
  if (input.fromTenantId === input.toTenantId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Transfer source and destination must be different tenants.",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const fromWallet = await ensureWalletTx(tx, input.fromTenantId);
      const toWallet = await ensureWalletTx(tx, input.toTenantId);

      const out = await applyWalletEntryTx(tx, {
        tenantId: input.fromTenantId,
        actorUserId: input.actorUserId,
        type: WalletTransactionType.TRANSFER_OUT,
        direction: WalletTransactionDirection.DEBIT,
        amountCredits: input.amountCredits,
        reason: input.reason,
        referenceType: input.referenceType ?? "WalletTransfer",
        referenceId: input.referenceId ?? null,
        counterpartyWalletId: toWallet.id,
      });

      const incoming = await applyWalletEntryTx(tx, {
        tenantId: input.toTenantId,
        actorUserId: input.actorUserId,
        type: WalletTransactionType.TRANSFER_IN,
        direction: WalletTransactionDirection.CREDIT,
        amountCredits: input.amountCredits,
        reason: input.reason,
        referenceType: input.referenceType ?? "WalletTransfer",
        referenceId: input.referenceId ?? out.transaction.id,
        counterpartyWalletId: fromWallet.id,
      });

      return { from: out, to: incoming };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateWalletSettings(input: {
  tenantId: string;
  status?: WalletStatus;
  billingMode?: WalletBillingMode;
  creditLimit?: number;
  lowBalanceThreshold?: number;
  autoRechargeEnabled?: boolean;
}) {
  return prisma.$transaction(
    async (tx) => {
      const wallet = await ensureWalletTx(tx, input.tenantId);
      return tx.wallet.update({
        where: { id: wallet.id },
        data: {
          status: input.status,
          billingMode: input.billingMode,
          creditLimit: input.creditLimit,
          lowBalanceThreshold: input.lowBalanceThreshold,
          autoRechargeEnabled: input.autoRechargeEnabled,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
