import { prisma, LandingPageStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// Landing Page / AI Website Builder service (Complete Planning PDF §2.16,
// Phase 10). Tenant-scoped, block-based pages with a draft → published
// lifecycle and a unique per-tenant slug. Pure helpers (slugify, block
// normalisation, safe view) are split out for unit testing.
// =====================================================================

export const BLOCK_TYPES = [
  "hero",
  "features",
  "cta",
  "text",
  "image",
  "gallery",
  "video",
  "testimonial",
  "faq",
  "contact",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface PageBlock {
  type: BlockType;
  props: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------

/** URL-safe slug: lowercased, non-alphanumerics collapsed to single dashes. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (!slug) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Could not derive a slug — provide a title or slug with letters or numbers.",
    );
  }
  return slug;
}

/** Validate + coerce the blocks array. Null/empty → []. */
export function normalizeBlocks(input: unknown): PageBlock[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "blocks must be an array.");
  }
  if (input.length > 100) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Too many blocks (max 100).");
  }
  return input.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Block ${i} must be an object.`);
    }
    const type = (raw as { type?: unknown }).type;
    if (typeof type !== "string" || !BLOCK_TYPES.includes(type as BlockType)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Block ${i} has an unsupported type "${String(type)}".`,
      );
    }
    const props = (raw as { props?: unknown }).props;
    return {
      type: type as BlockType,
      props: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
    };
  });
}

interface PageRow {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  blocks: unknown;
  theme: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  status: LandingPageStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeLandingPage(row: PageRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    title: row.title,
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    theme: row.theme ?? null,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    status: row.status,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export interface ListPagesFilter {
  status?: LandingPageStatus;
  search?: string;
}

export async function listPages(tenantId: string, filter: ListPagesFilter = {}) {
  const rows = await prisma.landingPage.findMany({
    where: {
      tenantId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: "insensitive" } },
              { slug: { contains: filter.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toSafeLandingPage);
}

export interface CreatePageInput {
  title: string;
  slug?: string;
  blocks?: unknown;
  theme?: unknown;
  seoTitle?: string;
  seoDescription?: string;
  createdByUserId?: string;
}

export async function createPage(tenantId: string, input: CreatePageInput) {
  const title = input.title.trim();
  if (!title) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A title is required.");
  }
  const slug = slugify(input.slug?.trim() || title);
  const blocks = normalizeBlocks(input.blocks);

  const clash = await prisma.landingPage.findFirst({
    where: { tenantId, slug },
    select: { id: true },
  });
  if (clash) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      `A page with the slug "${slug}" already exists.`,
    );
  }

  const row = await prisma.landingPage.create({
    data: {
      tenantId,
      slug,
      title,
      blocks: blocks as object,
      theme: (input.theme ?? undefined) as object | undefined,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeLandingPage(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.landingPage.findFirst({ where: { id, tenantId } });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Landing page not found.");
  }
  return row;
}

export async function getPage(tenantId: string, id: string) {
  return toSafeLandingPage(await findOwnedOrThrow(tenantId, id));
}

export interface UpdatePageInput {
  title?: string;
  slug?: string;
  blocks?: unknown;
  theme?: unknown;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function updatePage(tenantId: string, id: string, input: UpdatePageInput) {
  await findOwnedOrThrow(tenantId, id);

  let slug: string | undefined;
  if (input.slug !== undefined) {
    slug = slugify(input.slug);
    const clash = await prisma.landingPage.findFirst({
      where: { tenantId, slug, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError(ErrorCodes.CONFLICT, 409, `Slug "${slug}" is already in use.`);
    }
  }

  const row = await prisma.landingPage.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(input.blocks !== undefined ? { blocks: normalizeBlocks(input.blocks) as object } : {}),
      ...(input.theme !== undefined ? { theme: (input.theme ?? undefined) as object | undefined } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle?.trim() || null } : {}),
      ...(input.seoDescription !== undefined
        ? { seoDescription: input.seoDescription?.trim() || null }
        : {}),
    },
  });
  return toSafeLandingPage(row);
}

export async function publishPage(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.landingPage.update({
    where: { id },
    data: { status: LandingPageStatus.PUBLISHED, publishedAt: new Date(), archivedAt: null },
  });
  return toSafeLandingPage(row);
}

export async function archivePage(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.landingPage.update({
    where: { id },
    data: { status: LandingPageStatus.ARCHIVED, archivedAt: new Date() },
  });
  return toSafeLandingPage(row);
}

export async function deletePage(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.landingPage.delete({ where: { id } });
}

/** Public lookup for the renderer: only returns PUBLISHED pages. */
export async function getPublishedPage(tenantId: string, slug: string) {
  const row = await prisma.landingPage.findFirst({
    where: { tenantId, slug, status: LandingPageStatus.PUBLISHED },
  });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Published page not found.");
  }
  return toSafeLandingPage(row);
}
