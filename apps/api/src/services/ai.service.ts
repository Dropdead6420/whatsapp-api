import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import {
  ApiError,
  ErrorCodes,
  GenerateCopyPayload,
  GeneratedCopyVariant,
} from "@nexaflow/shared";
import { prisma } from "@nexaflow/db";
import { assertCanAffordAi, debitAi } from "./billing.service";
import { retrieveKnowledge } from "./knowledgeBaseEmbedding.service";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";

// Pricing (USD per token) for cost tracking — Claude 3.5 Sonnet.
const INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

let client: Anthropic | null = null;
function hasConfiguredAiClient(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return Boolean(apiKey && !apiKey.startsWith("your_") && apiKey !== "sk-ant-placeholder");
}

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!hasConfiguredAiClient()) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "ANTHROPIC_API_KEY is not configured. Set a real key in the API .env to enable AI features.",
    );
  }
  client = new Anthropic({ apiKey: apiKey! });
  return client;
}

// ----------------------------------------------------------------------------
// JSON-mode helper. Claude is told to return JSON; we parse defensively.
// ----------------------------------------------------------------------------

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "AI provider returned non-JSON output.",
    );
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "AI provider returned malformed JSON.",
    );
  }
}

interface CallLlmOpts {
  tenantId: string;
  feature: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

/** Exported for workflow AI nodes (T-050). */
export async function runTenantLlmJson<T>(opts: CallLlmOpts): Promise<T> {
  return callLlmJson<T>(opts);
}

async function callLlmJson<T>(opts: CallLlmOpts): Promise<T> {
  const anthropic = getClient();
  await assertCanAffordAi(opts.tenantId, opts.feature);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw) as T;

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costInCents = Math.ceil(
    (inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN) *
      100,
  );

  try {
    const usage = await prisma.aiUsage.create({
      data: {
        tenantId: opts.tenantId,
        model: MODEL,
        feature: opts.feature,
        inputTokens,
        outputTokens,
        costInCents,
      },
    });
    await debitAi(opts.tenantId, {
      aiUsageId: usage.id,
      feature: opts.feature,
      reason: `AI call (${opts.feature})`,
    });
  } catch (err) {
    console.error("[ai] failed to log usage/debit", err);
  }

  return parsed;
}

// ============================================================================
// Existing: AI Copy Generator
// ============================================================================

const CHANNEL_GUIDANCE: Record<GenerateCopyPayload["channel"], string> = {
  whatsapp:
    "WhatsApp business message: under 1024 characters, conversational, no aggressive emojis, max one CTA, mention opt-out if promotional.",
  facebook_ad:
    "Facebook ad copy: punchy hook in the first 125 characters, clear value prop, single CTA, no clickbait.",
  google_ad:
    "Google Search ad: headline under 30 characters, description under 90 characters, include keyword naturally.",
  email:
    "Email body: subject line + 2-3 short paragraphs + CTA button text. Use plain text formatting.",
  sms: "SMS: under 160 characters, include opt-out instruction (Reply STOP).",
  instagram_caption:
    "Instagram caption: 1-2 short paragraphs, 3-5 relevant hashtags, light emoji use.",
};

export async function generateCopy(
  tenantId: string,
  payload: GenerateCopyPayload,
): Promise<GeneratedCopyVariant[]> {
  const lines = [
    `Generate ${payload.variantCount ?? 3} distinct copy variants.`,
    `Channel: ${payload.channel}`,
    `Channel rules: ${CHANNEL_GUIDANCE[payload.channel]}`,
    payload.brandName ? `Brand: ${payload.brandName}` : "",
    payload.audienceDescription ? `Audience: ${payload.audienceDescription}` : "",
    payload.tone ? `Tone: ${payload.tone}` : "Tone: friendly-professional",
    "",
    `Goal: ${payload.prompt}`,
    "",
    'Return JSON: {"variants":[{"text":"..."}]}',
  ].filter(Boolean);

  const parsed = await callLlmJson<{ variants: Array<{ text: string }> }>({
    tenantId,
    feature: "copywriting",
    system:
      "You are a senior performance marketing copywriter for a multi-tenant SaaS called NexaFlow.",
    prompt: lines.join("\n"),
    maxTokens: 800,
    temperature: 0.8,
  });

  if (!parsed?.variants?.length) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "AI returned no variants.",
    );
  }

  return parsed.variants.map((v) => ({
    id: crypto.randomUUID(),
    text: String(v.text).trim(),
  }));
}

// ============================================================================
// NEW (V2): AI Smart Segmentation — natural language → contact filter spec
// ============================================================================

export interface SegmentFilterSpec {
  reasoning?: string;
  tagsAny?: string[];
  tagsAll?: string[];
  optedOut?: boolean;
  inactiveSinceDays?: number;
  interactedWithinDays?: number;
  aiScoreGte?: number;
  aiScoreLte?: number;
  hasEmail?: boolean;
}

const SEGMENT_SCHEMA_DESCRIPTION = `{
  "reasoning": "one-sentence explanation of the segment",
  "tagsAny": ["optional list of tags — match contacts with ANY of these"],
  "tagsAll": ["optional list of tags — match contacts with ALL of these"],
  "optedOut": "optional bool — if user asks for active customers, use false",
  "inactiveSinceDays": "optional number — last interaction older than N days",
  "interactedWithinDays": "optional number — last interaction within N days",
  "aiScoreGte": "optional number 0-1 — AI lead score >= this",
  "aiScoreLte": "optional number 0-1 — AI lead score <= this",
  "hasEmail": "optional bool"
}`;

export async function describeSegmentFilter(
  tenantId: string,
  request: string,
  availableTags: string[],
): Promise<SegmentFilterSpec> {
  const tagsStr =
    availableTags.length > 0
      ? availableTags.slice(0, 200).join(", ")
      : "(no tags exist yet)";

  const prompt = [
    `User request: "${request}"`,
    "",
    `Available tags in the tenant's CRM: ${tagsStr}`,
    "",
    "Translate the request into a filter spec. Only use fields you need.",
    "Only reference tags that exist in the available list above.",
    "Return ONLY this JSON shape, no commentary:",
    SEGMENT_SCHEMA_DESCRIPTION,
  ].join("\n");

  return callLlmJson<SegmentFilterSpec>({
    tenantId,
    feature: "smart_segmentation",
    system:
      "You translate plain-English audience descriptions into structured filter specs for a WhatsApp marketing CRM. Be conservative — never invent tags that don't exist. Output strict JSON.",
    prompt,
    maxTokens: 400,
    temperature: 0.2,
  });
}

