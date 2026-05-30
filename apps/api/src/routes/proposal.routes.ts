import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  ErrorCodes,
  Permissions,
  UserRole,
} from "@nexaflow/shared";
import { ProposalStatus } from "@nexaflow/db";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  generateProposalDraft,
  createProposal,
  listProposals,
  getProposal,
  updateProposalStatus,
  type ProposalBrief,
  type GeneratedProposal,
} from "../services/proposal.service";

const router = Router();

// ============================================================================
// SCHEMAS
// ============================================================================

const briefSchema = z.object({
  prospectName: z.string().min(1).max(120),
  industry: z.string().min(1).max(80),
  goals: z.string().max(800).optional(),
  scale: z.string().max(120).optional(),
  budget: z.string().max(120).optional(),
  currency: z.string().max(8).optional(),
});

const proposalContentSchema = z.object({
  executiveSummary: z.string().max(1200),
  painPoints: z.array(z.string().max(240)).max(6),
  recommendedPlan: z.object({
    name: z.string().max(60),
    priceMonthly: z.number().int().min(0).max(100_000_000),
    currency: z.string().max(8),
    features: z.array(z.string().max(160)).max(10),
  }),
  roiEstimate: z.object({
    summary: z.string().max(600),
    metrics: z
      .array(z.object({ label: z.string().max(60), value: z.string().max(80) }))
      .max(4),
  }),
  timeline: z
    .array(
      z.object({
        phase: z.string().max(60),
        duration: z.string().max(40),
        detail: z.string().max(280),
      }),
    )
    .max(5),
  callToAction: z.string().max(400),
});

const createProposalSchema = z.object({
  brief: briefSchema,
  draft: z.object({
    title: z.string().min(1).max(200),
    content: proposalContentSchema,
    currency: z.string().max(8),
    estimatedValue: z.number().int().min(0).max(100_000_000).nullable().optional(),
    source: z.enum(["ai", "fallback"]),
  }),
});

const statusSchema = z.object({
  status: z.nativeEnum(ProposalStatus),
});

const listSchema = z.object({
  status: z.nativeEnum(ProposalStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ============================================================================
// MIDDLEWARE — partners only (WHITE_LABEL_ADMIN / SUPER_ADMIN via CLIENT_CREATE)
// ============================================================================

router.use(requireAuth, requireTenantScope);
router.use(requirePermission(Permissions.CLIENT_CREATE));

function assertPartnerRole(req: RequestWithAuth): void {
  if (
    req.userRole !== UserRole.SUPER_ADMIN &&
    req.userRole !== UserRole.WHITE_LABEL_ADMIN
  ) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Only partners can manage proposals.",
    );
  }
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/v1/partner/proposals/generate
 *
 * AI Proposal Generator — preview only. Returns a structured draft the
 * partner can review/edit before saving. No DB write. Billed to the
 * partner tenant.
 */
router.post("/generate", async (req: RequestWithAuth, res, next) => {
  try {
    assertPartnerRole(req);
    const brief = briefSchema.parse(req.body) as ProposalBrief;
    const draft = await generateProposalDraft({
      partnerTenantId: req.tenantId!,
      brief,
    });

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "PROPOSAL_GENERATED",
      resource: "PROPOSAL",
      newValues: { prospectName: brief.prospectName, source: draft.source },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: draft });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/partner/proposals
 *
 * Persist a partner-approved proposal draft.
 */
router.post("/", async (req: RequestWithAuth, res, next) => {
  try {
    assertPartnerRole(req);
    const body = createProposalSchema.parse(req.body);
    const proposal = await createProposal({
      partnerTenantId: req.tenantId!,
      createdByUserId: req.userId!,
      brief: body.brief as ProposalBrief,
      draft: body.draft as GeneratedProposal,
    });

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "PROPOSAL_CREATED",
      resource: "PROPOSAL",
      resourceId: proposal.id,
      newValues: {
        prospectName: proposal.prospectName,
        estimatedValue: proposal.estimatedValue,
      },
      ...extractRequestMeta(req),
    });

    res.status(201).json({ success: true, data: proposal });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/partner/proposals
 */
router.get("/", async (req: RequestWithAuth, res, next) => {
  try {
    assertPartnerRole(req);
    const query = listSchema.parse(req.query);
    const proposals = await listProposals({
      partnerTenantId: req.tenantId!,
      status: query.status,
      limit: query.limit,
    });
    res.json({ success: true, data: proposals });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/partner/proposals/:id
 */
router.get("/:id", async (req: RequestWithAuth, res, next) => {
  try {
    assertPartnerRole(req);
    const proposal = await getProposal({
      partnerTenantId: req.tenantId!,
      proposalId: req.params.id,
    });
    res.json({ success: true, data: proposal });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/partner/proposals/:id/status
 *
 * Advance the proposal lifecycle (DRAFT → SENT → ACCEPTED/DECLINED).
 */
router.patch("/:id/status", async (req: RequestWithAuth, res, next) => {
  try {
    assertPartnerRole(req);
    const { status } = statusSchema.parse(req.body);
    const before = await getProposal({
      partnerTenantId: req.tenantId!,
      proposalId: req.params.id,
    });
    const proposal = await updateProposalStatus({
      partnerTenantId: req.tenantId!,
      proposalId: req.params.id,
      status,
    });

    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "PROPOSAL_STATUS_CHANGED",
      resource: "PROPOSAL",
      resourceId: proposal.id,
      oldValues: { status: before.status },
      newValues: { status: proposal.status },
      ...extractRequestMeta(req),
    });

    res.json({ success: true, data: proposal });
  } catch (error) {
    next(error);
  }
});

export default router;
