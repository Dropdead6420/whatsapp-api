import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  prisma,
  AiAgent,
  AiAgentStatus,
  AiAgentFallback,
  KnowledgeBaseCategory,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  retrieveKnowledge,
  KnowledgeRetrievalResult,
} from "./knowledgeBaseEmbedding.service";
import { assertCanAffordAi, debitAi } from "./billing.service";

// T-052 slice 2: AI Agent runtime.
//
// Takes a configured AiAgent + the live conversation and produces a reply
// grounded against the tenant's Knowledge Base (T-051). No tool dispatch
// happens here yet — we return the tool calls the model proposes so the
// caller (slice 3's flow node + inbound handler) can decide whether to
// execute them.
//
// Provider routing:
//   - agent.provider === "anthropic"  -> Anthropic SDK + agent.model
//   - agent.provider === "openai"     -> OpenAI SDK + agent.model
//   - If the requested provider's API key isn't configured but the OTHER
//     provider's is, we fall back rather than 500. The agent still works
//     just on a different model; we log the swap on the response so the
//     operator can see what happened.
//   - If neither is configured, we apply the agent's fallbackBehavior
//     immediately (no LLM call). This is the same path we take on a
//     provider error mid-call.

const MAX_HISTORY_MESSAGES = 12;
const MAX_KB_RESULTS = 8;
const MAX_KB_SNIPPET_CHARS = 600;

// Pricing (USD per token) — used purely for AiUsage cost tracking, not for
// blocking; the wallet debit happens via `debitAi`.
const PRICING: Record<string, { input: number; output: number }> = {
  // Claude 3.5 / 3 family
  "claude-3-5-sonnet-latest": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-3-5-haiku-latest": { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  "claude-3-opus-latest": { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  // OpenAI
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4-turbo": { input: 10 / 1_000_000, output: 30 / 1_000_000 },
  "gpt-3.5-turbo": { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
};

function priceOf(model: string): { input: number; output: number } {
  return PRICING[model] ?? { input: 0, output: 0 };
}

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function isUsableKey(key: string | undefined): boolean {
  const trimmed = key?.trim();
  return Boolean(
    trimmed &&
      !trimmed.startsWith("your_") &&
      !trimmed.includes("placeholder") &&
      trimmed !== "test",
  );
}

function getAnthropic(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  if (!isUsableKey(process.env.ANTHROPIC_API_KEY)) return null;
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return anthropicClient;
}

function getOpenAi(): OpenAI | null {
  if (openaiClient) return openaiClient;
  if (!isUsableKey(process.env.OPENAI_API_KEY)) return null;
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return openaiClient;
}

export interface AgentConversationMessage {
  // The role from the AGENT's perspective — "user" = the human on
  // WhatsApp, "assistant" = previous bot replies. We translate to each
  // provider's wire format inside callLlm.
  role: "user" | "assistant";
  content: string;
}

export interface RunAgentInput {
  tenantId: string;
  agentId: string;
  // Trailing conversation history. The LAST entry should be the user's
  // latest inbound message — that's what drives KB retrieval.
  conversation: AgentConversationMessage[];
  // Optional: a hint that the caller (the flow node, the inbound
  // handler) can pass to bias retrieval. e.g. {"customerName": "Sid"}.
  context?: Record<string, string>;
}

export interface AgentCitation {
  entryId: string;
  title: string;
  category: KnowledgeBaseCategory;
  score: number;
  snippet: string;
}

export interface AgentToolCall {
  // Tool key from AiAgent.tools (CREATE_LEAD, BOOK_APPOINTMENT, etc.).
  // The runner doesn't execute; it surfaces what the model asked for.
  tool: string;
  arguments: Record<string, unknown>;
}

export type AgentRunReason =
  | "ok"
  | "fallback_no_llm_configured"
  | "fallback_no_active_agent"
  | "fallback_llm_error"
  | "fallback_empty_user_message";

export interface AgentRunResult {
  reply: string | null;
  toolCalls: AgentToolCall[];
  citations: AgentCitation[];
  // True when the runner returned without producing a reply, expecting
  // the caller to escalate to a human or send the fallback template.
  escalated: boolean;
  // What the agent intends the caller to do on escalation — mirrors
  // AiAgent.fallbackBehavior. Null when reply != null.
  escalationBehavior: AiAgentFallback | null;
  // Debug — which provider/model produced the reply, or what reason
  // we short-circuited on.
  modelUsed: string | null;
  providerUsed: "anthropic" | "openai" | null;
  reason: AgentRunReason;
}

// ----------------------------------------------------------------------------
// Helpers — prompt assembly + provider dispatch
// ----------------------------------------------------------------------------

function lastUserMessage(conversation: AgentConversationMessage[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === "user") return conversation[i].content;
  }
  return "";
}

function clampHistory(
  conversation: AgentConversationMessage[],
): AgentConversationMessage[] {
  // Keep the trailing N to bound token spend; older context can be
  // reconstructed from the conversation log if the agent needs it.
  if (conversation.length <= MAX_HISTORY_MESSAGES) return conversation;
  return conversation.slice(-MAX_HISTORY_MESSAGES);
}