// ============================================================================
// NEW (V2): AI Lead Scoring
// ============================================================================

export interface LeadScoreResult {
  score: number; // 0-100
  probability: number; // 0-1
  reasoning: string;
  topSignals: string[];
}

export async function scoreLead(
  tenantId: string,
  context: {
    contactName: string;
    tags: string[];
    customFields: Record<string, unknown>;
    daysSinceCreated: number;
    daysSinceLastInteraction: number | null;
    inboundMessages: number;
    outboundMessages: number;
    openLeadsCount: number;
    leadTitles: string[];
  },
): Promise<LeadScoreResult> {
  const prompt = [
    "Score this prospect's likelihood to convert in the next 14 days.",
    "Output a score 0-100 (higher = more likely), a probability 0-1, one-sentence reasoning, and up to 3 top signals.",
    "",
    `Name: ${context.contactName}`,
    `Tags: ${context.tags.join(", ") || "(none)"}`,
    `Custom fields: ${JSON.stringify(context.customFields)}`,
    `Days since contact created: ${context.daysSinceCreated}`,
    `Days since last interaction: ${context.daysSinceLastInteraction ?? "never interacted"}`,
    `Inbound messages from contact: ${context.inboundMessages}`,
    `Outbound messages to contact: ${context.outboundMessages}`,
    `Open leads on this contact: ${context.openLeadsCount}`,
    `Open lead titles: ${context.leadTitles.join("; ") || "(none)"}`,
    "",
    'Return JSON: {"score": 0-100, "probability": 0-1, "reasoning": "...", "topSignals": ["...","..."]}',
  ].join("\n");

  return callLlmJson<LeadScoreResult>({
    tenantId,
    feature: "lead_scoring",
    system:
      "You are a B2C sales analyst. Be calibrated: cold leads get low scores; engaged leads get high scores. Output strict JSON.",
    prompt,
    maxTokens: 400,
    temperature: 0.3,
  });
}

// ============================================================================
// NEW (V2): AI Reply Suggestions for the agent inbox
// ============================================================================

export interface ReplySuggestion {
  id: string;
  tone: "professional" | "friendly" | "apologetic" | "concise";
  text: string;
}

export async function suggestReplies(
  tenantId: string,
  args: {
    conversationContext: Array<{
      direction: "INBOUND" | "OUTBOUND";
      content: string;
    }>;
    contactName: string;
    businessName: string;
    languageHint?: string;
  },
): Promise<ReplySuggestion[]> {
  const transcript = args.conversationContext
    .slice(-12)
    .map(
      (m) =>
        `${m.direction === "INBOUND" ? args.contactName : args.businessName}: ${m.content}`,
    )
    .join("\n");
  const latestInbound =
    [...args.conversationContext]
      .reverse()
      .find((m) => m.direction === "INBOUND")?.content ?? transcript;
  let knowledgeContext = "";
  try {
    const knowledge = await retrieveKnowledge(tenantId, {
      query: latestInbound,
      limit: 3,
    });
    if (knowledge.results.length > 0) {
      knowledgeContext = knowledge.results
        .map((item, index) => {
          const body = item.summary || item.snippet || item.content.slice(0, 280);
          return `${index + 1}. ${item.title} (${item.category}, score ${item.score}): ${body}`;
        })
        .join("\n");
    }
  } catch (err) {
    console.warn(
      "[ai] knowledge-base retrieval skipped",
      err instanceof Error ? err.message : err,
    );
  }

  const prompt = [
    `Business: ${args.businessName}`,
    args.languageHint ? `Reply language: ${args.languageHint}` : "Reply language: match the customer's language",
    "",
    knowledgeContext
      ? `Approved knowledge base facts:\n${knowledgeContext}`
      : "Approved knowledge base facts: none found. Do not invent prices, policies, timings, or commitments.",
    "",
    "Conversation so far:",
    transcript,
    "",
    "Suggest 3 reply options the agent can send. Each option has a different tone.",
    "Each reply must be under 320 characters, polite, and address the most recent inbound message.",
    "Do not invent prices, policies, or commitments.",
    'Return JSON: {"suggestions":[{"tone":"professional","text":"..."},{"tone":"friendly","text":"..."},{"tone":"concise","text":"..."}]}',
  ].join("\n");

  const parsed = await callLlmJson<{
    suggestions: Array<{ tone: string; text: string }>;
  }>({
    tenantId,
    feature: "reply_suggestions",
    system:
      "You assist a human support agent. Match the customer's tone. Use approved knowledge base facts when relevant, and never hallucinate facts about the business. Output strict JSON.",
    prompt,
    maxTokens: 600,
    temperature: 0.6,
  });

  const allowedTones: ReplySuggestion["tone"][] = [
    "professional",
    "friendly",
    "apologetic",
    "concise",
  ];

  return (parsed?.suggestions ?? []).slice(0, 3).map((s) => ({
    id: crypto.randomUUID(),
    tone: allowedTones.includes(s.tone as ReplySuggestion["tone"])
      ? (s.tone as ReplySuggestion["tone"])
      : "friendly",
    text: String(s.text).trim(),
  }));
}

// ============================================================================
// NEW (V2): AI Sentiment Analysis
// ============================================================================

export interface SentimentResult {
  label: "positive" | "neutral" | "negative";
  score: number; // -1 (very negative) to +1 (very positive)
  summary: string;
}

