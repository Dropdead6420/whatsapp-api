import { AiProviderKey, AiProviderKind } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  getProvider,
  resolveProviderChain,
  type ProviderChainEntry,
} from "./aiProviderHub.service";
import { type SecretContext, resolveSecretValue } from "./secretVault.service";

// =====================================================================
// AI Gateway (Complete Planning PDF §2.10 / Phase 4). Turns an
// AiProviderConfig + its encrypted vault key into a live provider call.
// This slice ships the per-provider request/response adapters (pure +
// unit-tested) and a bounded "test connection" that pings the provider.
// The full fallback-chain execution path wires into ai.service later,
// reusing these same adapters.
// =====================================================================

const DEFAULT_BASE_URL: Record<AiProviderKey, string | null> = {
  OPENAI: "https://api.openai.com/v1",
  ANTHROPIC: "https://api.anthropic.com",
  GEMINI: "https://generativelanguage.googleapis.com/v1beta",
  DEEPSEEK: "https://api.deepseek.com",
  GROK: "https://api.x.ai/v1",
  REPLICATE: "https://api.replicate.com", // image/QR generation only — not a chat provider
  CUSTOM: null, // must supply baseUrl
};

const DEFAULT_MODEL: Record<AiProviderKey, string | null> = {
  OPENAI: "gpt-4o-mini",
  ANTHROPIC: "claude-3-5-sonnet-20241022",
  GEMINI: "gemini-1.5-flash",
  DEEPSEEK: "deepseek-chat",
  GROK: "grok-2-latest",
  REPLICATE: null, // the Replicate model path/version comes from the config
  CUSTOM: null,
};

const OPENAI_COMPATIBLE: ReadonlySet<AiProviderKey> = new Set([
  AiProviderKey.OPENAI,
  AiProviderKey.DEEPSEEK,
  AiProviderKey.GROK,
  AiProviderKey.CUSTOM,
]);

export interface ProviderRequestInput {
  provider: AiProviderKey;
  apiKey: string;
  prompt: string;
  model?: string | null;
  baseUrl?: string | null;
  maxTokens?: number;
}

export interface ProviderHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  provider: AiProviderKey;
  model: string;
}

function resolveModel(provider: AiProviderKey, model?: string | null): string {
  const m = (model ?? "").trim() || DEFAULT_MODEL[provider];
  if (!m) {
    throw new Error(`A model is required for ${provider}.`);
  }
  return m;
}

function resolveBaseUrl(provider: AiProviderKey, baseUrl?: string | null): string {
  const b = (baseUrl ?? "").trim().replace(/\/+$/, "") || DEFAULT_BASE_URL[provider];
  if (!b) {
    throw new Error(`A base URL is required for ${provider}.`);
  }
  return b;
}

/**
 * Build the HTTP request for a single chat/completion turn. Pure — does no
 * I/O — so the per-provider wire format is unit-testable.
 */