function trimSnippet(s: string): string {
  if (s.length <= MAX_KB_SNIPPET_CHARS) return s;
  return s.slice(0, MAX_KB_SNIPPET_CHARS - 1) + "…";
}

function buildSystemPrompt(
  agent: AiAgent,
  knowledge: KnowledgeRetrievalResult,
  context: Record<string, string> | undefined,
): string {
  const parts: string[] = [];
  parts.push(agent.persona);

  if (knowledge.results.length > 0) {
    parts.push("");
    parts.push(
      "You have access to the following knowledge-base entries. Cite them when relevant and never invent facts not present in this list:",
    );
    knowledge.results.forEach((r, i) => {
      const summary = r.summary?.trim() ? `\nSummary: ${r.summary.trim()}` : "";
      parts.push(
        `[KB-${i + 1}] (${r.category}) ${r.title}${summary}\n${trimSnippet(r.content)}`,
      );
    });
    parts.push("");
    parts.push(
      "When you use a KB entry, end the sentence with [KB-N] where N matches the index above. If the customer asks something the KB doesn't cover, say so honestly instead of guessing.",
    );
  }

  if (agent.tools.length > 0) {
    parts.push("");
    parts.push(
      `If the conversation needs an action, propose ONE of these tools by returning JSON like {"tool":"TOOL_NAME","arguments":{...}}: ${agent.tools.join(", ")}.`,
    );
    parts.push(
      "Otherwise reply with plain text. Never return both prose and tool JSON in the same response.",
    );
  }

  if (context && Object.keys(context).length > 0) {
    parts.push("");
    parts.push("Conversation context:");
    for (const [k, v] of Object.entries(context)) {
      parts.push(`  ${k}: ${v}`);
    }
  }

  return parts.join("\n");
}