export async function analyzeSentiment(
  tenantId: string,
  messages: Array<{ direction: "INBOUND" | "OUTBOUND"; content: string }>,
): Promise<SentimentResult> {
  const transcript = messages
    .slice(-15)
    .map((m) => `${m.direction === "INBOUND" ? "CUSTOMER" : "AGENT"}: ${m.content}`)
    .join("\n");

  const prompt = [
    "Analyze the CUSTOMER's overall sentiment in this conversation.",
    "Focus on inbound (customer) messages; agent replies are context.",
    "",
    transcript,
    "",
    'Return JSON: {"label":"positive|neutral|negative","score":-1.0 to 1.0,"summary":"one short sentence"}',
  ].join("\n");

  const parsed = await callLlmJson<SentimentResult>({
    tenantId,
    feature: "sentiment",
    system:
      "You are a CX analyst. Score sentiment from -1 to 1. Output strict JSON.",
    prompt,
    maxTokens: 200,
    temperature: 0.1,
  });

  // Clamp score and validate label.
  const score = Math.max(-1, Math.min(1, Number(parsed.score) || 0));
  const label: SentimentResult["label"] =
    parsed.label === "positive" || parsed.label === "negative"
      ? parsed.label
      : "neutral";
  return { label, score, summary: String(parsed.summary ?? "").trim() };
}

// ============================================================================
// NEW (V2 FLAGSHIP): AI Campaign Autopilot
// ============================================================================

export interface AutopilotDraft {
  goal: string;
  audienceDescription: string;
  audienceFilter: SegmentFilterSpec;
  estimatedAudienceSize?: number;
  messageVariants: Array<{ text: string; rationale: string }>;
  suggestedSendAt: string; // ISO
  followUpSequence: Array<{ delayHours: number; message: string }>;
  reasoning: string;
}

export async function planCampaignAutopilot(
  tenantId: string,
  args: {
    goal: string;
    businessName: string;
    businessType?: string;
    availableTags: string[];
  },
): Promise<AutopilotDraft> {
  const prompt = [
    `Business: ${args.businessName}${args.businessType ? ` (${args.businessType})` : ""}`,
    `Available CRM tags: ${args.availableTags.slice(0, 100).join(", ") || "(none)"}`,
    `Today (UTC): ${new Date().toISOString()}`,
    "",
    `User goal: "${args.goal}"`,
    "",
    "Plan a WhatsApp campaign end-to-end:",
    "1. Pick the right audience filter (only use tags that exist).",
    "2. Write 2 short message variants (max 320 chars each), conversational, single CTA.",
    "3. Suggest a send time in the next 7 days, optimized for high open rates.",
    "4. Design a 2-step follow-up sequence (each step: delayHours from send, short message).",
    "5. One-paragraph reasoning explaining the plan.",
    "",
    'Return strict JSON with shape:',
    '{',
    '  "audienceDescription": "...",',
    '  "audienceFilter": ' + SEGMENT_SCHEMA_DESCRIPTION.replace(/"reasoning":[^,]+,?/, '"reasoning":"...",') + ",",
    '  "messageVariants": [{"text":"...","rationale":"..."}, ...],',
    '  "suggestedSendAt": "ISO timestamp",',
    '  "followUpSequence": [{"delayHours": 24, "message": "..."}, {"delayHours": 72, "message": "..."}],',
    '  "reasoning": "..."',
    "}",
  ].join("\n");

  const parsed = await callLlmJson<{
    audienceDescription: string;
    audienceFilter: SegmentFilterSpec;
    messageVariants: Array<{ text: string; rationale: string }>;
    suggestedSendAt: string;
    followUpSequence: Array<{ delayHours: number; message: string }>;
    reasoning: string;
  }>({
    tenantId,
    feature: "campaign_autopilot",
    system:
      "You are NexaFlow's Campaign Autopilot. You design full WhatsApp campaigns. Never invent tags. Output strict JSON.",
    prompt,
    maxTokens: 1500,
    temperature: 0.5,
  });

  return {
    goal: args.goal,
    audienceDescription: parsed.audienceDescription,
    audienceFilter: parsed.audienceFilter,
    messageVariants: parsed.messageVariants ?? [],
    suggestedSendAt: parsed.suggestedSendAt,
    followUpSequence: parsed.followUpSequence ?? [],
    reasoning: parsed.reasoning,
  };
}

// ============================================================================
// NEW (V2): AI Follow-up Recommendations for Leads
// ============================================================================

export interface LeadFollowUpRecommendation {
  priority: "low" | "medium" | "high";
  dueAt: string; // ISO timestamp
  message: string;
  reasoning: string;
  objective: string;
}

export interface LeadFollowUpContext {
  businessName: string;
  leadTitle: string;
  leadDescription?: string | null;
  leadStatus: string;
  leadValue?: number | null;
  leadProbability?: number | null;
  contactName: string;
  contactTags: string[];
  contactOptedOut: boolean;
  daysSinceLeadUpdated: number;
  daysSinceLastInteraction: number | null;
  recentMessages: Array<{
    direction: "INBOUND" | "OUTBOUND";
    content: string;
    createdAt: string;
  }>;
  goal?: string;
}

function fallbackFollowUpRecommendation(
  context: LeadFollowUpContext,
): LeadFollowUpRecommendation {
  const highIntentStatuses = new Set(["NEGOTIATION", "PROPOSAL_SENT"]);
  const isStale =
    context.daysSinceLeadUpdated >= 3 ||
    (context.daysSinceLastInteraction !== null &&
      context.daysSinceLastInteraction >= 3);
  const priority: LeadFollowUpRecommendation["priority"] =
    highIntentStatuses.has(context.leadStatus) || isStale
      ? "high"
      : context.leadStatus === "QUALIFIED"
        ? "medium"
        : "low";
  const delayHours = priority === "high" ? 4 : priority === "medium" ? 24 : 48;
  const dueAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
  const name =
    context.contactName && context.contactName !== "Unknown"
      ? context.contactName.split(" ")[0]
      : "there";
  const objective =
    context.goal ??
    (context.leadStatus === "PROPOSAL_SENT"
      ? "Ask whether they want help finalizing the proposal."
      : "Restart the conversation and move the lead to the next step.");
  const message =
    context.leadStatus === "PROPOSAL_SENT"
      ? `Hi ${name}, checking in on the proposal we shared. Would you like me to help you choose the best option or book the next step?`
      : `Hi ${name}, just checking in. Are you still interested in ${context.leadTitle}? I can help with the next step whenever you're ready.`;

  return {
    priority,
    dueAt,
    message,
    objective,
    reasoning:
      "Rule-based recommendation used because the AI provider is not configured. It prioritizes stale or high-intent leads and keeps the WhatsApp follow-up short.",
  };
}

