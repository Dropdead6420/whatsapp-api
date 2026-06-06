import { describe, expect, it } from "vitest";
import { AiProviderKey, AiProviderKind } from "@nexaflow/db";
import {
  buildProviderRequest,
  parseProviderResponse,
  parseUsage,
  runChatViaChain,
  type ChatResult,
} from "./aiGateway.service";

function chainEntry(over: Record<string, unknown> = {}) {
  return {
    id: "cfg1",
    provider: AiProviderKey.OPENAI,
    kind: AiProviderKind.TEXT,
    defaultModel: "gpt-4o-mini",
    baseUrl: null,
    secretId: "sv1",
    hasKey: true,
    ...over,
  };
}

function ok(provider: AiProviderKey): ChatResult {
  return { provider, model: "m", text: "hi", inputTokens: 1, outputTokens: 1 };
}

describe("buildProviderRequest", () => {
  it("Anthropic → /v1/messages with x-api-key and default model", () => {
    const r = buildProviderRequest({
      provider: AiProviderKey.ANTHROPIC,
      apiKey: "sk-ant",
      prompt: "hi",
    });
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers["x-api-key"]).toBe("sk-ant");
    expect(r.headers["anthropic-version"]).toBe("2023-06-01");
    expect(r.model).toBe("claude-3-5-sonnet-20241022");
    expect((r.body as any).messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("OpenAI → /chat/completions with Bearer auth + default model", () => {
    const r = buildProviderRequest({
      provider: AiProviderKey.OPENAI,
      apiKey: "sk-oa",
      prompt: "hi",
    });
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.headers.Authorization).toBe("Bearer sk-oa");
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("DeepSeek + Grok use their own default base URLs", () => {
    expect(
      buildProviderRequest({ provider: AiProviderKey.DEEPSEEK, apiKey: "k", prompt: "x" }).url,
    ).toBe("https://api.deepseek.com/chat/completions");
    expect(
      buildProviderRequest({ provider: AiProviderKey.GROK, apiKey: "k", prompt: "x" }).url,
    ).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("Gemini → generateContent with key in query + contents body", () => {
    const r = buildProviderRequest({
      provider: AiProviderKey.GEMINI,
      apiKey: "g k",
      prompt: "hi",
      model: "gemini-1.5-pro",
    });
    expect(r.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=g%20k",
    );
    expect((r.body as any).contents[0].parts[0].text).toBe("hi");
  });

  it("honors an explicit baseUrl and trims trailing slashes", () => {
    const r = buildProviderRequest({
      provider: AiProviderKey.OPENAI,
      apiKey: "k",
      prompt: "x",
      baseUrl: "https://proxy.local/v1/",
    });
    expect(r.url).toBe("https://proxy.local/v1/chat/completions");
  });

  it("CUSTOM requires a baseUrl and model", () => {
    expect(() =>
      buildProviderRequest({ provider: AiProviderKey.CUSTOM, apiKey: "k", prompt: "x", model: "m" }),
    ).toThrow(/base URL/i);
    expect(() =>
      buildProviderRequest({
        provider: AiProviderKey.CUSTOM,
        apiKey: "k",
        prompt: "x",
        baseUrl: "https://x/v1",
      }),
    ).toThrow(/model/i);
    // With both, it builds an OpenAI-compatible request.
    const r = buildProviderRequest({
      provider: AiProviderKey.CUSTOM,
      apiKey: "k",
      prompt: "x",
      baseUrl: "https://x/v1",
      model: "m",
    });
    expect(r.url).toBe("https://x/v1/chat/completions");
  });
});

describe("parseProviderResponse", () => {
  it("Anthropic content blocks", () => {
    expect(
      parseProviderResponse(AiProviderKey.ANTHROPIC, { content: [{ text: " OK " }] }),
    ).toBe("OK");
  });
  it("OpenAI-compatible choices", () => {
    expect(
      parseProviderResponse(AiProviderKey.OPENAI, {
        choices: [{ message: { content: "hello" } }],
      }),
    ).toBe("hello");
  });
  it("Gemini candidates", () => {
    expect(
      parseProviderResponse(AiProviderKey.GEMINI, {
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
      }),
    ).toBe("hi");
  });
  it("returns empty string on missing/garbage shapes", () => {
    expect(parseProviderResponse(AiProviderKey.OPENAI, {})).toBe("");
    expect(parseProviderResponse(AiProviderKey.ANTHROPIC, null)).toBe("");
  });
});

describe("parseUsage", () => {
  it("Anthropic usage", () => {
    expect(
      parseUsage(AiProviderKey.ANTHROPIC, { usage: { input_tokens: 12, output_tokens: 7 } }),
    ).toEqual({ inputTokens: 12, outputTokens: 7 });
  });
  it("OpenAI usage", () => {
    expect(
      parseUsage(AiProviderKey.OPENAI, { usage: { prompt_tokens: 5, completion_tokens: 9 } }),
    ).toEqual({ inputTokens: 5, outputTokens: 9 });
  });
  it("Gemini usageMetadata", () => {
    expect(
      parseUsage(AiProviderKey.GEMINI, {
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      }),
    ).toEqual({ inputTokens: 3, outputTokens: 4 });
  });
  it("defaults to zero when absent", () => {
    expect(parseUsage(AiProviderKey.OPENAI, {})).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("runChatViaChain (fallback orchestration)", () => {
  it("skips entries with no key and uses the next that succeeds", async () => {
    const tried: string[] = [];
    const result = await runChatViaChain(
      [chainEntry({ provider: AiProviderKey.ANTHROPIC }), chainEntry({ provider: AiProviderKey.OPENAI })],
      {
        getKey: async (e) => (e.provider === AiProviderKey.ANTHROPIC ? null : "key"),
        send: async (e) => {
          tried.push(e.provider);
          return ok(e.provider);
        },
      },
    );
    expect(result.provider).toBe(AiProviderKey.OPENAI);
    expect(tried).toEqual([AiProviderKey.OPENAI]); // anthropic skipped (no key)
  });

  it("falls back to the next provider when one throws", async () => {
    const result = await runChatViaChain(
      [chainEntry({ provider: AiProviderKey.OPENAI }), chainEntry({ provider: AiProviderKey.GEMINI })],
      {
        getKey: async () => "key",
        send: async (e) => {
          if (e.provider === AiProviderKey.OPENAI) throw new Error("429");
          return ok(e.provider);
        },
      },
    );
    expect(result.provider).toBe(AiProviderKey.GEMINI);
  });

  it("throws 502 when the whole chain is exhausted", async () => {
    await expect(
      runChatViaChain([chainEntry()], {
        getKey: async () => "key",
        send: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws when no providers are configured", async () => {
    await expect(
      runChatViaChain([], { getKey: async () => "k", send: async () => ok(AiProviderKey.OPENAI) }),
    ).rejects.toThrow(/no AI providers configured/i);
  });
});
