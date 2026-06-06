import { prisma, GmbPostStatus, GmbPostType } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// GMB AI Manager service (Complete Planning PDF §2.19, Phase 11).
// Tenant-scoped Google Business Profile posts: AI-drafted captions +
// scheduling + draft→published lifecycle. Pure caption generation is
// split out for unit testing; live publishing to Google lands once the
// Business Profile OAuth connection exists.
// =====================================================================

export const GMB_CTA_TYPES = [
  "LEARN_MORE",
  "CALL",
  "ORDER",
  "BOOK",
  "SIGN_UP",
  "SHOP",
] as const;
export type GmbCtaType = (typeof GMB_CTA_TYPES)[number];

// ---------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------

export interface CaptionInput {
  businessName: string;
  type?: GmbPostType;
  topic?: string; // the offer / event / update subject
  tone?: "friendly" | "professional" | "playful";
}

export interface CaptionDraft {
  type: GmbPostType;
  summary: string;
  callToActionType: GmbCtaType;
}

/** Draft a Business-Profile post caption. Deterministic + template-based. */
export function buildGmbCaption(input: CaptionInput): CaptionDraft {
  const name = input.businessName.trim() || "We";
  const type = input.type ?? GmbPostType.UPDATE;
  const topic = input.topic?.trim();
  const playful = input.tone === "playful";

  if (type === GmbPostType.OFFER) {
    const body = topic || "a limited-time deal";
    return {
      type,
      summary: `${playful ? "🎉 " : ""}Special offer at ${name}: ${body}. Don't miss out — visit us today!`,
      callToActionType: "ORDER",
    };
  }
  if (type === GmbPostType.EVENT) {
    const body = topic || "an upcoming event";
    return {
      type,
      summary: `${playful ? "📅 " : ""}${name} invites you to ${body}. Save the date and join us!`,
      callToActionType: "LEARN_MORE",
    };
  }
  const body = topic || "something new to share";
  return {
    type: GmbPostType.UPDATE,
    summary: `${playful ? "✨ " : ""}News from ${name}: ${body}. Reach out to learn more.`,
    callToActionType: "LEARN_MORE",
  };
}

interface PostRow {
  id: string;
  tenantId: string;
  type: GmbPostType;
  summary: string;
  mediaUrl: string | null;
  callToActionType: string | null;
  callToActionUrl: string | null;
  locationLabel: string | null;
  scheduledAt: Date | null;
  status: GmbPostStatus;
  publishedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeGmbPost(row: PostRow) {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    mediaUrl: row.mediaUrl,
    callToActionType: row.callToActionType,
    callToActionUrl: row.callToActionUrl,
    locationLabel: row.locationLabel,
    scheduledAt: row.scheduledAt,
    status: row.status,
    publishedAt: row.publishedAt,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertCta(cta: string | null | undefined): void {
  if (cta && !GMB_CTA_TYPES.includes(cta as GmbCtaType)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unsupported call-to-action "${cta}".`,
    );
  }
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export async function listPosts(tenantId: string, status?: GmbPostStatus) {
  const rows = await prisma.gmbPost.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toSafeGmbPost);
}

export interface CreatePostInput {
  type?: GmbPostType;
  summary: string;
  mediaUrl?: string;
  callToActionType?: string;
  callToActionUrl?: string;
  locationLabel?: string;
  scheduledAt?: string | Date | null;
  createdByUserId?: string;
}

export async function createPost(tenantId: string, input: CreatePostInput) {
  const summary = input.summary.trim();
  if (!summary) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A post summary is required.");
  }
  if (summary.length > 1500) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Summary exceeds 1500 characters.");
  }
  assertCta(input.callToActionType);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

  const row = await prisma.gmbPost.create({
    data: {
      tenantId,
      type: input.type ?? GmbPostType.UPDATE,
      summary,
      mediaUrl: input.mediaUrl ?? null,
      callToActionType: input.callToActionType ?? null,
      callToActionUrl: input.callToActionUrl ?? null,
      locationLabel: input.locationLabel ?? null,
      scheduledAt,
      status: scheduledAt ? GmbPostStatus.SCHEDULED : GmbPostStatus.DRAFT,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeGmbPost(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbPost.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "GMB post not found.");
  return row;
}

export async function getPost(tenantId: string, id: string) {
  return toSafeGmbPost(await findOwnedOrThrow(tenantId, id));
}

export interface UpdatePostInput {
  type?: GmbPostType;
  summary?: string;
  mediaUrl?: string | null;
  callToActionType?: string | null;
  callToActionUrl?: string | null;
  locationLabel?: string | null;
}

export async function updatePost(tenantId: string, id: string, input: UpdatePostInput) {
  await findOwnedOrThrow(tenantId, id);
  if (input.callToActionType !== undefined) assertCta(input.callToActionType);
  if (input.summary !== undefined && input.summary.trim().length > 1500) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Summary exceeds 1500 characters.");
  }
  const row = await prisma.gmbPost.update({
    where: { id },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.callToActionType !== undefined ? { callToActionType: input.callToActionType } : {}),
      ...(input.callToActionUrl !== undefined ? { callToActionUrl: input.callToActionUrl } : {}),
      ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
    },
  });
  return toSafeGmbPost(row);
}

export async function schedulePost(tenantId: string, id: string, when: string | Date) {
  await findOwnedOrThrow(tenantId, id);
  const scheduledAt = new Date(when);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid schedule time.");
  }
  const row = await prisma.gmbPost.update({
    where: { id },
    data: { scheduledAt, status: GmbPostStatus.SCHEDULED, error: null },
  });
  return toSafeGmbPost(row);
}

export async function deletePost(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbPost.delete({ where: { id } });
}
