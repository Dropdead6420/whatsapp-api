import { prisma } from "@nexaflow/db";

// =====================================================================
// SuperAdmin "AI Settings" workload routing (AI Control Center). Per workload,
// which provider + model handles it and whether it's enabled. The DB stores
// only overrides; the read merges them onto the default matrix so the admin UI
// always shows every workload. Admin-managed config — the AI gateway consumes
// this to route each workload (wiring is incremental). Pure helpers are
// unit-tested; persistence is thin.
// =====================================================================

export type WorkloadGroup = "text" | "qr" | "media" | "embeddings";

export interface WorkloadRoute {
  workload: string;
  label: string;
  group: WorkloadGroup;
  description: string;
  enabled: boolean;
  provider: string;
  model: string;
}

export interface AiGlobalSettings {
  enabled: boolean;
  defaultProvider: string;
  textModel: string;
  embeddingsModel: string;
  defaultLanguage: string;
  defaultTone: string;
  creativity: string;
  maxInputLength: number;
  maxOutputLength: number;
  updatedAt?: Date;
}

export const DEFAULT_GLOBAL_AI_SETTINGS: AiGlobalSettings = {
  enabled: true,
  defaultProvider: "OpenAI",
  textModel: "gpt-5.4",
  embeddingsModel: "text-embedding-3-small",
  defaultLanguage: "English",
  defaultTone: "Friendly",
  creativity: "Economic",
  maxInputLength: 100,
  maxOutputLength: 2000,
};

// Sensible starting matrix (admin-editable, not hardcoded at runtime — the
// saved AiWorkloadRoute rows override these).
export const DEFAULT_WORKLOADS: WorkloadRoute[] = [
  { workload: "content", label: "Content", group: "text", description: "Articles, blogs, long-form marketing copy", enabled: true, provider: "OpenAI", model: "GPT-5.4" },
  { workload: "text", label: "Text", group: "text", description: "Rewrite, summarize, classify, enrich", enabled: true, provider: "OpenAI", model: "GPT-5.4" },
  { workload: "chat", label: "Chat", group: "text", description: "Assistants, copilots, threaded conversations", enabled: true, provider: "OpenAI", model: "GPT-5.4" },
  { workload: "code", label: "Code", group: "text", description: "Generation, debugging, refactoring", enabled: true, provider: "OpenAI", model: "GPT-5.4" },
  { workload: "qr", label: "AI QR Codes", group: "qr", description: "QR-controlled artwork only. Always uses Replicate AI QR settings.", enabled: true, provider: "Replicate", model: "zylim0702/qr_code_controlnet" },
  { workload: "image", label: "Image", group: "media", description: "Generation, editing, thumbnails, product visuals", enabled: true, provider: "Gemini", model: "Gemini 3 Pro Image" },
  { workload: "video", label: "Video", group: "media", description: "Motion, cinematic previews, video generation", enabled: false, provider: "OpenAI", model: "Sora 2" },
  { workload: "voice", label: "Voice", group: "media", description: "Realtime voice, TTS, transcription", enabled: false, provider: "OpenAI", model: "GPT Realtime" },
  { workload: "embeddings", label: "Embeddings", group: "embeddings", description: "Search, similarity, retrieval, and indexing", enabled: true, provider: "OpenAI", model: "text-embedding-3-small" },
];

const WORKLOAD_KEYS = new Set(DEFAULT_WORKLOADS.map((w) => w.workload));

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeGlobalAiSettings(
  input: Partial<AiGlobalSettings>,
): AiGlobalSettings {
  return {
    ...DEFAULT_GLOBAL_AI_SETTINGS,
    ...input,
    defaultProvider:
      input.defaultProvider?.trim() ||
      DEFAULT_GLOBAL_AI_SETTINGS.defaultProvider,
    textModel: input.textModel?.trim() || DEFAULT_GLOBAL_AI_SETTINGS.textModel,
    embeddingsModel:
      input.embeddingsModel?.trim() ||
      DEFAULT_GLOBAL_AI_SETTINGS.embeddingsModel,
    defaultLanguage:
      input.defaultLanguage?.trim() ||
      DEFAULT_GLOBAL_AI_SETTINGS.defaultLanguage,
    defaultTone:
      input.defaultTone?.trim() || DEFAULT_GLOBAL_AI_SETTINGS.defaultTone,
    creativity:
      input.creativity?.trim() || DEFAULT_GLOBAL_AI_SETTINGS.creativity,
    maxInputLength: clampInt(
      Number(input.maxInputLength ?? DEFAULT_GLOBAL_AI_SETTINGS.maxInputLength),
      1,
      200_000,
    ),
    maxOutputLength: clampInt(
      Number(
        input.maxOutputLength ?? DEFAULT_GLOBAL_AI_SETTINGS.maxOutputLength,
      ),
      1,
      200_000,
    ),
  };
}

