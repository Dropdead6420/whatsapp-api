// ============================================================================
// SuperAdmin Partners overview (admin console "Partners Wallet Management").
// Read-only: lists every partner with wallet balance + org counts. SUPER_ADMIN
// only. No mutations here — credit top-ups live in the existing wallet/recharge
// routes.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole, WalletType, WalletTransactionType, WalletTransactionDirection } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { listPartnerOverview } from "../services/partnerOverview.service";
import { adjustWallet } from "../services/wallet.service";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listPartnerOverview() });
  } catch (err) {
    next(err);
  }
});

const creditSchema = z.object({
  amountCredits: z.number().int().positive().max(100_000_000),
  reason: z.string().trim().min(1).max(200),
});

// Add Amount/Credits — manually top up a partner's PARTNER_CREDIT wallet through
// the same audited WalletTransaction ledger as recharges (MANUAL_ADJUSTMENT).
router.post("/:tenantId/credit", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { amountCredits, reason } = creditSchema.parse(req.body);
    const { wallet } = await adjustWallet({
      tenantId: req.params.tenantId,
      walletType: WalletType.PARTNER_CREDIT,
      actorUserId: req.userId,
      type: WalletTransactionType.MANUAL_ADJUSTMENT,
      direction: WalletTransactionDirection.CREDIT,
      amountCredits,
      reason: reason.trim(),
    });
    await logAudit({
      tenantId: req.params.tenantId,
      userId: req.userId!,
      action: "UPDATE",
      resource: "Wallet",
      resourceId: wallet.id,
      newValues: { manualCredit: amountCredits, reason: reason.trim(), balanceAfter: wallet.balanceCredits },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { tenantId: req.params.tenantId, balanceCredits: wallet.balanceCredits } });
  } catch (err) {
    next(err);
  }
});

export default router;
