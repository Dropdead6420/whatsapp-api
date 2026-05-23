import {
  prisma,
  AiAgentStatus,
  AiAgentFallback,
  Prisma,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// AI Agent Builder service (T-052 slice 1).
//
// Plain CRUD + lifecycle. No runtime — slice 2 owns the actual agent
// runner (LLM call with KB retrieval + tool dispatch). The service
// here just persists the configuration and walks status transitions.
//
// Every query is tenant-scoped via findFirst({where:{id, tenantId}}) so
// a malformed id from another tenant returns 404 instead of leaking
// rows. Lifecycle transitions are explicit (publish / disable / archive) —
// we never auto-flip status on update. This mirrors how T-051 modeled
// the KnowledgeBaseEntry lifecycle.

const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;
const MAX_PERSONA = 8_000;
const MAX_KB_TOP_K = 20;
const MAX_TOOLS = 16;

// Provider/model allowlist. Keep this in sync with whatever ai.service.ts
// can actually call — if a tenant picks `mythical/gpt-99` here we want
// the create to fail at write-time, not silently 500 on first message.
const ALLOWED_MODELS: Record<string, string[]> = {
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
  ],
  anthropic: [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
};

const ALLOWED_TOOLS = new Set([
  "CREATE_LEAD",
  "ADD_TAG",
  "BOOK_APPOINTMENT",
  "TRANSFER_TO_HUMAN",
  "SEND_TEMPLATE",
  "LOOKUP_CONTACT",
  "LOOKUP_ORDER",
]);

export interface AiAgentPublic {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  persona: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  knowledgeScope: {
    categories: string[];
    tags: string[];
    topK: number;
  };
  tools: string[];
  fallbackBehavior: AiAgentFallback;
  fallbackTemplateId: string | null;
  status: AiAgentStatus;
  publishedAt: string | null;
  disabledAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeKnowledgeScope(raw: unknown): {
  categories: string[];
  tags: string[];
  topK: number;
} {
  const out = { categories: [] as string[], tags: [] as string[], topK: 5 };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.categories)) {
    out.categories = obj.categories
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toUpperCase())
      .slice(0, 16);
  }
  if (Array.isArray(obj.tags)) {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const raw of obj.tags) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed || trimmed.length > 40) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      tags.push(trimmed);
      if (tags.length >= 32) break;
    }
    out.tags = tags;
  }
  if (typeof obj.topK === "number" && Number.isFinite(obj.topK)) {
    out.topK = Math.max(1, Math.min(MAX_KB_TOP_K, Math.floor(obj.topK)));
  }
  return out;
}

function toPublic(entry: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  persona: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  knowledgeScope: Prisma.JsonValue;
  tools: string[];
  fallbackBehavior: AiAgentFallback;
  fallbackTemplateId: string | null;
  status: AiAgentStatus;
  publishedAt: Date | null;
  disabledAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AiAgentPublic {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    name: entry.name,
    description: entry.description,
    persona: entry.persona,
    provider: entry.provider,
    model: entry.model,
    temperature: entry.temperature,
    maxTokens: entry.maxTokens,
    knowledgeScope: normalizeKnowledgeScope(entry.knowledgeScope),
    tools: entry.tools,
    fallbackBehavior: entry.fallbackBehavior,
    fallbackTemplateId: entry.fallbackTemplateId,
    status: entry.status,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    disabledAt: entry.disabledAt?.toISOString() ?? null,
    archivedAt: entry.archivedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
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

function validateModelChoice(provider: unknown, model: unknown): {
  provider: string;
  model: string;
} {
  const providerStr =
    typeof provider === "string" && provider.trim() ? provider.trim().toLowerCase() : "openai";
  const modelStr = typeof model === "string" && model.trim() ? model.trim() : null;
  const allowed = ALLOWED_MODELS[providerStr];
  if (!allowed) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Unsupported provider "${providerStr}". Allowed: ${Object.keys(ALLOWED_MODELS).join(", ")}.`,
    );
  }
  // Default to the first allowlisted model for the provider when nothing was given.
  const finalModel = modelStr ?? allowed[0];
  if (!allowed.includes(finalModel)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Model "${finalModel}" is not allowed for provider "${providerStr}". Allowed: ${allowed.join(", ")}.`,
    );
  }
  return { provider: providerStr, model: finalModel };
}

