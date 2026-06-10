import { prisma, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly GMB — AI Keyword Finder (planning PDF §2). Generates local-SEO
// keyword ideas from category + city + services + competitors using
// deterministic local-intent patterns (LLM-swappable later, same contract).
// Chosen ideas feed the ranking tracker via the existing /keywords endpoint.
// The generation engine is pure and unit-tested; idea sets are stored as JSON.
// =====================================================================

export type KeywordKind = "category" | "service" | "city" | "competitor" | "long_tail";

export interface KeywordIdea {
  keyword: string;
  kind: KeywordKind;
  score: number;
}

export interface KeywordInput {
  category?: string;
  city?: string;
  region?: string;
  services?: string[];
  competitors?: string[];
  seedKeywords?: string[];
  limit?: number;
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * Generate ranked local-SEO keyword ideas. Deterministic: the same input
 * always yields the same set. Scores encode local intent (city + service
 * combinations rank highest; bare category lowest). De-duplicated
 * case-insensitively, keeping the highest score for each keyword.
 */
export function generateKeywordIdeas(input: KeywordInput): KeywordIdea[] {
  const byKey = new Map<string, KeywordIdea>();
  const add = (raw: string, kind: KeywordKind, score: number) => {
    const keyword = clean(raw);
    if (!keyword) return;
    const key = keyword.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || score > existing.score) byKey.set(key, { keyword, kind, score });
  };

  const category = input.category ? clean(input.category) : "";
  const city = input.city ? clean(input.city) : "";
  const region = input.region ? clean(input.region) : "";
  const services = (input.services ?? []).map(clean).filter(Boolean);
  const competitors = (input.competitors ?? []).map(clean).filter(Boolean);
  const seeds = (input.seedKeywords ?? []).map(clean).filter(Boolean);

  const baseTerms = services.length ? services : category ? [category] : [];
  const baseKind: KeywordKind = services.length ? "service" : "category";

  for (const term of baseTerms) {
    add(term, baseKind, 40);
    add(`${term} near me`, "long_tail", 70);
    if (city) {
      add(`${term} in ${city}`, "city", 90);
      add(`best ${term} in ${city}`, "long_tail", 85);
      add(`${term} ${city}`, "city", 80);
      add(`affordable ${term} in ${city}`, "long_tail", 75);
    }
    if (region && region.toLowerCase() !== city.toLowerCase()) {
      add(`${term} ${region}`, "city", 60);
    }
  }

  if (category) {
    add(category, "category", 35);
    if (city) {
      add(`${category} ${city}`, "city", 78);
      add(`${category} services in ${city}`, "long_tail", 72);
    }
  }

  for (const c of competitors) {
    add(`${c} alternative`, "competitor", 65);
    add(`${c} vs`, "competitor", 50);
    if (city) add(`${c} ${city}`, "competitor", 55);
  }

  for (const s of seeds) add(s, "long_tail", 45);

  const ideas = [...byKey.values()].sort(
    (a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword),
  );
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return ideas.slice(0, limit);
}

interface IdeaSetRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  category: string | null;
  city: string | null;
  region: string | null;
  services: string[];
  competitors: string[];
  ideas: Prisma.JsonValue;
  createdAt: Date;
}

export function toSafeIdeaSet(row: IdeaSetRow) {
  const ideas = Array.isArray(row.ideas) ? (row.ideas as unknown as KeywordIdea[]) : [];
  return {
    id: row.id,
    locationId: row.locationId,
    category: row.category,
    city: row.city,
    region: row.region,
    services: row.services,
    competitors: row.competitors,
    ideas,
    count: ideas.length,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export interface CreateIdeaSetInput extends KeywordInput {
  locationId?: string;
  createdByUserId?: string;
}

export async function createIdeaSet(tenantId: string, input: CreateIdeaSetInput) {
  const ideas = generateKeywordIdeas(input);
  if (ideas.length === 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Provide a category or at least one service to generate keyword ideas.",
    );
  }
  const row = await prisma.gmbKeywordIdeaSet.create({
    data: {
      tenantId,
      locationId: input.locationId?.trim() || null,
      category: input.category?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      services: (input.services ?? []).map((s) => s.trim()).filter(Boolean),
      competitors: (input.competitors ?? []).map((s) => s.trim()).filter(Boolean),
      ideas: ideas as unknown as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeIdeaSet(row);
}

export async function listIdeaSets(tenantId: string, locationId?: string) {
  const rows = await prisma.gmbKeywordIdeaSet.findMany({
    where: { tenantId, ...(locationId ? { locationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeIdeaSet);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.gmbKeywordIdeaSet.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Keyword idea set not found.");
  return row;
}

export async function getIdeaSet(tenantId: string, id: string) {
  return toSafeIdeaSet(await findOwnedOrThrow(tenantId, id));
}

export async function deleteIdeaSet(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.gmbKeywordIdeaSet.delete({ where: { id } });
}