function normalizeFollowUpRecommendation(
  parsed: Partial<LeadFollowUpRecommendation>,
  fallback: LeadFollowUpRecommendation,
): LeadFollowUpRecommendation {
  const priority: LeadFollowUpRecommendation["priority"] =
    parsed.priority === "high" || parsed.priority === "medium" || parsed.priority === "low"
      ? parsed.priority
      : fallback.priority;
  const due = parsed.dueAt ? new Date(parsed.dueAt) : new Date(fallback.dueAt);
  const dueAt = Number.isNaN(due.getTime()) ? fallback.dueAt : due.toISOString();
  const message = String(parsed.message ?? fallback.message).trim().slice(0, 1000);
  return {
    priority,
    dueAt,
    message: message || fallback.message,
    reasoning: String(parsed.reasoning ?? fallback.reasoning).trim(),
    objective: String(parsed.objective ?? fallback.objective).trim(),
  };
}

export async function recommendLeadFollowUp(
  tenantId: string,
  context: LeadFollowUpContext,
): Promise<LeadFollowUpRecommendation> {
  const fallback = fallbackFollowUpRecommendation(context);
  if (!hasConfiguredAiClient()) {
    return fallback;
  }

  const transcript =
    context.recentMessages.length > 0
      ? context.recentMessages
          .slice(-12)
          .map(
            (m) =>
              `${m.direction === "INBOUND" ? "CUSTOMER" : "BUSINESS"} (${m.createdAt}): ${m.content}`,
          )
          .join("\n")
      : "(no conversation history yet)";

  const prompt = [
    `Business: ${context.businessName}`,
    `Lead: ${context.leadTitle}`,
    context.leadDescription ? `Description: ${context.leadDescription}` : "",
    `Status: ${context.leadStatus}`,
    `Value: ${context.leadValue ?? "unknown"}`,
    `Probability: ${context.leadProbability ?? "unknown"}`,
    `Contact: ${context.contactName}`,
    `Tags: ${context.contactTags.join(", ") || "(none)"}`,
    `Contact opted out: ${context.contactOptedOut ? "yes" : "no"}`,
    `Days since lead updated: ${context.daysSinceLeadUpdated}`,
    `Days since last interaction: ${context.daysSinceLastInteraction ?? "unknown"}`,
    context.goal ? `Sales goal: ${context.goal}` : "",
    "",
    "Recent conversation:",
    transcript,
    "",
    "Recommend the next WhatsApp follow-up for this lead.",
    "Rules:",
    "- If the contact opted out, do not suggest a WhatsApp send; instead say the objective is to obtain explicit consent through another allowed channel.",
    "- Keep the message under 600 characters.",
    "- Do not invent prices, discounts, availability, or policies.",
    "- dueAt must be an ISO timestamp in the next 7 days.",
    "",
    'Return JSON: {"priority":"low|medium|high","dueAt":"ISO timestamp","objective":"...","message":"...","reasoning":"one short sentence"}',
  ].filter(Boolean).join("\n");

  const parsed = await callLlmJson<Partial<LeadFollowUpRecommendation>>({
    tenantId,
    feature: "lead_follow_up",
    system:
      "You are NexaFlow's AI sales follow-up assistant. You recommend compliant, concise WhatsApp follow-ups that move leads forward without overpromising. Output strict JSON.",
    prompt,
    maxTokens: 700,
    temperature: 0.4,
  });

  return normalizeFollowUpRecommendation(parsed, fallback);
}

// ============================================================================
// AI Flow Nodes (blueprint §6.4) — typed wrappers around callLlmJson that
// the flow-builder nodes call. Keep the prompt engineering here so the
// node handlers in services/flow/nodes.ts stay thin.
// ============================================================================

export interface ClassifyIntentInput {
  /** Text to classify (typically the latest inbound WhatsApp message). */
  text: string;
  /** Allowed labels. The classifier picks one. */
  intents: string[];
  /** Optional one-line context (e.g. "Salon booking flow"). */
  context?: string;
}

export interface ClassifyIntentResult {
  /** The matched label, or the literal string "unknown" when none fits. */
  intent: string;
  /** 0.0–1.0 confidence the model assigns to its choice. */
  confidence: number;
  /** One short sentence explaining the call. Useful for the flow trail. */
  reasoning: string;
}

/**
 * Pick one label from `intents` that best fits `text`. Returns "unknown"
 * when the model decides nothing fits — callers route those to a default
 * branch so flows don't dead-end on ambiguous messages.
 */
export async function classifyIntent(
  tenantId: string,
  payload: ClassifyIntentInput,
): Promise<ClassifyIntentResult> {
  if (!payload.text?.trim()) {
    return { intent: "unknown", confidence: 0, reasoning: "empty input" };
  }
  if (!payload.intents?.length) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "classifyIntent requires at least one intent label.",
    );
  }

  const labels = payload.intents
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 60)
    .slice(0, 24);

  const prompt = [
    "Classify the user message into exactly one of these intents.",
    `Allowed intents: ${labels.map((l) => JSON.stringify(l)).join(", ")}`,
    'If none of the labels fit, use the literal string "unknown".',
    payload.context ? `Context: ${payload.context}` : "",
    "",
    `User message: ${JSON.stringify(payload.text.slice(0, 2000))}`,
    "",
    'Return JSON: {"intent":"<one of the labels or unknown>","confidence":0.0,"reasoning":"one short sentence"}',
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await callLlmJson<Partial<ClassifyIntentResult>>({
    tenantId,
    feature: "flow_classify_intent",
    system:
      'You are a careful intent classifier. Pick exactly one intent from the allowed list, or the literal "unknown" if none fits. Output strict JSON.',
    prompt,
    maxTokens: 200,
    temperature: 0,
  });

  // Snap unknown labels back to "unknown" so downstream branches stay
  // deterministic — never trust the model to invent a new label.
  const intent =
    typeof parsed.intent === "string" && parsed.intent.trim()
      ? labels.includes(parsed.intent) || parsed.intent === "unknown"
        ? parsed.intent
        : "unknown"
      : "unknown";
  const confidence =
    typeof parsed.confidence === "number" &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
      ? parsed.confidence
      : 0;
  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 240) : "";

  return { intent, confidence, reasoning };
}

