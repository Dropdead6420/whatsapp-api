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

  const prompt = [
    `Business: ${args.businessName}`,
    args.languageHint ? `Reply language: ${args.languageHint}` : "Reply language: match the customer's language",
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
      "You assist a human support agent. Match the customer's tone. Never hallucinate facts about the business. Output strict JSON.",
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
