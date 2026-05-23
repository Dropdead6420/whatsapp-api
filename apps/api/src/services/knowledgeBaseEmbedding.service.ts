import crypto from "node:crypto";
import OpenAI from "openai";
import { Worker } from "bullmq";
import {
  prisma,
  prismaRead,
  type KnowledgeBaseCategory,
  type KnowledgeBaseEntry,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  getKnowledgeBaseEmbeddingQueue,
  getQueueConnection,
  makeBullJobId,
  trackWorker,
  type KnowledgeBaseEmbeddingJobData,
} from "../lib/queue";

const LOCAL_EMBEDDING_MODEL = "local-hash-v1";
const LOCAL_EMBEDDING_DIMENSIONS = 384;
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = 512;
const MAX_RETRIEVAL_CANDIDATES = 300;
const MAX_EMBED_BATCH = 100;
const MAX_QUERY_LENGTH = 1000;

let openAiClient: OpenAI | null = null;
let knowledgeBaseWorker: Worker<KnowledgeBaseEmbeddingJobData> | null = null;

function isUsableOpenAiKey(key: string | undefined): boolean {
  const trimmed = key?.trim();
  return Boolean(
    trimmed &&
      !trimmed.includes("placeholder") &&
      !trimmed.startsWith("your_") &&
      trimmed !== "sk-test" &&
      trimmed !== "test",
  );
}

function useOpenAiEmbeddings(): boolean {
  return (
    process.env.KNOWLEDGE_BASE_EMBEDDING_PROVIDER?.toLowerCase() === "openai" &&
    isUsableOpenAiKey(process.env.OPENAI_API_KEY)
  );
}

function getPreferredEmbeddingModel(): string {
  if (!useOpenAiEmbeddings()) return LOCAL_EMBEDDING_MODEL;
  return process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
}

function getOpenAi(): OpenAI {
  if (openAiClient) return openAiClient;
  openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openAiClient;
}