export interface SummarizeInput {
  messages: Array<{ direction: "INBOUND" | "OUTBOUND"; content: string }>;
  /** Optional steering: "executive summary", "next steps", "blockers"... */
  focus?: string;
}

export interface SummarizeResult {
  summary: string;
  /** 3-7 short bullets the agent can scan in five seconds. */
  bullets: string[];
}

export async function summarizeConversation(
  tenantId: string,
  payload: SummarizeInput,
): Promise<SummarizeResult> {
  if (!payload.messages?.length) {
    return { summary: "(no messages)", bullets: [] };
  }
  const transcript = payload.messages
    .slice(-40)
    .map(
      (m) =>
        `${m.direction === "INBOUND" ? "Customer" : "Agent"}: ${m.content.slice(0, 800)}`,
    )
    .join("\n");

  const prompt = [
    "Summarize this customer-support conversation for an agent who needs to take it over.",
    payload.focus ? `Focus: ${payload.focus}` : "",
    "Rules:",
    "- Summary: 2-4 sentences, neutral tone, no marketing language.",
    "- Bullets: 3-7 short items, each starts with a verb where it's an action.",
    '- Never invent facts. If something is unclear, say "unclear".',
    "",
    "Transcript:",
    transcript,
    "",
    'Return JSON: {"summary":"...","bullets":["...","..."]}',
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await callLlmJson<Partial<SummarizeResult>>({
    tenantId,
    feature: "flow_summarize",
    system:
      "You are a senior support engineer summarizing customer conversations. Be precise; never invent facts.",
    prompt,
    maxTokens: 500,
    temperature: 0.2,
  });

  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets
        .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        .slice(0, 7)
    : [];
  return { summary, bullets };
}

export interface ExtractDataInput {
  text: string;
  /** Field name → human description of what to extract. */
  fields: Record<string, string>;
}

export type ExtractDataResult = Record<string, string | number | boolean | null>;

/**
 * Pull a typed dictionary from a freeform message. Returned values are
 * coerced to string|number|boolean|null. Missing or ambiguous values are
 * null so downstream nodes can branch on the gap to ask a follow-up.
 */
export async function extractStructuredData(
  tenantId: string,
  payload: ExtractDataInput,
): Promise<ExtractDataResult> {
  const fieldNames = Object.keys(payload.fields).filter(
    (k) => k.length > 0 && k.length <= 64,
  );
  if (fieldNames.length === 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "extractStructuredData requires at least one field to extract.",
    );
  }
  if (!payload.text?.trim()) {
    return Object.fromEntries(fieldNames.map((k) => [k, null]));
  }

  const cappedNames = fieldNames.slice(0, 20);
  const fieldLines = cappedNames
    .map((name) => `- ${name}: ${payload.fields[name]}`)
    .join("\n");

  const prompt = [
    "Extract the listed fields from the customer message.",
    "Return null when a value is missing or ambiguous; do NOT guess.",
    "Use simple JSON values (string | number | boolean | null). No nested objects.",
    "",
    "Fields to extract:",
    fieldLines,
    "",
    `Customer message: ${JSON.stringify(payload.text.slice(0, 3000))}`,
    "",
    `Return JSON with keys: ${cappedNames.map((n) => JSON.stringify(n)).join(", ")}.`,
  ].join("\n");

  const parsed = await callLlmJson<Record<string, unknown>>({
    tenantId,
    feature: "flow_extract_data",
    system:
      "You are an accurate information extractor. Return null when a value is missing or ambiguous; never guess.",
    prompt,
    maxTokens: 400,
    temperature: 0,
  });

  const out: ExtractDataResult = {};
  for (const name of cappedNames) {
    const raw = parsed?.[name];
    if (raw === null || raw === undefined) {
      out[name] = null;
    } else if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      out[name] = raw;
    } else {
      try {
        out[name] = JSON.stringify(raw);
      } catch {
        out[name] = null;
      }
    }
  }
  return out;
}

// ============================================================================
// T-055: WhatsApp template AI helpers (generation + approval prediction)
//
// Meta's WABA template approval is the bottleneck for any marketing flow.
// Two helpers here:
//   - generateWhatsAppTemplate: produces 3 variants of a template
//     (header/body/footer) tailored to the tenant's industry + goal,
//     conforming to Meta's category rules so they actually pass review.
//   - predictTemplateApproval: scores 0..1 the likelihood a given
//     template gets approved, returning concrete reasons so an operator
//     can fix issues before submitting (Meta only tells you AFTER the
//     fact).
//
// Both are wallet-billed via the existing callLlmJson plumbing.
// ============================================================================

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface TemplateVariant {
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  rationale: string;
}

export interface GenerateTemplateInput {
  industry: string;
  goal: string;
  language?: string;
  category?: TemplateCategory;
  /** Tone hint — friendly, formal, urgent, etc. */
  tone?: string;
  /** Operator-provided examples of past wins, used as few-shot context. */
  samples?: string[];
  /** Variable placeholders the operator wants supported (e.g. "name", "orderId"). */
  placeholders?: string[];
}

// Meta's hard limits per spec — enforced here so the model can't return
// a body the operator can't actually submit. We don't bother enforcing
// in the prompt; we trim post-hoc.
const META_HEADER_MAX = 60;
const META_BODY_MAX = 1024;
const META_FOOTER_MAX = 60;

function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

/**
 * Generate 3 Meta-compliant WhatsApp template variants for a goal.
 *
 * Returns an array of {headerText, bodyText, footerText, rationale}.
 * bodyText is required; header/footer are optional (null when absent).
 * The rationale explains why this variant fits — used in the UI so
 * operators understand the trade-offs without re-reading Meta's docs.
 */
