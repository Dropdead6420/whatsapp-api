// ============================================================================
// AI Proposal Generator (PRD-v2 §6, Sprint 3 slice 4)
//
// Partner submits a prospect brief → Claude drafts a structured sales
// proposal (executive summary, pain points, recommended plan + pricing,
// ROI estimate, implementation timeline, CTA). The partner reviews/edits
// the draft, saves it as a Proposal row, then walks it through the
// DRAFT → SENT → ACCEPTED/DECLINED lifecycle as the deal moves.
//
// The generation step is billed to the partner tenant via the existing
// runTenantLlmJson plumbing. On any LLM failure we fall back to a
// deterministic industry-aware draft so the partner is never blocked.
// ============================================================================

import { prisma, Prisma, ProposalStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface ProposalBrief {
  prospectName: string;
  industry: string;
  goals?: string;
  scale?: string;
  budget?: string;
  currency?: string;
}

export interface ProposalContent {
  executiveSummary: string;
  painPoints: string[];
  recommendedPlan: {
    name: string;
    priceMonthly: number;
    currency: string;
    features: string[];
  };
  roiEstimate: {
    summary: string;
    metrics: Array<{ label: string; value: string }>;
  };
  timeline: Array<{ phase: string; duration: string; detail: string }>;
  callToAction: string;
}

export interface GeneratedProposal {
  title: string;
  content: ProposalContent;
  currency: string;
  estimatedValue: number | null;
  source: "ai" | "fallback";
}

export interface PublicProposal {
  shareToken: string;
  prospectName: string;
  industry: string;
  title: string;
  currency: string;
  estimatedValue: number | null;
  status: ProposalStatus;
  content: ProposalContent;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  partner: {
    name: string;
    domain: string | null;
    logoUrl: string | null;
    brandColors: string | null;
  };
}

const DEFAULT_CURRENCY = "INR";

function clampStr(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function clampList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string" && v.trim())
    .slice(0, maxItems)
    .map((v) => (v as string).trim().slice(0, maxLen));
}

/**
 * Deterministic fallback used when the LLM is unavailable. Industry-aware
 * enough to feel tailored without depending on a model.
 */
function fallbackProposal(brief: ProposalBrief): GeneratedProposal {
  const industry = (brief.industry || "your business").trim();
  const name = clampStr(brief.prospectName, 80, "your team") || "your team";
  const currency = (brief.currency || DEFAULT_CURRENCY).slice(0, 8);
  const priceMonthly = 7999;

  const content: ProposalContent = {
    executiveSummary:
      `${name} can turn WhatsApp into its highest-converting channel. ` +
      `This proposal outlines how NexaFlow automates customer conversations, ` +
      `qualifies leads, and recovers revenue for a ${industry} business — without ` +
      `adding headcount.`,
    painPoints: [
      "Manual replies create slow response times and lost leads after hours.",
      "No single view of customer conversations across the team.",
      "Campaigns go out untracked, so ROI is impossible to prove.",
    ],
    recommendedPlan: {
      name: "Growth",
      priceMonthly,
      currency,
      features: [
        "Shared WhatsApp team inbox with assignment & SLAs",
        "AI agent that answers FAQs and qualifies leads 24/7",
        "Broadcast campaigns with delivery & click analytics",
        "Automation flows for onboarding, reminders, and win-backs",
      ],
    },
    roiEstimate: {
      summary:
        "Most teams recover the subscription cost within the first month through " +
        "faster response times and automated lead capture.",
      metrics: [
        { label: "Response time", value: "↓ from hours to seconds" },
        { label: "Lead capture", value: "↑ 24/7, even after hours" },
        { label: "Agent capacity", value: "↑ 3–4x conversations per agent" },
      ],
    },
    timeline: [
      { phase: "Week 1", duration: "5 days", detail: "Onboarding, WhatsApp number connect, team setup." },
      { phase: "Week 2", duration: "5 days", detail: "AI agent training, flow build, template approval." },
      { phase: "Week 3+", duration: "ongoing", detail: "First campaigns live, analytics review, optimization." },
    ],
    callToAction:
      `Ready to get started? Reply to this proposal and we'll have ${name} live on ` +
      `NexaFlow within a week.`,
  };

  return {
    title: `NexaFlow proposal for ${name}`,
    content,
    currency,
    estimatedValue: priceMonthly,
    source: "fallback",
  };
}

/**
 * Generate a proposal draft from a prospect brief. Billed to the partner
 * tenant. Returns the AI result on success, or a deterministic
 * industry-aware fallback (`source: "fallback"`) on any failure.
 */
export async function generateProposalDraft(args: {
  partnerTenantId: string;
  brief: ProposalBrief;
}): Promise<GeneratedProposal> {
  const { partnerTenantId, brief } = args;
  const currency = (brief.currency || DEFAULT_CURRENCY).slice(0, 8);

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{
      title?: string;
      executiveSummary?: string;
      painPoints?: string[];
      recommendedPlan?: {
        name?: string;
        priceMonthly?: number;
        currency?: string;
        features?: string[];
      };
      roiEstimate?: {
        summary?: string;
        metrics?: Array<{ label?: string; value?: string }>;
      };
      timeline?: Array<{ phase?: string; duration?: string; detail?: string }>;
      callToAction?: string;
    }>({
      tenantId: partnerTenantId,
      feature: "proposal_generator",
      system:
        "You are a NexaFlow solutions consultant writing a sales proposal for a " +
        "partner's prospect. NexaFlow is a WhatsApp Business automation platform " +
        "(team inbox, AI agents, broadcast campaigns, automation flows, analytics). " +
        "Return a JSON object of this exact shape:\n" +
        '{\n' +
        '  "title": "...",\n' +
        '  "executiveSummary": "2-3 sentences",\n' +
        '  "painPoints": ["...", "..."],\n' +
        '  "recommendedPlan": {"name":"...", "priceMonthly":7999, "currency":"INR", "features":["...", "..."]},\n' +
        '  "roiEstimate": {"summary":"...", "metrics":[{"label":"...", "value":"..."}]},\n' +
        '  "timeline": [{"phase":"Week 1", "duration":"5 days", "detail":"..."}],\n' +
        '  "callToAction": "..."\n' +
        "}\n" +
        "Rules: 3-4 pain points, 4-6 plan features, 2-4 ROI metrics, 3 timeline " +
        "phases. Keep the tone confident and concrete. Price in the prospect's " +
        "currency. No markdown, JSON only.",
      prompt: JSON.stringify({ ...brief, currency }),
      maxTokens: 1600,
      temperature: 0.6,
    });

    const planPrice =
      typeof llm.recommendedPlan?.priceMonthly === "number" &&
      llm.recommendedPlan.priceMonthly > 0
        ? Math.floor(llm.recommendedPlan.priceMonthly)
        : 7999;
    const planCurrency = clampStr(llm.recommendedPlan?.currency, 8, currency) || currency;

    const content: ProposalContent = {
      executiveSummary: clampStr(llm.executiveSummary, 1200),
      painPoints: clampList(llm.painPoints, 5, 240),
      recommendedPlan: {
        name: clampStr(llm.recommendedPlan?.name, 60, "Growth") || "Growth",
        priceMonthly: planPrice,
        currency: planCurrency,
        features: clampList(llm.recommendedPlan?.features, 8, 160),
      },
      roiEstimate: {
        summary: clampStr(llm.roiEstimate?.summary, 600),
        metrics: Array.isArray(llm.roiEstimate?.metrics)
          ? llm.roiEstimate!.metrics!
              .filter((m) => m && (m.label || m.value))
              .slice(0, 4)
              .map((m) => ({
                label: clampStr(m.label, 60),
                value: clampStr(m.value, 80),
              }))
          : [],
      },
      timeline: Array.isArray(llm.timeline)
        ? llm.timeline
            .filter((t) => t && (t.phase || t.detail))
            .slice(0, 5)
            .map((t) => ({
              phase: clampStr(t.phase, 60),
              duration: clampStr(t.duration, 40),
              detail: clampStr(t.detail, 280),
            }))
        : [],
      callToAction: clampStr(llm.callToAction, 400),
    };

    // If the model returned nothing usable, prefer the deterministic draft.
    if (!content.executiveSummary && content.painPoints.length === 0) {
      return fallbackProposal(brief);
    }

    return {
      title:
        clampStr(llm.title, 160) ||
        `NexaFlow proposal for ${clampStr(brief.prospectName, 80, "prospect")}`,
      content,
      currency: planCurrency,
      estimatedValue: planPrice,
      source: "ai",
    };
  } catch (err) {
    console.error("[proposal] generation failed:", err);
    return fallbackProposal(brief);
  }
}

