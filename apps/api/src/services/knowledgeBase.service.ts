import { prisma, KnowledgeBaseCategory, KnowledgeBaseStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Knowledge Base service (T-051 slice 1).
//
// Plain CRUD + lifecycle. No embeddings, no retrieval — slice 2 owns
// vector generation, slice 3 owns the retrieval helper that grounds
// AI replies against published entries.
//
// Every query is tenant-scoped via findFirst({where:{id, tenantId}}) so
// a malformed id from another tenant returns 404 instead of leaking
// rows. Lifecycle transitions are explicit (publish / archive) — we
// never auto-flip status on update.

const MAX_TITLE = 200;
const MAX_CONTENT = 50_000; // ~12k tokens at typical English rates
const MAX_SUMMARY = 1_000;
const MAX_TAGS_PER_ENTRY = 20;
const MAX_TAG_LENGTH = 40;

export interface KnowledgeBaseEntryPublic {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  summary: string | null;
  category: KnowledgeBaseCategory;
  tags: string[];
  source: string | null;
  sourceUrl: string | null;
  status: KnowledgeBaseStatus;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPublic(entry: {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  summary: string | null;
  category: KnowledgeBaseCategory;
  tags: string[];
  source: string | null;
  sourceUrl: string | null;
  status: KnowledgeBaseStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeBaseEntryPublic {
  return {
    ...entry,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    archivedAt: entry.archivedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > MAX_TAG_LENGTH) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS_PER_ENTRY) break;
  }
  return out;
}

function validateString(
  field: string,
  value: unknown,
  max: number,
  required: boolean,
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Field "${field}" is required.`,
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be a string.`,
    );
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must not be empty.`,
    );
  }
  if (trimmed.length > max) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" exceeds ${max} characters.`,
    );
  }
  return trimmed.length === 0 ? null : trimmed;
}

function validateUrl(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be a string URL.`,
    );
  }
  try {
    new URL(value);
    return value;
  } catch {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be a valid URL.`,
    );
  }
}

