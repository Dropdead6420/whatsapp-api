import { prisma, CmsContentType, CmsContentStatus, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly / platform — CMS Manager (planning PDF §4). Global, SUPER_ADMIN-
// curated site content (pages, blogs, FAQs, testimonials, legal, SEO meta).
// The public marketing surface reads only PUBLISHED rows via a projected
// public view. Pure helpers (slugify / sort / public projection) are
// unit-tested; DB ops are platform-scoped.
// =====================================================================

/** URL-safe slug: lowercase, non-alphanumerics → single dashes, trimmed. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

interface ContentRow {
  id: string;
  type: CmsContentType;
  slug: string;
  locale: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  data: Prisma.JsonValue | null;
  metaTitle: string | null;
  metaDescription: string | null;
  status: CmsContentStatus;
  sortOrder: number;
  publishedAt: Date | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Admin view — full record minus the internal editor id. */
export function toAdminContent(row: ContentRow) {
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    data: row.data,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    status: row.status,
    sortOrder: row.sortOrder,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Public view — omits status / sortOrder / editor / internal timestamps. */
export function toPublicContent(row: ContentRow) {
  return {
    type: row.type,
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    data: row.data,
    metaTitle: row.metaTitle ?? row.title,
    metaDescription: row.metaDescription ?? row.excerpt,
    publishedAt: row.publishedAt,
  };
}

export function isPublished(row: { status: CmsContentStatus }): boolean {
  return row.status === CmsContentStatus.PUBLISHED;
}

/** Stable ordering for lists/grids: sortOrder asc, then title asc. */
export function sortContent<T extends { sortOrder: number; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------
// DB-backed operations (platform-scoped — SUPER_ADMIN for writes)
// ---------------------------------------------------------------------

export interface ListContentFilter {
  type?: CmsContentType;
  status?: CmsContentStatus;
  locale?: string;
}

export async function listContent(filter: ListContentFilter = {}) {
  const rows = await prisma.cmsContent.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.locale ? { locale: filter.locale } : {}),
    },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
  });
  return rows.map(toAdminContent);
}

async function findOrThrow(id: string) {
  const row = await prisma.cmsContent.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Content not found.");
  return row;
}

async function assertSlugFree(type: CmsContentType, slug: string, locale: string, exceptId?: string) {
  const existing = await prisma.cmsContent.findFirst({
    where: { type, slug, locale, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, `A ${type} with slug "${slug}" already exists for this locale.`);
  }
}

export interface CreateContentInput {
  type: CmsContentType;
  slug?: string;
  locale?: string;
  title: string;
  excerpt?: string;
  body?: string;
  data?: Prisma.InputJsonValue;
  metaTitle?: string;
  metaDescription?: string;
  status?: CmsContentStatus;
  sortOrder?: number;
  updatedByUserId?: string;
}

export async function createContent(input: CreateContentInput) {
  const title = input.title.trim();
  if (!title) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A title is required.");
  const locale = (input.locale || "en").trim().toLowerCase();
  const slug = slugify(input.slug || title);
  if (!slug) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A valid slug or title is required.");
  await assertSlugFree(input.type, slug, locale);

  const status = input.status ?? CmsContentStatus.DRAFT;
  const row = await prisma.cmsContent.create({
    data: {
      type: input.type,
      slug,
      locale,
      title,
      excerpt: input.excerpt?.trim() || null,
      body: input.body ?? null,
      data: input.data ?? Prisma.JsonNull,
      metaTitle: input.metaTitle?.trim() || null,
      metaDescription: input.metaDescription?.trim() || null,
      status,
      sortOrder: input.sortOrder ?? 0,
      publishedAt: status === CmsContentStatus.PUBLISHED ? new Date() : null,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });
  return toAdminContent(row);
}

export async function getContent(id: string) {
  return toAdminContent(await findOrThrow(id));
}

export interface UpdateContentInput {
  slug?: string;
  locale?: string;
  title?: string;
  excerpt?: string | null;
  body?: string | null;
  data?: Prisma.InputJsonValue | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status?: CmsContentStatus;
  sortOrder?: number;
  updatedByUserId?: string;
}

export async function updateContent(id: string, input: UpdateContentInput) {
  const current = await findOrThrow(id);
  const locale = input.locale ? input.locale.trim().toLowerCase() : current.locale;
  const slug = input.slug !== undefined ? slugify(input.slug) : current.slug;
  if ((slug !== current.slug || locale !== current.locale) && slug) {
    await assertSlugFree(current.type, slug, locale, id);
  }

  // Stamp publishedAt the first time it goes live.
  const goingLive =
    input.status === CmsContentStatus.PUBLISHED && current.status !== CmsContentStatus.PUBLISHED;

  const row = await prisma.cmsContent.update({
    where: { id },
    data: {
      ...(input.slug !== undefined ? { slug } : {}),
      ...(input.locale !== undefined ? { locale } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.data !== undefined ? { data: input.data ?? Prisma.JsonNull } : {}),
      ...(input.metaTitle !== undefined ? { metaTitle: input.metaTitle } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(goingLive ? { publishedAt: new Date() } : {}),
      updatedByUserId: input.updatedByUserId ?? current.updatedByUserId,
    },
  });
  return toAdminContent(row);
}

export async function deleteContent(id: string) {
  await findOrThrow(id);
  await prisma.cmsContent.delete({ where: { id } });
}

// ---- Public surface (published only) --------------------------------

export interface PublicListFilter {
  type?: CmsContentType;
  locale?: string;
}

export async function listPublished(filter: PublicListFilter = {}) {
  const rows = await prisma.cmsContent.findMany({
    where: {
      status: CmsContentStatus.PUBLISHED,
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.locale ? { locale: filter.locale } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return rows.map(toPublicContent);
}

export async function getPublishedBySlug(type: CmsContentType, slug: string, locale = "en") {
  const row = await prisma.cmsContent.findFirst({
    where: { type, slug: slug.trim(), locale: locale.trim().toLowerCase(), status: CmsContentStatus.PUBLISHED },
  });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Content not found.");
  return toPublicContent(row);
}
