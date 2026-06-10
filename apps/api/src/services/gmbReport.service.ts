import { prisma, GmbReportType, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { getReputationSummary } from "./gmbReview.service";
import { getInsightsSummary } from "./gmbInsights.service";
import { getCitationSummary } from "./gmbCitation.service";
import { rankBucket } from "./gmbRanking.service";

// =====================================================================
// AdGrowly GMB — Reports (planning PDF §3 Reports + §2 AI Monthly Report). A
// report aggregates reputation / insights / ranking / citations / posts for a
// period into a stored snapshot, then derives a narrative summary and an
// action plan. The narrative/plan are deterministic (LLM-swappable later) so
// they stay unit-testable offline. DB ops are tenant-scoped.
// =====================================================================

export interface ReportSnapshot {
  reviews: { count: number; average: number; unanswered: number };
  insights: { totalViews: number; totalActions: number; actionRate: number };
  ranking: { trackedKeywords: number; top3: number; top10: number; notFound: number };
  citations: { total: number; consistent: number };
  posts: { created: number };
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  area: "reputation" | "ranking" | "citations" | "content";
  task: string;
}

/** Deterministic narrative summary of a period's GMB performance. */
export function buildReportNarrative(s: ReportSnapshot): string {
  const actionPct = Math.round(s.insights.actionRate * 100);
  return [
    `You collected ${s.reviews.count} review(s) at an average of ${s.reviews.average}★, with ${s.reviews.unanswered} awaiting a reply.`,
    `Your profile drew ${s.insights.totalViews} views and ${s.insights.totalActions} customer actions (${actionPct}% action rate).`,
    `Of ${s.ranking.trackedKeywords} tracked keyword(s), ${s.ranking.top3} rank in the top 3 and ${s.ranking.top10} in the top 10.`,
    `${s.citations.consistent}/${s.citations.total} citation(s) are NAP-consistent.`,
    `You published ${s.posts.created} post(s) this period.`,
  ].join(" ");
}

/** Derive a prioritized action plan from the gaps in a snapshot. */
export function buildActionPlan(s: ReportSnapshot): ActionItem[] {
  const plan: ActionItem[] = [];
  if (s.reviews.unanswered > 0) {
    plan.push({ priority: "high", area: "reputation", task: `Reply to ${s.reviews.unanswered} unanswered review(s).` });
  }
  if (s.reviews.count > 0 && s.reviews.average < 4) {
    plan.push({ priority: "high", area: "reputation", task: "Run a review-request campaign to lift your rating above 4.0." });
  }
  if (s.ranking.trackedKeywords === 0) {
    plan.push({ priority: "medium", area: "ranking", task: "Add target keywords to start tracking local rank." });
  } else if (s.ranking.top3 < s.ranking.trackedKeywords) {
    plan.push({ priority: "medium", area: "ranking", task: "Optimize posts and categories for keywords not yet in the top 3." });
  }
  const badCitations = s.citations.total - s.citations.consistent;
  if (badCitations > 0) {
    plan.push({ priority: "medium", area: "citations", task: `Fix NAP on ${badCitations} inconsistent or missing citation(s).` });
  }
  if (s.posts.created < 4) {
    plan.push({ priority: "low", area: "content", task: "Publish at least weekly Google posts to stay active." });
  }
  return plan;
}

interface ReportRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  type: GmbReportType;
  periodStart: Date;
  periodEnd: Date;
  data: Prisma.JsonValue;
  summary: string | null;
  actionPlan: Prisma.JsonValue | null;
  createdAt: Date;
}

/** Safe view — never leaks tenantId or the generator's user id. */
export function toSafeReport(row: ReportRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    type: row.type,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    data: row.data,
    summary: row.summary,
    actionPlan: row.actionPlan,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function assertLocationOwned(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({ where: { id: locationId, tenantId }, select: { id: true } });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
}

async function aggregateRanking(tenantId: string, locationId?: string) {
  const keywords = await prisma.gmbTrackedKeyword.findMany({
    where: { tenantId, isActive: true, ...(locationId ? { locationId } : {}) },
    include: { snapshots: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });
  let top3 = 0;
  let top10 = 0;
  let notFound = 0;
  for (const k of keywords) {
    const latest = k.snapshots[0]?.rank ?? null;
    const bucket = rankBucket(latest);
    if (bucket === "top3") top3 += 1;
    else if (bucket === "top10") top10 += 1;
    else if (bucket === "not_found") notFound += 1;
  }
  return { trackedKeywords: keywords.length, top3, top10, notFound };
}

export interface GenerateReportInput {
  locationId?: string;
  type?: GmbReportType;
  periodStart: string;
  periodEnd: string;
  generatedByUserId?: string;
}

export async function generateReport(tenantId: string, input: GenerateReportInput) {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid period dates.");
  }
  if (periodEnd < periodStart) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "periodEnd must be on or after periodStart.");
  }
  if (input.locationId) await assertLocationOwned(tenantId, input.locationId);

  const [reviews, insights, citations, ranking, posts] = await Promise.all([
    getReputationSummary(tenantId, input.locationId),
    getInsightsSummary(tenantId, { locationId: input.locationId, from: input.periodStart, to: input.periodEnd }),
    getCitationSummary(tenantId, input.locationId),
    aggregateRanking(tenantId, input.locationId),
    prisma.gmbPost.count({ where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } } }),
  ]);

  const snapshot: ReportSnapshot = {
    reviews: { count: reviews.count, average: reviews.average, unanswered: reviews.unanswered },
    insights: {
      totalViews: insights.totalViews,
      totalActions: insights.totalActions,
      actionRate: insights.actionRate,
    },
    ranking,
    citations: { total: citations.total, consistent: citations.consistent },
    posts: { created: posts },
  };
  // Store the full module summaries (richer than the snapshot) for the UI.
  const data = { reviews, insights, citations, ranking, posts: { created: posts } };
  const summary = buildReportNarrative(snapshot);
  const actionPlan = buildActionPlan(snapshot);

  const row = await prisma.gmbReport.create({
    data: {
      tenantId,
      locationId: input.locationId ?? null,
      type: input.type ?? GmbReportType.MONTHLY,
      periodStart,
      periodEnd,
      data: data as unknown as Prisma.InputJsonValue,
      summary,
      actionPlan: actionPlan as unknown as Prisma.InputJsonValue,
      generatedByUserId: input.generatedByUserId ?? null,
    },
  });
  return toSafeReport(row);
}

export interface ListReportsFilter {
  locationId?: string;
  type?: GmbReportType;
}

export async function listReports(tenantId: string, filter: ListReportsFilter = {}) {
  const rows = await prisma.gmbReport.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeReport);
}

async function findReportOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbReport.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
  return row;
}

export async function getReport(tenantId: string, id: string) {
  return toSafeReport(await findReportOrThrow(tenantId, id));
}

export async function deleteReport(tenantId: string, id: string) {
  await findReportOrThrow(tenantId, id);
  await prisma.gmbReport.delete({ where: { id } });
}
