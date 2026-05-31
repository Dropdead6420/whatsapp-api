import { Router } from "express";
import { z } from "zod";
import { getPublicProposalByToken } from "../services/proposal.service";

const router = Router();

const tokenSchema = z.string().trim().min(12).max(80);

/**
 * GET /api/v1/public/proposals/:shareToken
 *
 * Unauthenticated read-only proposal share page. The service only exposes
 * SENT/ACCEPTED proposals; drafts and declined proposals return 404.
 */
router.get("/proposals/:shareToken", async (req, res, next) => {
  try {
    const shareToken = tokenSchema.parse(req.params.shareToken);
    const proposal = await getPublicProposalByToken(shareToken);
    res.json({ success: true, data: proposal });
  } catch (error) {
    next(error);
  }
});

export default router;