function validateCategory(value: unknown): KnowledgeBaseCategory {
  if (value === undefined || value === null) return "FAQ" as KnowledgeBaseCategory;
  if (typeof value !== "string") {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "category must be a string.");
  }
  const upper = value.toUpperCase();
  const allowed: KnowledgeBaseCategory[] = [
    "FAQ",
    "SERVICE",
    "PRODUCT",
    "POLICY",
    "HOURS",
    "LOCATION",
    "OTHER",
  ] as KnowledgeBaseCategory[];
  if (!allowed.includes(upper as KnowledgeBaseCategory)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid category. Allowed: ${allowed.join(", ")}.`,
    );
  }
  return upper as KnowledgeBaseCategory;
}

export interface ListEntriesOptions {
  status?: KnowledgeBaseStatus | "ALL";
  category?: KnowledgeBaseCategory;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listEntries(
  tenantId: string,
  opts: ListEntriesOptions = {},
): Promise<{
  entries: KnowledgeBaseEntryPublic[];
  pagination: { page: number; limit: number; total: number };
}> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const where: Record<string, unknown> = { tenantId };
  if (opts.status && opts.status !== "ALL") where.status = opts.status;
  if (opts.category) where.category = opts.category;
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    // Case-insensitive substring match on title + content.
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.knowledgeBaseEntry.count({ where }),
    prisma.knowledgeBaseEntry.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    entries: rows.map(toPublic),
    pagination: { page, limit, total },
  };
}

export interface CreateEntryInput {
  title: unknown;
  content: unknown;
  summary?: unknown;
  category?: unknown;
  tags?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  publish?: unknown; // optional: create + publish in one call
}

export async function createEntry(
  tenantId: string,
  input: CreateEntryInput,
): Promise<KnowledgeBaseEntryPublic> {
  const title = validateString("title", input.title, MAX_TITLE, true)!;
  const content = validateString("content", input.content, MAX_CONTENT, true)!;
  const summary = validateString("summary", input.summary, MAX_SUMMARY, false);
  const category = validateCategory(input.category);
  const tags = normalizeTags(input.tags);
  const source = validateString("source", input.source, 40, false);
  const sourceUrl = validateUrl("sourceUrl", input.sourceUrl);

  const publish = input.publish === true;
  const now = new Date();

  const entry = await prisma.knowledgeBaseEntry.create({
    data: {
      tenantId,
      title,
      content,
      summary,
      category,
      tags,
      source,
      sourceUrl,
      status: publish ? "PUBLISHED" : "DRAFT",
      publishedAt: publish ? now : null,
    },
  });
  return toPublic(entry);
}

async function findScoped(tenantId: string, entryId: string) {
  const entry = await prisma.knowledgeBaseEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!entry) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Knowledge base entry not found.",
    );
  }
  return entry;
}

export async function getEntry(
  tenantId: string,
  entryId: string,
): Promise<KnowledgeBaseEntryPublic> {
  const entry = await findScoped(tenantId, entryId);
  return toPublic(entry);
}

export interface UpdateEntryInput {
  title?: unknown;
  content?: unknown;
  summary?: unknown;
  category?: unknown;
  tags?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
}

export async function updateEntry(
  tenantId: string,
  entryId: string,
  input: UpdateEntryInput,
): Promise<KnowledgeBaseEntryPublic> {
  await findScoped(tenantId, entryId);

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    data.title = validateString("title", input.title, MAX_TITLE, true);
  }
  if (input.content !== undefined) {
    data.content = validateString("content", input.content, MAX_CONTENT, true);
  }
  if (input.summary !== undefined) {
    data.summary = validateString("summary", input.summary, MAX_SUMMARY, false);
  }
  if (input.category !== undefined) {
    data.category = validateCategory(input.category);
  }
  if (input.tags !== undefined) {
    data.tags = normalizeTags(input.tags);
  }
  if (input.source !== undefined) {
    data.source = validateString("source", input.source, 40, false);
  }
  if (input.sourceUrl !== undefined) {
    data.sourceUrl = validateUrl("sourceUrl", input.sourceUrl);
  }

  if (Object.keys(data).length === 0) {
    // No-op update — return current state without touching updatedAt.
    return getEntry(tenantId, entryId);
  }

  const updated = await prisma.knowledgeBaseEntry.update({
    where: { id: entryId },
    data,
  });
  return toPublic(updated);
}

// Lifecycle transitions. Explicit so the caller has to opt in; we never
// auto-flip status on field updates.

export async function publishEntry(
  tenantId: string,
  entryId: string,
): Promise<KnowledgeBaseEntryPublic> {
  const existing = await findScoped(tenantId, entryId);
  if (existing.status === "ARCHIVED") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Cannot publish an archived entry. Restore it to DRAFT first.",
    );
  }
  if (existing.status === "PUBLISHED") {
    return toPublic(existing); // idempotent
  }
  const updated = await prisma.knowledgeBaseEntry.update({
    where: { id: entryId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      archivedAt: null,
    },
  });
  return toPublic(updated);
}

export async function archiveEntry(
  tenantId: string,
  entryId: string,
): Promise<KnowledgeBaseEntryPublic> {
  const existing = await findScoped(tenantId, entryId);
  if (existing.status === "ARCHIVED") {
    return toPublic(existing); // idempotent
  }
  const updated = await prisma.knowledgeBaseEntry.update({
    where: { id: entryId },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });
  return toPublic(updated);
}

export async function restoreEntryToDraft(
  tenantId: string,
  entryId: string,
): Promise<KnowledgeBaseEntryPublic> {
  await findScoped(tenantId, entryId);
  const updated = await prisma.knowledgeBaseEntry.update({
    where: { id: entryId },
    data: {
      status: "DRAFT",
      publishedAt: null,
      archivedAt: null,
    },
  });
  return toPublic(updated);
}

export async function deleteEntry(
  tenantId: string,
  entryId: string,
): Promise<void> {
  await findScoped(tenantId, entryId);
  await prisma.knowledgeBaseEntry.delete({ where: { id: entryId } });
}