export interface StoredRoute {
  workload: string;
  enabled: boolean;
  provider: string;
  model: string;
}

/** Pure: overlay stored overrides onto the default matrix (defaults preserved). */
export function mergeRoutesWithDefaults(stored: StoredRoute[]): WorkloadRoute[] {
  const byKey = new Map(stored.map((s) => [s.workload, s]));
  return DEFAULT_WORKLOADS.map((d) => {
    const s = byKey.get(d.workload);
    if (!s) return d;
    return {
      ...d,
      enabled: s.enabled,
      provider: s.provider.trim() || d.provider,
      model: s.model.trim() || d.model,
    };
  });
}

export async function listWorkloadRoutes(): Promise<WorkloadRoute[]> {
  const rows = await prisma.aiWorkloadRoute.findMany({
    select: { workload: true, enabled: true, provider: true, model: true },
  });
  return mergeRoutesWithDefaults(rows);
}

export async function getGlobalAiSettings(): Promise<AiGlobalSettings> {
  const row = await prisma.aiGlobalSetting.findUnique({
    where: { id: "global" },
  });
  if (!row) return DEFAULT_GLOBAL_AI_SETTINGS;
  return normalizeGlobalAiSettings({
    enabled: row.enabled,
    defaultProvider: row.defaultProvider,
    textModel: row.textModel,
    embeddingsModel: row.embeddingsModel,
    defaultLanguage: row.defaultLanguage,
    defaultTone: row.defaultTone,
    creativity: row.creativity,
    maxInputLength: row.maxInputLength,
    maxOutputLength: row.maxOutputLength,
    updatedAt: row.updatedAt,
  });
}

export async function updateGlobalAiSettings(
  input: Partial<AiGlobalSettings>,
  updatedByUserId?: string,
): Promise<AiGlobalSettings> {
  const normalized = normalizeGlobalAiSettings(input);
  const row = await prisma.aiGlobalSetting.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      ...normalized,
      updatedByUserId: updatedByUserId ?? null,
    },
    update: {
      ...normalized,
      updatedByUserId: updatedByUserId ?? null,
    },
  });
  return normalizeGlobalAiSettings({
    enabled: row.enabled,
    defaultProvider: row.defaultProvider,
    textModel: row.textModel,
    embeddingsModel: row.embeddingsModel,
    defaultLanguage: row.defaultLanguage,
    defaultTone: row.defaultTone,
    creativity: row.creativity,
    maxInputLength: row.maxInputLength,
    maxOutputLength: row.maxOutputLength,
    updatedAt: row.updatedAt,
  });
}

export interface WorkloadRouteInput {
  workload: string;
  enabled?: boolean;
  provider?: string;
  model?: string;
}

export async function upsertWorkloadRoutes(
  rows: WorkloadRouteInput[],
  updatedByUserId?: string,
): Promise<WorkloadRoute[]> {
  for (const r of rows) {
    if (!WORKLOAD_KEYS.has(r.workload)) continue; // ignore unknown workloads
    const data = {
      enabled: r.enabled ?? true,
      provider: (r.provider ?? "").trim() || "OpenAI",
      model: (r.model ?? "").trim(),
      updatedByUserId: updatedByUserId ?? null,
    };
    await prisma.aiWorkloadRoute.upsert({
      where: { workload: r.workload },
      create: { workload: r.workload, ...data },
      update: data,
    });
  }
  return listWorkloadRoutes();
}
