import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// SuperAdmin "AI Template Categories" (AI Center). Managed category groups for
// reusable AI prompt templates — icon, description, enable toggle — distinct
// from the free-form AiPromptTemplate.category string. Pure helpers (stats +
// slug) are separated from the DB CRUD for unit testing.
// =====================================================================

export interface CategoryStats {
  total: number;
  enabled: number;
  disabled: number;
}

/** Pure: Total / Enabled / Disabled headline counts for the stat cards. */
export function summarizeCategories(rows: { enabled: boolean }[]): CategoryStats {
  const enabled = rows.filter((r) => r.enabled).length;
  return { total: rows.length, enabled, disabled: rows.length - enabled };
}

/** Pure: stable slug key derived from a category name (lowercase, kebab-case). */
export function slugifyCategoryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface CategoryInput {
  name: string;
  key?: string;
  icon?: string;
  description?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export async function listCategories(filter: { search?: string; enabled?: boolean } = {}) {
  const search = filter.search?.trim();
  return prisma.aiTemplateCategory.findMany({
    where: {
      ...(filter.enabled !== undefined ? { enabled: filter.enabled } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { key: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

async function getOrThrow(id: string) {
  const row = await prisma.aiTemplateCategory.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Category not found.");
  return row;
}

export async function createCategory(input: CategoryInput, updatedByUserId?: string) {
  const name = input.name.trim();
  if (!name) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A category name is required.");
  const key = input.key?.trim() || slugifyCategoryKey(name);
  if (!key) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A category key could not be derived from the name.");
  const clash = await prisma.aiTemplateCategory.findUnique({ where: { key } });
  if (clash) throw new ApiError(ErrorCodes.CONFLICT, 409, `A category with key "${key}" already exists.`);
  return prisma.aiTemplateCategory.create({
    data: {
      key,
      name,
      icon: input.icon?.trim() || null,
      description: input.description?.trim() || null,
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedByUserId: updatedByUserId ?? null,
    },
  });
}

export async function updateCategory(id: string, input: Partial<CategoryInput>, updatedByUserId?: string) {
  await getOrThrow(id);
  return prisma.aiTemplateCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.icon !== undefined ? { icon: input.icon.trim() || null } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedByUserId: updatedByUserId ?? null,
    },
  });
}

export async function deleteCategory(id: string) {
  await getOrThrow(id);
  await prisma.aiTemplateCategory.delete({ where: { id } });
}