export async function generateWhatsAppTemplate(
  tenantId: string,
  input: GenerateTemplateInput,
): Promise<TemplateVariant[]> {
  const language = (input.language ?? "en").trim() || "en";
  const category: TemplateCategory = input.category ?? "MARKETING";
  const tone = (input.tone ?? "friendly, concise").trim();
  const samples = (input.samples ?? [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 1024)
    .slice(0, 5);
  const placeholders = (input.placeholders ?? [])
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z][A-Za-z0-9_]*$/.test(p))
    .slice(0, 10);

  const placeholderLine =
    placeholders.length > 0
      ? `Supported placeholders (use as {{1}}, {{2}}, ... and explain mapping in rationale): ${placeholders.join(", ")}.`
      : "Do NOT use any {{N}} placeholders unless the goal explicitly needs personalization.";

  const samplesBlock =
    samples.length > 0
      ? `\nOperator-provided past examples (match this voice):\n${samples
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n")}\n`
      : "";

  const prompt = `Generate exactly 3 distinct WhatsApp Business message template variants for category ${category} in language ${language}.

Industry: ${input.industry || "general business"}
Goal:     ${input.goal || "drive engagement"}
Tone:     ${tone}
${placeholderLine}${samplesBlock}

Meta's hard limits:
- header: at most 60 chars, plain text only, no emoji at the start
- body: at most 1024 chars, must NOT contain promotional emoji walls, link-shortened URLs, or all-caps shouting
- footer: at most 60 chars, optional, no URLs

Return JSON with shape:
{
  "variants": [
    {
      "headerText": "..." | null,
      "bodyText": "...",
      "footerText": "..." | null,
      "rationale": "<one sentence explaining why this variant fits>"
    },
    ... 2 more ...
  ]
}

Each variant must be MEANINGFULLY DIFFERENT (different angle / hook / CTA), not three rewordings.`;

  const parsed = await callLlmJson<{ variants: unknown }>({
    tenantId,
    feature: "template_ai_generate",
    system:
      "You are a senior WhatsApp Business marketing strategist. You know Meta's WABA template policy by heart and craft copy that passes review on the first try.",
    prompt,
    maxTokens: 1_400,
    temperature: 0.7,
  });

  if (!Array.isArray(parsed?.variants)) return [];

  const variants: TemplateVariant[] = [];
  for (const raw of parsed.variants) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const bodyText = clampString(r.bodyText, META_BODY_MAX);
    if (!bodyText) continue; // body is the only required field
    variants.push({
      headerText: clampString(r.headerText, META_HEADER_MAX),
      bodyText,
      footerText: clampString(r.footerText, META_FOOTER_MAX),
      rationale:
        clampString(r.rationale, 200) ??
        "Generated variant — operator should review before submitting.",
    });
    if (variants.length >= 3) break;
  }
  return variants;
}

export interface PredictApprovalInput {
  category: TemplateCategory;
  language?: string;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
}

export interface PredictApprovalResult {
  score: number; // 0..1
  verdict: "likely_approve" | "uncertain" | "likely_reject";
  reasons: string[];
}

/**
 * Score how likely Meta is to approve this template, with concrete
 * reasons. Operator runs this BEFORE submitting so they can fix
 * issues (Meta only tells you reasons after rejection).
 *
 * The score is bucketed into three verdicts so the UI can render a
 * traffic-light badge without operators having to interpret raw numbers.
 */
export async function predictTemplateApproval(
  tenantId: string,
  input: PredictApprovalInput,
): Promise<PredictApprovalResult> {
  const body = (input.bodyText ?? "").trim();
  if (!body) {
    return {
      score: 0,
      verdict: "likely_reject",
      reasons: ["bodyText is empty"],
    };
  }
  if (body.length > META_BODY_MAX) {
    return {
      score: 0,
      verdict: "likely_reject",
      reasons: [`bodyText exceeds ${META_BODY_MAX} chars (got ${body.length})`],
    };
  }

  const prompt = `Score this WhatsApp Business template's likelihood of passing Meta's review.

Category:    ${input.category}
Language:    ${input.language ?? "en"}
Header:      ${input.headerText?.trim() || "(none)"}
Body:        ${body}
Footer:      ${input.footerText?.trim() || "(none)"}

Common rejection reasons:
- promotional content classified as UTILITY (or vice versa)
- aggressive CTAs ("click NOW", "limited time")
- shortened URLs (bit.ly, t.co, tinyurl)
- excessive emoji or all-caps shouting
- placeholder count doesn't match category (UTILITY typically 1-3, MARKETING 0-2)
- mentions of competitor brand names
- claims of guaranteed results, financial promises, or medical advice

Return JSON:
{
  "score": <0..1 float — probability Meta approves on first submit>,
  "verdict": "likely_approve" | "uncertain" | "likely_reject",
  "reasons": ["specific reason 1", "specific reason 2", ...]
}

Be concrete. "Wording is fine" is not a reason — name the policy each item touches.`;

  const parsed = await callLlmJson<{
    score: unknown;
    verdict: unknown;
    reasons: unknown;
  }>({
    tenantId,
    feature: "template_ai_predict_approval",
    system:
      "You are a WhatsApp Business template reviewer with deep knowledge of Meta's WABA policy. You score templates the way an actual Meta reviewer would, citing specific policy rules.",
    prompt,
    maxTokens: 600,
    temperature: 0,
  });

  const score =
    typeof parsed?.score === "number" && Number.isFinite(parsed.score)
      ? Math.min(1, Math.max(0, parsed.score))
      : 0.5;
  const reasons = Array.isArray(parsed?.reasons)
    ? parsed.reasons
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .slice(0, 8)
    : [];

  // Snap verdict to the score even if the model returned an inconsistent one
  // — the score is the source of truth, verdict is for display.
  let verdict: PredictApprovalResult["verdict"];
  if (score >= 0.75) verdict = "likely_approve";
  else if (score >= 0.4) verdict = "uncertain";
  else verdict = "likely_reject";

  // Hard-fail when reasons are empty for non-approve verdicts — the
  // operator needs SOMETHING to act on. Synthesize a generic reason
  // rather than silently passing through.
  if (verdict !== "likely_approve" && reasons.length === 0) {
    reasons.push(
      "Model couldn't articulate a specific concern — review category fit and CTA strength manually before submitting.",
    );
  }

  return { score: Number(score.toFixed(3)), verdict, reasons };
}

