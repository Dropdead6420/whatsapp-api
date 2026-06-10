// ============================================================================
// Credit Engine (AdGrowly planning PDF §4). SUPER_ADMIN defines the credit
// cost of each AI/usage action; the app prices actions from the active rules.
// No hardcoded credit rules. Every mutation is audited.
// ============================================================================

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  KNOWN_CREDIT_ACTIONS,
  createRule,
  deleteRule,
  getCostMap,
  getRule,
  listRules,
  updateRule,
} from "../services/creditRule.service";

const router = Router();
router.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

const listQuerySchema = z.object({ activeOnly: z.coerce.boolean().optional() });

const createSchema = z.object({
  action: z.string().trim().min(2).max(80),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  cost: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean().optional(),
});

const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    cost: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { activeOnly } = listQuerySchema.parse(req.query);
    res.json({ success: true, data: await listRules(activeOnly) });
  } catch (err) {
    next(err);
  }
});

// Convenience: known action suggestions for the admin UI (costs stay admin-set).
router.get("/actions", async (_req: RequestWithAuth, res: Response) => {
  res.json({ success: true, data: KNOWN_CREDIT_ACTIONS });
});

// Convenience: { action: cost } map of active rules for pricing.
router.get("/cost-map", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getCostMap() });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rule = await createRule({ ...createSchema.parse(req.body), updatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "CreditRule",
      resourceId: rule.id,
      newValues: { action: rule.action, cost: rule.cost },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getRule(req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const rule = await updateRule(req.params.id, { ...body, updatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CreditRule",
      resourceId: rule.id,
      newValues: { fieldsUpdated: Object.keys(body), cost: rule.cost },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteRule(req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "CreditRule",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