function validateTools(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "tools must be an array.");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const upper = t.trim().toUpperCase();
    if (!ALLOWED_TOOLS.has(upper)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Unsupported tool "${upper}". Allowed: ${[...ALLOWED_TOOLS].join(", ")}.`,
      );
    }
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

function validateFallback(value: unknown): AiAgentFallback {
  if (value === undefined || value === null) {
    return "ESCALATE_TO_HUMAN" as AiAgentFallback;
  }
  if (typeof value !== "string") {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "fallbackBehavior must be a string.",
    );
  }
  const upper = value.toUpperCase();
  const allowed: AiAgentFallback[] = [
    "ESCALATE_TO_HUMAN",
    "SEND_TEMPLATE",
    "SILENT",
  ] as AiAgentFallback[];
  if (!allowed.includes(upper as AiAgentFallback)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid fallbackBehavior. Allowed: ${allowed.join(", ")}.`,
    );
  }
  return upper as AiAgentFallback;
}

function validateNumber(
  field: string,
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be a finite number.`,
    );
  }
  if (value < min || value > max) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Field "${field}" must be between ${min} and ${max}.`,
    );
  }
  return value;
}

export interface ListAgentsOptions {
  status?: AiAgentStatus | "ALL";
  search?: string;
  page?: number;
  limit?: number;
}

export async function listAgents(
  tenantId: string,
  opts: ListAgentsOptions = {},
): Promise<{
  agents: AiAgentPublic[];
  pagination: { page: number; limit: number; total: number };
}> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const where: Record<string, unknown> = { tenantId };
  if (opts.status && opts.status !== "ALL") where.status = opts.status;
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.aiAgent.count({ where }),
    prisma.aiAgent.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    agents: rows.map(toPublic),
    pagination: { page, limit, total },
  };
}

export interface CreateAgentInput {
  name: unknown;
  description?: unknown;
  persona: unknown;
  provider?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  knowledgeScope?: unknown;
  tools?: unknown;
  fallbackBehavior?: unknown;
  fallbackTemplateId?: unknown;
}

export async function createAgent(
  tenantId: string,
  input: CreateAgentInput,
): Promise<AiAgentPublic> {
  const name = validateString("name", input.name, MAX_NAME, true)!;
  const description = validateString(
    "description",
    input.description,
    MAX_DESCRIPTION,
    false,
  );
  const persona = validateString("persona", input.persona, MAX_PERSONA, true)!;
  const { provider, model } = validateModelChoice(input.provider, input.model);
  const temperature = validateNumber("temperature", input.temperature, 0, 2, 0.7);
  const maxTokens = Math.floor(
    validateNumber("maxTokens", input.maxTokens, 1, 4096, 800),
  );
  const knowledgeScope = normalizeKnowledgeScope(input.knowledgeScope);
  const tools = validateTools(input.tools);
  const fallbackBehavior = validateFallback(input.fallbackBehavior);
  const fallbackTemplateId = validateString(
    "fallbackTemplateId",
    input.fallbackTemplateId,
    120,
    false,
  );

  // If fallback is SEND_TEMPLATE we must have a templateId — guard at
  // write time so the runtime never has to handle "fallback set, but
  // template missing" as a partial state.
  if (fallbackBehavior === ("SEND_TEMPLATE" as AiAgentFallback) && !fallbackTemplateId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "fallbackTemplateId is required when fallbackBehavior=SEND_TEMPLATE.",
    );
  }

  const entry = await prisma.aiAgent.create({
    data: {
      tenantId,
      name,
      description,
      persona,
      provider,
      model,
      temperature,
      maxTokens,
      knowledgeScope: knowledgeScope as Prisma.InputJsonValue,
      tools,
      fallbackBehavior,
      fallbackTemplateId,
      status: "DRAFT",
    },
  });
  return toPublic(entry);
}

async function findScoped(tenantId: string, agentId: string) {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: agentId, tenantId },
  });
  if (!agent) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "AI agent not found.");
  }
  return agent;
}

export async function getAgent(
  tenantId: string,
  agentId: string,
): Promise<AiAgentPublic> {
  const agent = await findScoped(tenantId, agentId);
  return toPublic(agent);
}

export interface UpdateAgentInput {
  name?: unknown;
  description?: unknown;
  persona?: unknown;
  provider?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  knowledgeScope?: unknown;
  tools?: unknown;
  fallbackBehavior?: unknown;
  fallbackTemplateId?: unknown;
}