export function buildProviderRequest(input: ProviderRequestInput): ProviderHttpRequest {
  const model = resolveModel(input.provider, input.model);
  const base = resolveBaseUrl(input.provider, input.baseUrl);
  const maxTokens = input.maxTokens ?? 64;

  if (input.provider === AiProviderKey.ANTHROPIC) {
    return {
      provider: input.provider,
      model,
      url: `${base}/v1/messages`,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: input.prompt }],
      },
    };
  }

  if (input.provider === AiProviderKey.GEMINI) {
    return {
      provider: input.provider,
      model,
      url: `${base}/models/${model}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
      headers: { "content-type": "application/json" },
      body: {
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      },
    };
  }

  if (OPENAI_COMPATIBLE.has(input.provider)) {
    return {
      provider: input.provider,
      model,
      url: `${base}/chat/completions`,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: input.prompt }],
      },
    };
  }

  throw new Error(`Unsupported provider: ${input.provider}`);
}

/** Extract the assistant text from a provider's JSON response. Pure. */
export function parseProviderResponse(
  provider: AiProviderKey,
  json: unknown,
): string {
  const j = json as Record<string, any>;
  if (provider === AiProviderKey.ANTHROPIC) {
    return String(j?.content?.[0]?.text ?? "").trim();
  }
  if (provider === AiProviderKey.GEMINI) {
    return String(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
  }
  // OpenAI-compatible
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}

export interface ProviderTestResult {
  ok: boolean;
  provider: AiProviderKey;
  model: string | null;
  sample?: string;
  message: string;
}

/**
 * Live connectivity test: resolve the config + its vault key, send a tiny
 * prompt, and report success/failure. Bounded (max ~16 tokens). Uses the
 * caller's scope so a config can only test a key it owns.
 */
export async function testProviderConnection(
  ctx: SecretContext,
  configId: string,
): Promise<ProviderTestResult> {
  const cfg = await getProvider(ctx, configId); // throws 404 if not owned
  const provider = cfg.provider;

  const apiKey = await resolveSecretValue(ctx, cfg.secretId);
  if (!apiKey) {
    return {
      ok: false,
      provider,
      model: cfg.defaultModel,
      message: "No active vault secret is linked to this provider.",
    };
  }

  let req: ProviderHttpRequest;
  try {
    req = buildProviderRequest({
      provider,
      apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.defaultModel,
      prompt: "Reply with the single word: OK",
      maxTokens: 16,
    });
  } catch (e) {
    return {
      ok: false,
      provider,
      model: cfg.defaultModel,
      message: e instanceof Error ? e.message : "Could not build provider request.",
    };
  }

  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return {
        ok: false,
        provider,
        model: req.model,
        message: `Provider responded ${res.status}: ${detail || res.statusText}`,
      };
    }
    const json = await res.json();
    const text = parseProviderResponse(provider, json);
    return {
      ok: true,
      provider,
      model: req.model,
      sample: text.slice(0, 200),
      message: "Provider reachable and key accepted.",
    };
  } catch (e) {
    return {
      ok: false,
      provider,
      model: req.model,
      message: e instanceof Error ? e.message : "Network error contacting provider.",
    };
  }
}

// ---------------------------------------------------------------------
// Live chat with fallback (Phase 4 "fallback models"). Walks the resolved
// provider chain and returns the first success. Usage is returned so the
// caller (route) can record AiUsage against the actor's tenant.
// ---------------------------------------------------------------------

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult extends ChatUsage {
  provider: AiProviderKey;
  model: string;
  text: string;
}

/** Extract token usage from a provider response. Pure. */
export function parseUsage(provider: AiProviderKey, json: unknown): ChatUsage {
  const j = json as Record<string, any>;
  if (provider === AiProviderKey.ANTHROPIC) {
    return {
      inputTokens: Number(j?.usage?.input_tokens ?? 0),
      outputTokens: Number(j?.usage?.output_tokens ?? 0),
    };
  }
  if (provider === AiProviderKey.GEMINI) {
    return {
      inputTokens: Number(j?.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Number(j?.usageMetadata?.candidatesTokenCount ?? 0),
    };
  }
  // OpenAI-compatible
  return {
    inputTokens: Number(j?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(j?.usage?.completion_tokens ?? 0),
  };
}

export interface ChainOps {
  /** Resolve the plaintext key for a chain entry (null = skip entry). */
  getKey: (entry: ProviderChainEntry) => Promise<string | null>;
  /** Send the prompt to a provider; throws to trigger fallback. */
  send: (entry: ProviderChainEntry, key: string) => Promise<ChatResult>;
}

export interface ChainAttempt {
  provider: AiProviderKey;
  reason: string;
}

/**
 * Walk the fallback chain: skip entries with no key, try each provider in
 * order, return the first success. Throws (502) with per-provider failure
 * reasons when the chain is exhausted. I/O is injected via `ops`, so the
 * fallback logic is unit-testable offline.
 */
export async function runChatViaChain(
  chain: ProviderChainEntry[],
  ops: ChainOps,
): Promise<ChatResult> {
  const attempts: ChainAttempt[] = [];
  for (const entry of chain) {
    const key = await ops.getKey(entry);
    if (!key) {
      attempts.push({ provider: entry.provider, reason: "no vault key linked" });
      continue;
    }
    try {
      return await ops.send(entry, key);
    } catch (e) {
      attempts.push({
        provider: entry.provider,
        reason: e instanceof Error ? e.message : "provider call failed",
      });
    }
  }
  const detail = attempts.length
    ? attempts.map((a) => `${a.provider}: ${a.reason}`).join("; ")
    : "no AI providers configured for this scope";
  throw new ApiError(
    ErrorCodes.INTERNAL_SERVER_ERROR,
    502,
    `AI providers exhausted (${detail}).`,
  );
}

export interface ChatInput {
  prompt: string;
  system?: string;
  kind?: AiProviderKind;
}

/**
 * Resolve the caller's provider chain and run a chat completion with
 * fallback, using each provider's vault key. Returns the first success.
 */
export async function chatViaHub(
  ctx: SecretContext,
  input: ChatInput,
): Promise<ChatResult> {
  const chain = await resolveProviderChain(ctx, input.kind ?? AiProviderKind.TEXT);
  const prompt = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;

  return runChatViaChain(chain, {
    getKey: (entry) => resolveSecretValue(ctx, entry.secretId),
    send: async (entry, key) => {
      const req = buildProviderRequest({
        provider: entry.provider,
        apiKey: key,
        baseUrl: entry.baseUrl,
        model: entry.defaultModel,
        prompt,
        maxTokens: 1024,
      });
      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const json = await res.json();
      return {
        provider: entry.provider,
        model: req.model,
        text: parseProviderResponse(entry.provider, json),
        ...parseUsage(entry.provider, json),
      };
    },
  });
}