/**
 * Persist a proposal draft for the partner. The content is whatever the
 * partner approved (generated, then optionally edited client-side).
 */
export async function createProposal(args: {
  partnerTenantId: string;
  createdByUserId?: string;
  brief: ProposalBrief;
  draft: GeneratedProposal;
}) {
  const { partnerTenantId, createdByUserId, brief, draft } = args;
  return prisma.proposal.create({
    data: {
      partnerTenantId,
      createdByUserId: createdByUserId ?? null,
      prospectName: clampStr(brief.prospectName, 120, "Prospect") || "Prospect",
      industry: clampStr(brief.industry, 80, "general") || "general",
      brief: brief as unknown as Prisma.InputJsonValue,
      content: draft.content as unknown as Prisma.InputJsonValue,
      title: clampStr(draft.title, 200, "Untitled proposal") || "Untitled proposal",
      currency: draft.currency || DEFAULT_CURRENCY,
      estimatedValue: draft.estimatedValue ?? null,
      source: draft.source,
    },
  });
}

export async function listProposals(args: {
  partnerTenantId: string;
  status?: ProposalStatus;
  limit?: number;
}) {
  return prisma.proposal.findMany({
    where: {
      partnerTenantId: args.partnerTenantId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 50,
    select: {
      id: true,
      prospectName: true,
      industry: true,
      title: true,
      currency: true,
      estimatedValue: true,
      status: true,
      source: true,
      shareToken: true,
      sentAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Fetch one proposal, scoped to the owning partner so a partner can never
 * read another partner's proposal by guessing an id.
 */
export async function getProposal(args: {
  partnerTenantId: string;
  proposalId: string;
}) {
  const proposal = await prisma.proposal.findFirst({
    where: { id: args.proposalId, partnerTenantId: args.partnerTenantId },
  });
  if (!proposal) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Proposal not found.");
  }
  return proposal;
}

/**
 * Public, read-only proposal lookup. Draft and declined proposals remain
 * private so partners can safely iterate before sending a prospect link.
 */
export async function getPublicProposalByToken(
  shareToken: string,
): Promise<PublicProposal> {
  const proposal = await prisma.proposal.findUnique({
    where: { shareToken },
    select: {
      shareToken: true,
      prospectName: true,
      industry: true,
      title: true,
      currency: true,
      estimatedValue: true,
      status: true,
      content: true,
      sentAt: true,
      createdAt: true,
      updatedAt: true,
      partnerTenant: {
        select: {
          name: true,
          domain: true,
          logoUrl: true,
          brandColors: true,
        },
      },
    },
  });

  if (
    !proposal ||
    (proposal.status !== ProposalStatus.SENT &&
      proposal.status !== ProposalStatus.ACCEPTED)
  ) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Proposal not found.");
  }

  return {
    shareToken: proposal.shareToken,
    prospectName: proposal.prospectName,
    industry: proposal.industry,
    title: proposal.title,
    currency: proposal.currency,
    estimatedValue: proposal.estimatedValue,
    status: proposal.status,
    content: proposal.content as unknown as ProposalContent,
    sentAt: proposal.sentAt,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    partner: proposal.partnerTenant,
  };
}

const STATUS_ORDER: Record<ProposalStatus, number> = {
  [ProposalStatus.DRAFT]: 0,
  [ProposalStatus.SENT]: 1,
  [ProposalStatus.ACCEPTED]: 2,
  [ProposalStatus.DECLINED]: 2,
};

/**
 * Advance a proposal's lifecycle. Guards against illegal regressions
 * (e.g. ACCEPTED → DRAFT) while allowing ACCEPTED ↔ DECLINED correction.
 */
export async function updateProposalStatus(args: {
  partnerTenantId: string;
  proposalId: string;
  status: ProposalStatus;
}) {
  const existing = await getProposal({
    partnerTenantId: args.partnerTenantId,
    proposalId: args.proposalId,
  });

  const isTerminalSwap =
    STATUS_ORDER[existing.status] === 2 && STATUS_ORDER[args.status] === 2;
  if (
    !isTerminalSwap &&
    STATUS_ORDER[args.status] < STATUS_ORDER[existing.status]
  ) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Cannot move proposal from ${existing.status} back to ${args.status}.`,
    );
  }

  return prisma.proposal.update({
    where: { id: existing.id },
    data: {
      status: args.status,
      sentAt:
        args.status === ProposalStatus.SENT && !existing.sentAt
          ? new Date()
          : existing.sentAt,
    },
  });
}
