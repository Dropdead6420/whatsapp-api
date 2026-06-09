import { prisma, GmbReviewStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly GMB — Reputation service (planning PDF). Reviews are anchored to
// a GmbLocation and carry an AI-assisted reply draft (generate-then-approve):
// `buildReviewReplyDraft` produces a sentiment-tailored draft locally; the
// LLM gateway can swap in here later without changing the route contract.
// Pure helpers are split out for unit testing (no Prisma in tests).
// =====================================================================

interface ReviewRow {
  id: string;
  tenantId: string;
  locationId: string;
  externalReviewId: string | null;
  authorName: string | null;
  rating: number;
  comment: string | null;
  reviewedAt: Date | null;
  status: GmbReviewStatus;
  replyText: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — never leaks tenantId or the external sync id. */
export function toSafeReview(row: ReviewRow) {
  return {
    id: row.id,
    locationId: row.locationId,
    authorName: row.authorName,
    rating: row.rating,
    comment: row.comment,
    reviewedAt: row.reviewedAt,
    status: row.status,
    replyText: row.replyText,
    repliedAt: row.repliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ReviewSentiment = "positive" | "neutral" | "negative";

export function ratingSentiment(rating: number): ReviewSentiment {
  if (rating >= 4) return "positive";
  if (rating <= 2) return "negative";
  return "neutral";
}

export interface ReviewReplyInput {
  businessName: string;
  rating: number;
  authorName?: string | null;
  comment?: string | null;
  tone?: "warm" | "professional";
}

/**
 * Deterministic, sentiment-aware reply draft. Returned to the operator to
 * edit/approve before sending — we never auto-publish a reply. Kept pure so
 * it is fully unit-testable and works offline.
 */
export function buildReviewReplyDraft(input: ReviewReplyInput): {
  reply: string;
  sentiment: ReviewSentiment;
} {
  const business = input.businessName.trim() || "our team";
  const firstName = (input.authorName ?? "").trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const tone = input.tone ?? "warm";
  const sentiment = ratingSentiment(input.rating);

  let body: string;
  if (sentiment === "positive") {
    body =
      tone === "professional"
        ? `thank you for the ${input.rating}-star review. We appreciate you taking the time to share your experience with ${business}, and we look forward to serving you again.`
        : `thank you so much for the wonderful ${input.rating}-star review! It means a lot to everyone at ${business}, and we can't wait to welcome you back. 🙌`;
  } else if (sentiment === "neutral") {
    body = `thank you for your feedback. We're glad you visited ${business}, and we'd love to learn how we can make your next experience a 5-star one — please reach out to us directly so we can help.`;
  } else {
    body = `thank you for letting us know, and we're sorry your experience with ${business} fell short. This isn't the standard we hold ourselves to. We'd like to make it right — please contact us directly so we can resolve this for you.`;
  }

  return { reply: `${greeting} ${body}`.trim(), sentiment };
}

export interface ReputationSummary {
  count: number;
  average: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  unanswered: number;
}

/** Pure aggregate over rating+status rows — drives the reputation dashboard. */
export function summarizeReviews(
  rows: Array<{ rating: number; status: GmbReviewStatus }>,
): ReputationSummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let unanswered = 0;
  for (const r of rows) {
    const bucket = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    distribution[bucket] += 1;
    total += r.rating;
    if (r.status === GmbReviewStatus.NEW) unanswered += 1;
  }
  const count = rows.length;
  const average = count ? Math.round((total / count) * 100) / 100 : 0;
  return { count, average, distribution, unanswered };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

async function findLocationOrThrow(tenantId: string, locationId: string) {
  const loc = await prisma.gmbLocation.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true, name: true },
  });
  if (!loc) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Location not found.");
  return loc;
}

async function findReviewOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbReview.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Review not found.");
  return row;
}

export interface ListReviewsFilter {
  locationId?: string;
  status?: GmbReviewStatus;
}

export async function listReviews(tenantId: string, filter: ListReviewsFilter = {}) {
  const rows = await prisma.gmbReview.findMany({
    where: {
      tenantId,
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toSafeReview);
}

export interface IngestReviewInput {
  locationId: string;
  rating: number;
  authorName?: string;
  comment?: string;
  reviewedAt?: string;
  externalReviewId?: string;
  createdByUserId?: string;
}

export async function ingestReview(tenantId: string, input: IngestReviewInput) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Rating must be an integer from 1 to 5.");
  }
  await findLocationOrThrow(tenantId, input.locationId);
  const row = await prisma.gmbReview.create({
    data: {
      tenantId,
      locationId: input.locationId,
      rating: input.rating,
      authorName: input.authorName?.trim() || null,
      comment: input.comment?.trim() || null,
      reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
      externalReviewId: input.externalReviewId?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeReview(row);
}

export async function getReview(tenantId: string, id: string) {
  return toSafeReview(await findReviewOrThrow(tenantId, id));
}

/**
 * Build (but do not save) a reply draft for a review, using the linked
 * location's name as the business name. Returns the draft for the operator
 * to edit and approve via `replyToReview`.
 */
export async function generateReplyDraft(
  tenantId: string,
  id: string,
  tone?: "warm" | "professional",
) {
  const review = await findReviewOrThrow(tenantId, id);
  const location = await prisma.gmbLocation.findFirst({
    where: { id: review.locationId, tenantId },
    select: { name: true },
  });
  const draft = buildReviewReplyDraft({
    businessName: location?.name ?? "our team",
    rating: review.rating,
    authorName: review.authorName,
    comment: review.comment,
    tone,
  });
  return { reviewId: review.id, ...draft };
}

export async function replyToReview(tenantId: string, id: string, text: string) {
  const reply = text.trim();
  if (!reply) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Reply text is required.");
  }
  await findReviewOrThrow(tenantId, id);
  const row = await prisma.gmbReview.update({
    where: { id },
    data: { replyText: reply, status: GmbReviewStatus.REPLIED, repliedAt: new Date() },
  });
  return toSafeReview(row);
}

export async function updateReviewStatus(tenantId: string, id: string, status: GmbReviewStatus) {
  await findReviewOrThrow(tenantId, id);
  const row = await prisma.gmbReview.update({ where: { id }, data: { status } });
  return toSafeReview(row);
}

export async function deleteReview(tenantId: string, id: string) {
  await findReviewOrThrow(tenantId, id);
  await prisma.gmbReview.delete({ where: { id } });
}

export async function getReputationSummary(tenantId: string, locationId?: string) {
  if (locationId) await findLocationOrThrow(tenantId, locationId);
  const rows = await prisma.gmbReview.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    select: { rating: true, status: true },
  });
  return summarizeReviews(rows);
}