// ============================================================================
// T-053: SuperAdmin AI suite — four assistants that analyze
// platform-level data (across tenants) and surface what a human
// operator might miss while scanning dashboards.
//
// All four take a "context snapshot" the caller assembled from existing
// services (analytics totals, audit log slices, support ticket text,
// MRR/churn numbers) and return a structured analysis the SuperAdmin UI
// renders. None of them touch tenant-scoped data without explicit
// permission gating at the route layer.
//
// All four call callLlmJson → wallet-billed (under the platform tenant
// for SUPER_ADMIN runs, not the customer tenant). Feature keys are
// distinct per assistant so per-feature pricing can override.
// ============================================================================

// --- Platform Monitor --------------------------------------------------------

export interface PlatformMonitorInput {
  /** Snapshot of platform totals over a recent window. */
  totals: {
    tenants: number;
    activeTenants: number;
    messagesPerHour: number;
    failedSendsPerHour: number;
    p95LatencyMs: number;
    redisQueueDepth: number;
    p95DbLatencyMs?: number;
    errorRatePct?: number;
  };
  /** Anomalies the caller already detected (e.g. tenant_X sending 100x normal). */
  anomalies?: Array<{ kind: string; detail: string }>;
}

export interface PlatformMonitorResult {
  severity: "ok" | "watch" | "intervene";
  headline: string;
  observations: string[];
  recommendations: string[];
}

export async function runPlatformMonitor(
  platformTenantId: string,
  input: PlatformMonitorInput,
): Promise<PlatformMonitorResult> {
  const anomaliesBlock =
    input.anomalies && input.anomalies.length > 0
      ? `\n\nDetected anomalies:\n${input.anomalies.map((a) => `- [${a.kind}] ${a.detail}`).join("\n")}`
      : "\n\nNo specific anomalies detected by the rule layer.";

  const prompt = `You are reviewing platform health for a WhatsApp Business Automation SaaS.

Snapshot:
- Tenants: ${input.totals.tenants} total, ${input.totals.activeTenants} active
- Throughput: ${input.totals.messagesPerHour}/hr messages, ${input.totals.failedSendsPerHour}/hr failed sends
- Latency: p95 API ${input.totals.p95LatencyMs}ms${input.totals.p95DbLatencyMs ? `, p95 DB ${input.totals.p95DbLatencyMs}ms` : ""}
- Redis queue depth: ${input.totals.redisQueueDepth}
- Error rate: ${input.totals.errorRatePct ?? "?"}%${anomaliesBlock}

Triage this. Return JSON:
{
  "severity": "ok" | "watch" | "intervene",
  "headline": "<one-sentence verdict>",
  "observations": ["<concrete data point + interpretation>", ...max 5],
  "recommendations": ["<specific operator action>", ...max 5]
}

"intervene" = pages someone now. "watch" = monitor for the next hour. "ok" = no action.`;

  const parsed = await callLlmJson<{
    severity: unknown;
    headline: unknown;
    observations: unknown;
    recommendations: unknown;
  }>({
    tenantId: platformTenantId,
    feature: "superadmin_platform_monitor",
    system:
      "You are a senior site reliability engineer for a multi-tenant SaaS. You triage telemetry with cold judgment — no panic, no false positives, no hedging.",
    prompt,
    maxTokens: 600,
    temperature: 0.2,
  });

  const severity =
    parsed.severity === "ok" || parsed.severity === "watch" || parsed.severity === "intervene"
      ? parsed.severity
      : "watch";
  return {
    severity,
    headline:
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? parsed.headline.trim()
        : "Platform health snapshot",
    observations: toStringArray(parsed.observations, 5),
    recommendations: toStringArray(parsed.recommendations, 5),
  };
}

// --- Compliance Auditor ------------------------------------------------------

export interface ComplianceAuditInput {
  /** Sample of outbound messages from across tenants (anonymized, capped). */
  samples: Array<{
    tenantId: string;
    text: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION" | "REPLY";
  }>;
}

export interface ComplianceFinding {
  tenantId: string;
  text: string;
  category: string;
  severity: "info" | "warn" | "violation";
  issue: string;
  policy: string;
}

export interface ComplianceAuditResult {
  scanned: number;
  flagged: number;
  findings: ComplianceFinding[];
}

export async function runComplianceAuditor(
  platformTenantId: string,
  input: ComplianceAuditInput,
): Promise<ComplianceAuditResult> {
  const samples = input.samples.slice(0, 25); // cap to keep prompt bounded
  if (samples.length === 0) {
    return { scanned: 0, flagged: 0, findings: [] };
  }

  const block = samples
    .map(
      (s, i) =>
        `[${i + 1}] tenant=${s.tenantId} category=${s.category} text=${JSON.stringify(s.text.slice(0, 280))}`,
    )
    .join("\n");

  const prompt = `Audit these outbound WhatsApp messages for Meta policy violations.

Common violations:
- Marketing content sent as UTILITY (or vice versa)
- Unsolicited promotions to users who didn't opt in
- Link shorteners (bit.ly, t.co, tinyurl)
- Aggressive CTAs ("CLICK NOW", "LIMITED TIME", all-caps shouting)
- Financial guarantees, medical claims, or restricted-industry pitches
- PII leakage (raw credit card numbers, government IDs)

Messages:
${block}

Return JSON:
{
  "findings": [
    {
      "index": <1-based sample index>,
      "severity": "info" | "warn" | "violation",
      "issue": "<one sentence>",
      "policy": "<Meta WABA policy or regulation name>"
    }
  ]
}

Only flag actual problems. An empty findings array is the right answer when the samples are clean.`;

  const parsed = await callLlmJson<{ findings: unknown }>({
    tenantId: platformTenantId,
    feature: "superadmin_compliance_auditor",
    system:
      "You are a compliance reviewer for a WhatsApp Business platform. You cite specific Meta WABA policy rules and ignore the temptation to flag harmless copy.",
    prompt,
    maxTokens: 1200,
    temperature: 0,
  });

  const findings: ComplianceFinding[] = [];
  if (Array.isArray(parsed?.findings)) {
    for (const raw of parsed.findings) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const idx = typeof r.index === "number" ? r.index - 1 : -1;
      if (idx < 0 || idx >= samples.length) continue;
      const sample = samples[idx];
      const severity =
        r.severity === "info" || r.severity === "warn" || r.severity === "violation"
          ? r.severity
          : "warn";
      findings.push({
        tenantId: sample.tenantId,
        text: sample.text.length > 200 ? sample.text.slice(0, 197) + "..." : sample.text,
        category: sample.category,
        severity,
        issue:
          typeof r.issue === "string" && r.issue.trim()
            ? r.issue.trim()
            : "(unspecified)",
        policy:
          typeof r.policy === "string" && r.policy.trim()
            ? r.policy.trim()
            : "Meta WABA policy",
      });
    }
  }

  return {
    scanned: samples.length,
    flagged: findings.length,
    findings,
  };
}