export function buildEmbeddingInput(
  entry: Pick<
    KnowledgeBaseEntry,
    "title" | "content" | "summary" | "category" | "tags"
  >,
): string {
  const tags = entry.tags.length > 0 ? entry.tags.join(", ") : "none";
  return [
    `Title: ${entry.title}`,
    `Category: ${entry.category}`,
    `Tags: ${tags}`,
    entry.summary ? `Summary: ${entry.summary}` : "",
    "",
    entry.content,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function hashEmbeddingInput(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function knowledgeEntryNeedsEmbedding(entry: KnowledgeBaseEntry): boolean {
  const currentHash = hashEmbeddingInput(buildEmbeddingInput(entry));
  return (
    entry.embeddingVector.length === 0 ||
    entry.embeddingModel !== getPreferredEmbeddingModel() ||
    entry.embeddingTextHash !== currentHash ||
    !entry.lastEmbeddedAt ||
    Boolean(entry.embeddingError)
  );
}

export interface EmbeddingStatus {
  id: string;
  embedded: boolean;
  stale: boolean;
  embeddingModel: string | null;
  embeddingVectorLength: number;
  embeddingTextHash: string | null;
  lastEmbeddedAt: string | null;
  embeddingError: string | null;
}

function toEmbeddingStatus(entry: KnowledgeBaseEntry): EmbeddingStatus {
  return {
    id: entry.id,
    embedded: entry.embeddingVector.length > 0 && !knowledgeEntryNeedsEmbedding(entry),
    stale: knowledgeEntryNeedsEmbedding(entry),
    embeddingModel: entry.embeddingModel,
    embeddingVectorLength: entry.embeddingVector.length,
    embeddingTextHash: entry.embeddingTextHash,
    lastEmbeddedAt: entry.lastEmbeddedAt?.toISOString() ?? null,
    embeddingError: entry.embeddingError,
  };
}

function tokenize(input: string): string[] {
  return input.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function localHashEmbedding(input: string): number[] {
  const tokens = tokenize(input);
  const vector = new Array<number>(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  const weightedTokens = tokens.length > 0 ? tokens : [input.slice(0, 256)];

  for (const token of weightedTokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    const weight = Math.min(3, Math.max(1, token.length / 8));
    vector[index] += sign * weight;
  }
  return normalizeVector(vector);
}

async function embedText(input: string): Promise<{ vector: number[]; model: string }> {
  if (!useOpenAiEmbeddings()) {
    return { vector: localHashEmbedding(input), model: LOCAL_EMBEDDING_MODEL };
  }

  const model = getPreferredEmbeddingModel();
  const dimensions = Number(
    process.env.OPENAI_EMBEDDING_DIMENSIONS ??
      DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  );

  try {
    const response = await getOpenAi().embeddings.create({
      model,
      input,
      dimensions,
    });
    const vector = response.data[0]?.embedding;
    if (!vector?.length) {
      throw new Error("OpenAI returned an empty embedding vector.");
    }
    return { vector, model: response.model || model };
  } catch (err) {
    console.warn(
      "[knowledge-base] OpenAI embedding failed; using local fallback",
      err,
    );
    return { vector: localHashEmbedding(input), model: LOCAL_EMBEDDING_MODEL };
  }
}

async function findScopedEntry(
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

export async function embedKnowledgeBaseEntry(
  tenantId: string,
  entryId: string,
): Promise<EmbeddingStatus> {
  const entry = await findScopedEntry(tenantId, entryId);
  if (!knowledgeEntryNeedsEmbedding(entry)) return toEmbeddingStatus(entry);

  const input = buildEmbeddingInput(entry);
  const embeddingTextHash = hashEmbeddingInput(input);

  try {
    const embedded = await embedText(input);
    const updated = await prisma.knowledgeBaseEntry.update({
      where: { id: entry.id },
      data: {
        embeddingVector: embedded.vector,
        embeddingModel: embedded.model,
        embeddingTextHash,
        lastEmbeddedAt: new Date(),
        embeddingError: null,
      },
    });
    return toEmbeddingStatus(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await prisma.knowledgeBaseEntry.update({
      where: { id: entry.id },
      data: {
        embeddingVector: [],
        embeddingTextHash,
        lastEmbeddedAt: null,
        embeddingError: message.slice(0, 1000),
      },
    });
    return toEmbeddingStatus(updated);
  }
}

export async function embedStaleKnowledgeBaseEntries(
  tenantId: string,
  limit = 25,
): Promise<{
  checked: number;
  embedded: number;
  skipped: number;
  failed: number;
  entries: EmbeddingStatus[];
}> {
  const safeLimit = Math.min(MAX_EMBED_BATCH, Math.max(1, limit));
  const candidates = await prisma.knowledgeBaseEntry.findMany({
    where: {
      tenantId,
      status: "PUBLISHED",
    },
    orderBy: [{ lastEmbeddedAt: "asc" }, { updatedAt: "desc" }],
    take: Math.max(safeLimit * 3, safeLimit),
  });

  const stale = candidates.filter(knowledgeEntryNeedsEmbedding).slice(0, safeLimit);
  const entries: EmbeddingStatus[] = [];
  let embedded = 0;
  let failed = 0;
  for (const entry of stale) {
    const result = await embedKnowledgeBaseEntry(tenantId, entry.id);
    entries.push(result);
    if (result.embeddingError) failed += 1;
    else if (result.embedded) embedded += 1;
  }

  return {
    checked: candidates.length,
    embedded,
    skipped: candidates.length - stale.length,
    failed,
    entries,
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftMagnitude += left[i] * left[i];
    rightMagnitude += right[i] * right[i];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function lexicalScore(queryTerms: string[], entry: KnowledgeBaseEntry): number {
  if (queryTerms.length === 0) return 0;
  const title = entry.title.toLowerCase();
  const summary = entry.summary?.toLowerCase() ?? "";
  const content = entry.content.toLowerCase();
  const tags = entry.tags.map((tag) => tag.toLowerCase());
  let score = 0;

  for (const term of queryTerms) {
    if (title.includes(term)) score += 4;
    if (summary.includes(term)) score += 2;
    if (tags.some((tag) => tag.includes(term))) score += 3;
    if (content.includes(term)) score += 1;
  }
  return Math.min(1, score / Math.max(4, queryTerms.length * 4));
}

function makeSnippet(entry: KnowledgeBaseEntry, queryTerms: string[]): string {
  const content = entry.content.replace(/\s+/g, " ").trim();
  if (!content) return "";
  const lower = content.toLowerCase();
  const index = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (index ?? 0) - 80);
  const snippet = content.slice(start, start + 260);
  return `${start > 0 ? "..." : ""}${snippet}${
    start + 260 < content.length ? "..." : ""
  }`;
}

function normalizeRequestedTags(raw: string[] | undefined): string[] {
  if (!raw?.length) return [];
  return Array.from(
    new Set(
      raw
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ).slice(0, 20);
}

export interface KnowledgeRetrievalResult {
  query: string;
  embeddingModel: string;
  results: Array<{
    id: string;
    title: string;
    summary: string | null;
    content: string;
    category: KnowledgeBaseCategory;
    tags: string[];
    score: number;
    scoreSource: "embedding" | "lexical";
    snippet: string;
    embeddingModel: string | null;
    lastEmbeddedAt: string | null;
  }>;
}

export async function retrieveKnowledge(
  tenantId: string,
  input: {
    query: string;
    limit?: number;
    category?: KnowledgeBaseCategory;
    tags?: string[];
  },
): Promise<KnowledgeRetrievalResult> {
  const query = input.query.trim();
  if (!query) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "query must not be empty.");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `query exceeds ${MAX_QUERY_LENGTH} characters.`,
    );
  }

  const tags = normalizeRequestedTags(input.tags);
  const queryEmbedding = await embedText(query);
  const queryTerms = Array.from(new Set(tokenize(query))).slice(0, 20);
  const limit = Math.min(10, Math.max(1, input.limit ?? 5));
  const rows = await prismaRead.knowledgeBaseEntry.findMany({
    where: {
      tenantId,
      status: "PUBLISHED",
      ...(input.category ? { category: input.category } : {}),
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: MAX_RETRIEVAL_CANDIDATES,
  });

  const scored = rows
    .map((entry) => {
      const lexical = lexicalScore(queryTerms, entry);
      const canUseEmbedding =
        entry.embeddingModel === queryEmbedding.model &&
        entry.embeddingVector.length === queryEmbedding.vector.length;
      const vectorScore = canUseEmbedding
        ? Math.max(0, cosineSimilarity(queryEmbedding.vector, entry.embeddingVector))
        : 0;
      const score = canUseEmbedding
        ? Math.min(1, vectorScore * 0.85 + lexical * 0.15)
        : lexical;
      const scoreSource: "embedding" | "lexical" = canUseEmbedding
        ? "embedding"
        : "lexical";
      return { entry, score, scoreSource };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    query,
    embeddingModel: queryEmbedding.model,
    results: scored.map(({ entry, score, scoreSource }) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      category: entry.category,
      tags: entry.tags,
      score: Number(score.toFixed(4)),
      scoreSource,
      snippet: makeSnippet(entry, queryTerms),
      embeddingModel: entry.embeddingModel,
      lastEmbeddedAt: entry.lastEmbeddedAt?.toISOString() ?? null,
    })),
  };
}

export async function enqueueKnowledgeBaseEmbedding(
  data: KnowledgeBaseEmbeddingJobData,
): Promise<void> {
  const queue = getKnowledgeBaseEmbeddingQueue();
  const jobName = "entryId" in data ? "embed-entry" : "embed-stale";
  const jobId =
    "entryId" in data
      ? makeBullJobId("kb", data.tenantId, data.entryId)
      : makeBullJobId("kb", data.tenantId, "stale");
  await queue.add(jobName, data, { jobId });
}

export async function startKnowledgeBaseEmbeddingWorker(): Promise<void> {
  if (knowledgeBaseWorker) return;

  knowledgeBaseWorker = new Worker<KnowledgeBaseEmbeddingJobData>(
    getKnowledgeBaseEmbeddingQueue().name,
    async (job) => {
      if ("entryId" in job.data) {
        await embedKnowledgeBaseEntry(job.data.tenantId, job.data.entryId);
        return;
      }
      await embedStaleKnowledgeBaseEntries(job.data.tenantId, job.data.limit);
    },
    { connection: getQueueConnection(), concurrency: 3 },
  );

  knowledgeBaseWorker.on("failed", (job, err) => {
    console.error("[knowledge-base] embedding job failed", job?.id, err);
  });
  trackWorker(knowledgeBaseWorker);
  console.log("[knowledge-base] embedding worker started");
}

export function stopKnowledgeBaseEmbeddingWorker(): void {
  if (!knowledgeBaseWorker) return;
  const worker = knowledgeBaseWorker;
  knowledgeBaseWorker = null;
  void worker.close();
}
