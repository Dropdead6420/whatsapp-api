import {
  prisma,
  type KnowledgeBaseCategory,
  type KnowledgeBaseEntry,
  type KnowledgeBaseStatus,
  type Prisma,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  buildEmbeddingInput,
  hashEmbeddingInput,
} from "./knowledgeBaseEmbedding.service";

const MAX_TITLE = 200;
const MAX_CONTENT = 50_000;
const MAX_SUMMARY = 1000;
const MAX_TAGS_PER_ENTRY = 20;
const MAX_TAG_LENGTH = 40;

const CATEGORIES = [
  "FAQ",
  "SERVICE",
  "PRODUCT",
  "POLICY",
  "HOURS",
  "LOCATION",
  "OTHER",
] as const;

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

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
  embeddingModel: string | null;
  embeddingVectorLength: number;
  embeddingTextHash: string | null;
  lastEmbeddedAt: string | null;
  embeddingError: string | null;
  needsEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseEntryInput {
  title?: string;
  content?: string;
  summary?: string | null;
  category?: string | null;
  tags?: unknown;
  source?: string | null;
  sourceUrl?: string | null;
  publish?: boolean;
}

export function toPublic(entry: KnowledgeBaseEntry): KnowledgeBaseEntryPublic {
  const embeddingVector = entry.embeddingVector ?? [];
  const currentHash = hashEmbeddingInput(buildEmbeddingInput(entry));

  return {
    id: entry.id,
    tenantId: entry.tenantId,
    title: entry.title,
    content: entry.content,
    summary: entry.summary,
    category: entry.category,
    tags: entry.tags,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    status: entry.status,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    archivedAt: entry.archivedAt?.toISOString() ?? null,
    embeddingModel: entry.embeddingModel ?? null,
    embeddingVectorLength: embeddingVector.length,
    embeddingTextHash: entry.embeddingTextHash ?? null,
    lastEmbeddedAt: entry.lastEmbeddedAt?.toISOString() ?? null,
    embeddingError: entry.embeddingError ?? null,
    needsEmbedding:
      embeddingVector.length === 0 ||
      !entry.lastEmbeddedAt ||
      entry.embeddingTextHash !== currentHash ||
      Boolean(entry.embeddingError),
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
    return new URL(value).toString();
  } catch {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be a valid URL.`,
    );
  }
}

function validateCategory(value: unknown): KnowledgeBaseCategory {
  if (value === undefined || value === null || value === "") return "FAQ";
  if (typeof value !== "string") {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "category must be a string.");
  }
  const upper = value.toUpperCase();
  if (!CATEGORIES.includes(upper as KnowledgeBaseCategory)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid category. Allowed: ${CATEGORIES.join(", ")}.`,
    );
  }
  return upper as KnowledgeBaseCategory;
}

function validateStatus(value: unknown): KnowledgeBaseStatus | undefined {
  if (value === undefined || value === null || value === "" || value === "ALL") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "status must be a string.");
  }
  const upper = value.toUpperCase();
  if (!STATUSES.includes(upper as KnowledgeBaseStatus)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid status. Allowed: ${STATUSES.join(", ")}.`,
    );
  }
  return upper as KnowledgeBaseStatus;
}

export async function listEntries(
  tenantId: string,
  opts: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
    search?: string;
  } = {},
): Promise<{
  entries: KnowledgeBaseEntryPublic[];
  pagination: { page: number; limit: number; total: number };
}> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const status = validateStatus(opts.status);
  const category = opts.category ? validateCategory(opts.category) : undefined;
  const where: Prisma.KnowledgeBaseEntryWhereInput = { tenantId };
  if (status) where.status = status;
  if (category) where.category = category;
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
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

export async function createEntry(
  tenantId: string,
  input: KnowledgeBaseEntryInput,
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

async function findScoped(
  tenantId: string,
  entryId: string,
): Promise<KnowledgeBaseEntry> {
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
  return toPublic(await findScoped(tenantId, entryId));
}

export async function updateEntry(
  tenantId: string,
  entryId: string,
  input: KnowledgeBaseEntryInput,
): Promise<KnowledgeBaseEntryPublic> {
  await findScoped(tenantId, entryId);
  const data: Prisma.KnowledgeBaseEntryUpdateInput = {};

  if (input.title !== undefined) {
    data.title = validateString("title", input.title, MAX_TITLE, true)!;
  }
  if (input.content !== undefined) {
    data.content = validateString("content", input.content, MAX_CONTENT, true)!;
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

  const embeddingSensitiveFields = [
    "title",
    "content",
    "summary",
    "category",
    "tags",
  ];
  if (embeddingSensitiveFields.some((field) => field in data)) {
    data.embeddingVector = [];
    data.embeddingModel = null;
    data.embeddingTextHash = null;
    data.lastEmbeddedAt = null;
    data.embeddingError = null;
  }

  if (Object.keys(data).length === 0) {
    return getEntry(tenantId, entryId);
  }

  const updated = await prisma.knowledgeBaseEntry.update({
    where: { id: entryId },
    data,
  });
  return toPublic(updated);
}

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
  if (existing.status === "PUBLISHED") return toPublic(existing);
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
  if (existing.status === "ARCHIVED") return toPublic(existing);
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