// --- Support Copilot ---------------------------------------------------------

export interface SupportCopilotInput {
  /** The customer's question/complaint. */
  question: string;
  /** Free-form recent context the operator pasted (tickets, logs, etc.). */
  context?: string;
  /** Tenant id the question is about (for the operator's reference, not lookup). */
  tenantId?: string;
}

export interface SupportCopilotResult {
  reply: string;
  internalNotes: string[];
  suggestedActions: string[];
}

export async function runSupportCopilot(
  platformTenantId: string,
  input: SupportCopilotInput,
): Promise<SupportCopilotResult> {
  const ctx = (input.context ?? "").trim();
  const prompt = `A customer of our WhatsApp Business platform asked support a question. Draft a reply + internal notes.

Question:
${input.question.trim()}

${ctx ? `Operator context:\n${ctx}\n` : ""}
Return JSON:
{
  "reply": "<polite, accurate customer-facing reply — markdown OK>",
  "internalNotes": ["<note for the support agent's eyes only>", ...max 3],
  "suggestedActions": ["<specific platform action the agent should take>", ...max 3]
}

Guidelines:
- If the issue is a platform bug, say so honestly and propose a workaround.
- If it's user error, explain the fix without condescension.
- If you don't know, say "I need to check with the engineering team" rather than guessing.`;

  const parsed = await callLlmJson<{
    reply: unknown;
    internalNotes: unknown;
    suggestedActions: unknown;
  }>({
    tenantId: platformTenantId,
    feature: "superadmin_support_copilot",
    system:
      "You are a senior customer success engineer for a WhatsApp Business SaaS. You write replies that solve the customer's actual problem in as few words as possible.",
    prompt,
    maxTokens: 800,
    temperature: 0.3,
  });

  return {
    reply:
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : "I'll follow up shortly with a complete answer.",
    internalNotes: toStringArray(parsed.internalNotes, 3),
    suggestedActions: toStringArray(parsed.suggestedActions, 3),
  };
}

// --- Revenue Intelligence ----------------------------------------------------

export interface RevenueIntelligenceInput {
  mrrInPaisa: number;
  arpuInPaisa: number;
  newTenantsThisMonth: number;
  churnedTenantsThisMonth: number;
  expansionTenants: number; // upgraded plan
  contractionTenants: number; // downgraded
  topRevenueTenants?: Array<{ tenantId: string; monthlyPaisa: number }>;
  topAtRiskTenants?: Array<{ tenantId: string; reason: string }>;
}

export interface RevenueIntelligenceResult {
  headline: string;
  positives: string[];
  risks: string[];
  recommendations: string[];
}

export async function runRevenueIntelligence(
  platformTenantId: string,
  input: RevenueIntelligenceInput,
): Promise<RevenueIntelligenceResult> {
  const topRev = (input.topRevenueTenants ?? [])
    .slice(0, 5)
    .map((t) => `  - tenant ${t.tenantId}: ₹${(t.monthlyPaisa / 100).toFixed(0)}/mo`)
    .join("\n");
  const atRisk = (input.topAtRiskTenants ?? [])
    .slice(0, 5)
    .map((t) => `  - tenant ${t.tenantId}: ${t.reason}`)
    .join("\n");

  const prompt = `Analyze this SaaS revenue snapshot. Return JSON with strategic observations.

This month:
- MRR: ₹${(input.mrrInPaisa / 100).toFixed(0)}
- ARPU: ₹${(input.arpuInPaisa / 100).toFixed(0)}
- New tenants: ${input.newTenantsThisMonth}
- Churned: ${input.churnedTenantsThisMonth}
- Expansions (upgrades): ${input.expansionTenants}
- Contractions (downgrades): ${input.contractionTenants}

Top revenue tenants:
${topRev || "  (none provided)"}

At-risk tenants:
${atRisk || "  (none provided)"}

Net new MRR direction matters more than gross numbers.

Return JSON:
{
  "headline": "<one-sentence summary>",
  "positives": ["<momentum/wins to lean into>", ...max 4],
  "risks": ["<concrete risk + numbers>", ...max 4],
  "recommendations": ["<specific operator action, prioritized>", ...max 5]
}`;

  const parsed = await callLlmJson<{
    headline: unknown;
    positives: unknown;
    risks: unknown;
    recommendations: unknown;
  }>({
    tenantId: platformTenantId,
    feature: "superadmin_revenue_intelligence",
    system:
      "You are a SaaS growth analyst. You read MRR snapshots the way a CFO would — focused on net new MRR, retention, and expansion. You don't celebrate vanity metrics.",
    prompt,
    maxTokens: 700,
    temperature: 0.3,
  });

  return {
    headline:
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? parsed.headline.trim()
        : "Revenue snapshot",
    positives: toStringArray(parsed.positives, 4),
    risks: toStringArray(parsed.risks, 4),
    recommendations: toStringArray(parsed.recommendations, 5),
  };
}

function toStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}