function extractToolCallIfAny(reply: string, allowedTools: string[]): {
  text: string | null;
  toolCalls: AgentToolCall[];
} {
  if (!allowedTools.length) return { text: reply, toolCalls: [] };

  // Look for a fenced JSON block or a leading {"tool":"..."} response.
  // We're deliberately permissive — both Claude and gpt-4 occasionally
  // wrap JSON in markdown fences.
  const fenceMatch = reply.match(/```(?:json)?\s*([\s\S]+?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : reply.trim();
  const looksLikeJson =
    candidate.startsWith("{") && candidate.includes('"tool"');
  if (!looksLikeJson) return { text: reply, toolCalls: [] };

  try {
    const parsed = JSON.parse(candidate);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.tool === "string" &&
      allowedTools.includes(parsed.tool.toUpperCase())
    ) {
      const args =
        parsed.arguments && typeof parsed.arguments === "object"
          ? (parsed.arguments as Record<string, unknown>)
          : {};
      return {
        text: null,
        toolCalls: [{ tool: parsed.tool.toUpperCase(), arguments: args }],
      };
    }
  } catch {
    // Not actually JSON — fall through and return as plain text.
  }
  return { text: reply, toolCalls: [] };
}

interface LlmCallArgs {
  provider: "anthropic" | "openai";
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  history: AgentConversationMessage[];
}

interface LlmCallResult {
  reply: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(args: LlmCallArgs): Promise<LlmCallResult> {
  if (args.provider === "anthropic") {
    const client = getAnthropic();
    if (!client) throw new Error("anthropic_unavailable");
    const response = await client.messages.create({
      model: args.model,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      system: args.system,
      messages: args.history.map((m) => ({ role: m.role, content: m.content })),
    });
    const textBlock = response.content.find((c) => c.type === "text");
    return {
      reply: textBlock?.type === "text" ? textBlock.text : "",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  // openai
  const client = getOpenAi();
  if (!client) throw new Error("openai_unavailable");
  const response = await client.chat.completions.create({
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    messages: [
      { role: "system", content: args.system },
      ...args.history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  });
  const choice = response.choices[0];
  return {
    reply: choice?.message?.content ?? "",
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

function pickProvider(
  agent: AiAgent,
): { provider: "anthropic" | "openai"; model: string } | null {
  const desired = agent.provider as "anthropic" | "openai";
  const desiredOk =
    desired === "anthropic" ? getAnthropic() !== null : getOpenAi() !== null;
  if (desiredOk) return { provider: desired, model: agent.model };

  // Fall back to whichever provider IS configured. We can't honor the
  // exact model, so pick a sensible default for the fallback provider.
  if (desired === "openai" && getAnthropic()) {
    return { provider: "anthropic", model: "claude-3-5-haiku-latest" };
  }
  if (desired === "anthropic" && getOpenAi()) {
    return { provider: "openai", model: "gpt-4o-mini" };
  }
  return null;
}

function escalation(
  behavior: AiAgentFallback,
  reason: AgentRunReason,
): AgentRunResult {
  return {
    reply: null,
    toolCalls: [],
    citations: [],
    escalated: true,
    escalationBehavior: behavior,
    modelUsed: null,
    providerUsed: null,
    reason,
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  });
  if (!agent) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "AI agent not found.");
  }
  // Only ACTIVE agents run. DRAFT/DISABLED/ARCHIVED → escalate so the
  // caller can route to a human or send a fallback template. This is
  // intentional: an operator who pulls an agent offline expects new
  // inbound messages to stop being auto-answered immediately.
  if (agent.status !== ("ACTIVE" as AiAgentStatus)) {
    return escalation(agent.fallbackBehavior, "fallback_no_active_agent");
  }

  const lastUser = lastUserMessage(input.conversation).trim();
  if (!lastUser) {
    return escalation(agent.fallbackBehavior, "fallback_empty_user_message");
  }

  const picked = pickProvider(agent);
  if (!picked) {
    return escalation(agent.fallbackBehavior, "fallback_no_llm_configured");
  }

  // Knowledge retrieval — scoped by the agent's knowledgeScope. We loop
  // through configured categories so a single agent can pull from FAQ
  // + POLICY + SERVICE without needing N agents.
  const scope = agent.knowledgeScope as {
    categories?: string[];
    tags?: string[];
    topK?: number;
  };
  const topK = Math.min(
    MAX_KB_RESULTS,
    Math.max(1, Math.floor(scope.topK ?? 5)),
  );
  let knowledge: KnowledgeRetrievalResult = {
    query: lastUser,
    embeddingModel: "none",
    results: [],
  };
  try {
    if (!scope.categories || scope.categories.length === 0) {
      knowledge = await retrieveKnowledge(input.tenantId, {
        query: lastUser,
        limit: topK,
        tags: scope.tags?.length ? scope.tags : undefined,
      });
    } else {
      // Round-robin across categories so one large category doesn't
      // crowd out the others. Quick & cheap; we can swap for a single
      // multi-category query when KB volume grows.
      const perCat = Math.max(1, Math.ceil(topK / scope.categories.length));
      const allResults: KnowledgeRetrievalResult["results"] = [];
      let embeddingModel = "none";
      for (const cat of scope.categories) {
        const partial = await retrieveKnowledge(input.tenantId, {
          query: lastUser,
          limit: perCat,
          category: cat as KnowledgeBaseCategory,
          tags: scope.tags?.length ? scope.tags : undefined,
        });
        embeddingModel = partial.embeddingModel;
        allResults.push(...partial.results);
      }
      // Re-sort the merged set and clamp to topK.
      knowledge = {
        query: lastUser,
        embeddingModel,
        results: allResults.sort((a, b) => b.score - a.score).slice(0, topK),
      };
    }
  } catch (err) {
    // KB retrieval failure shouldn't kill the agent — log + continue
    // with an empty grounding context. The model will then either
    // answer from persona only or say "I don't know" (which is fine).
    console.warn("[ai-agent] KB retrieval failed; continuing ungrounded", err);
  }

  await assertCanAffordAi(input.tenantId, `ai_agent:${agent.id}`);

  const system = buildSystemPrompt(agent, knowledge, input.context);
  const history = clampHistory(input.conversation);

  let llmResult: LlmCallResult;
  try {
    llmResult = await callLlm({
      provider: picked.provider,
      model: picked.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      system,
      history,
    });
  } catch (err) {
    console.error("[ai-agent] LLM call failed; escalating", err);
    return escalation(agent.fallbackBehavior, "fallback_llm_error");
  }

  // Wallet bookkeeping. Best-effort — a logging failure must not
  // suppress the reply that the LLM already produced.
  try {
    const pricing = priceOf(picked.model);
    const costInCents = Math.ceil(
      (llmResult.inputTokens * pricing.input +
        llmResult.outputTokens * pricing.output) *
        100,
    );
    const usage = await prisma.aiUsage.create({
      data: {
        tenantId: input.tenantId,
        model: picked.model,
        feature: `ai_agent:${agent.id}`,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        costInCents,
      },
    });
    await debitAi(input.tenantId, {
      aiUsageId: usage.id,
      feature: `ai_agent:${agent.id}`,
      reason: `AI agent "${agent.name}"`,
    });
  } catch (err) {
    console.error("[ai-agent] usage/debit logging failed", err);
  }

  const { text, toolCalls } = extractToolCallIfAny(
    llmResult.reply,
    agent.tools,
  );

  return {
    reply: text,
    toolCalls,
    citations: knowledge.results.map((r) => ({
      entryId: r.id,
      title: r.title,
      category: r.category,
      score: r.score,
      snippet: r.snippet,
    })),
    escalated: false,
    escalationBehavior: null,
    modelUsed: picked.model,
    providerUsed: picked.provider,
    reason: "ok",
  };
}

export const __test__ = {
  buildSystemPrompt,
  extractToolCallIfAny,
  pickProvider,
  lastUserMessage,
  clampHistory,
};