export async function updateAgent(
  tenantId: string,
  agentId: string,
  input: UpdateAgentInput,
): Promise<AiAgentPublic> {
  const existing = await findScoped(tenantId, agentId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    data.name = validateString("name", input.name, MAX_NAME, true);
  }
  if (input.description !== undefined) {
    data.description = validateString(
      "description",
      input.description,
      MAX_DESCRIPTION,
      false,
    );
  }
  if (input.persona !== undefined) {
    data.persona = validateString("persona", input.persona, MAX_PERSONA, true);
  }
  // Provider + model travel together: validate them as a pair so we
  // never end up with a valid provider but a model that belongs to a
  // different provider's allowlist.
  if (input.provider !== undefined || input.model !== undefined) {
    const { provider, model } = validateModelChoice(
      input.provider ?? existing.provider,
      input.model ?? existing.model,
    );
    data.provider = provider;
    data.model = model;
  }
  if (input.temperature !== undefined) {
    data.temperature = validateNumber("temperature", input.temperature, 0, 2, 0.7);
  }
  if (input.maxTokens !== undefined) {
    data.maxTokens = Math.floor(
      validateNumber("maxTokens", input.maxTokens, 1, 4096, 800),
    );
  }
  if (input.knowledgeScope !== undefined) {
    data.knowledgeScope = normalizeKnowledgeScope(
      input.knowledgeScope,
    ) as Prisma.InputJsonValue;
  }
  if (input.tools !== undefined) {
    data.tools = validateTools(input.tools);
  }
  if (input.fallbackBehavior !== undefined) {
    data.fallbackBehavior = validateFallback(input.fallbackBehavior);
  }
  if (input.fallbackTemplateId !== undefined) {
    data.fallbackTemplateId = validateString(
      "fallbackTemplateId",
      input.fallbackTemplateId,
      120,
      false,
    );
  }

  // Cross-field check: if the merged effective fallback is SEND_TEMPLATE
  // there must be a templateId on disk (or in the patch).
  const effectiveFallback =
    (data.fallbackBehavior as AiAgentFallback | undefined) ??
    existing.fallbackBehavior;
  const effectiveTemplateId =
    data.fallbackTemplateId !== undefined
      ? (data.fallbackTemplateId as string | null)
      : existing.fallbackTemplateId;
  if (
    effectiveFallback === ("SEND_TEMPLATE" as AiAgentFallback) &&
    !effectiveTemplateId
  ) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "fallbackTemplateId is required when fallbackBehavior=SEND_TEMPLATE.",
    );
  }

  if (Object.keys(data).length === 0) {
    return getAgent(tenantId, agentId);
  }

  const updated = await prisma.aiAgent.update({
    where: { id: agentId },
    data,
  });
  return toPublic(updated);
}

// Lifecycle transitions. Explicit so the caller has to opt in; we never
// auto-flip status on field updates.

export async function publishAgent(
  tenantId: string,
  agentId: string,
): Promise<AiAgentPublic> {
  const existing = await findScoped(tenantId, agentId);
  if (existing.status === ("ARCHIVED" as AiAgentStatus)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Cannot publish an archived agent. Restore it to DRAFT first by re-creating.",
    );
  }
  if (existing.status === ("ACTIVE" as AiAgentStatus)) {
    return toPublic(existing); // idempotent
  }
  const updated = await prisma.aiAgent.update({
    where: { id: agentId },
    data: {
      status: "ACTIVE",
      publishedAt: existing.publishedAt ?? new Date(),
      disabledAt: null,
      archivedAt: null,
    },
  });
  return toPublic(updated);
}

export async function disableAgent(
  tenantId: string,
  agentId: string,
): Promise<AiAgentPublic> {
  const existing = await findScoped(tenantId, agentId);
  if (existing.status === ("ARCHIVED" as AiAgentStatus)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Cannot disable an archived agent.",
    );
  }
  if (existing.status === ("DISABLED" as AiAgentStatus)) {
    return toPublic(existing); // idempotent
  }
  const updated = await prisma.aiAgent.update({
    where: { id: agentId },
    data: {
      status: "DISABLED",
      disabledAt: new Date(),
    },
  });
  return toPublic(updated);
}

export async function archiveAgent(
  tenantId: string,
  agentId: string,
): Promise<AiAgentPublic> {
  const existing = await findScoped(tenantId, agentId);
  if (existing.status === ("ARCHIVED" as AiAgentStatus)) {
    return toPublic(existing); // idempotent
  }
  const updated = await prisma.aiAgent.update({
    where: { id: agentId },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });
  return toPublic(updated);
}

export async function deleteAgent(
  tenantId: string,
  agentId: string,
): Promise<void> {
  await findScoped(tenantId, agentId);
  await prisma.aiAgent.delete({ where: { id: agentId } });
}

export const __test__ = {
  normalizeKnowledgeScope,
  validateModelChoice,
  validateTools,
  validateFallback,
  ALLOWED_MODELS,
  ALLOWED_TOOLS,
};
