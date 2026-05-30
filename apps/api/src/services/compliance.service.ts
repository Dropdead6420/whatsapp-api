import { createHash } from "node:crypto";
import {
  prisma,
  ComplianceMode,
  ComplianceScope,
  ComplianceVerdict,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// ----------------------------------------------------------------------------
// AI Compliance Firewall (PRD-v2 §8, Sprint 2 slice 1).
//
// Pre-send safety check for outbound WhatsApp content. Two layers:
//
//   1. Heuristic checks (this file, synchronous, no LLM cost). Catches the
//      classes of problems that have clear deterministic rules:
//        - Forbidden-content keywords (gambling, adult, crypto-pump…)
//        - Opt-out keywords leaking into outbound copy
//        - ALL-CAPS density > 30%
//        - Currency-symbol storms (>5 in a single message)
//        - Excessive emoji bursts
//      Any heuristic violation is a hard BLOCK regardless of LLM verdict.
//
//   2. LLM review (lazy-imported runTenantLlmJson from ai.service). Returns
//      a 0-100 spam_risk score, a list of soft violations, an optional
//      rewrite, and one-line reasoning. Drives the REVIEW vs PASS tier.
//
// The verdict combiner is intentionally cautious — a single hard violation
// trumps any LLM PASS. We never auto-soften the LLM's BLOCK either.
// ----------------------------------------------------------------------------

export interface ComplianceViolation {
  code: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

export interface ComplianceCheckInput {
  tenantId: string;
  userId?: string;
  scope: ComplianceScope;
  refId?: string;
  content: string;
  /** Optional industry hint passed to the LLM. */
  industry?: string;
  /** Optional summary of who's being targeted. */
  audienceDescription?: string;
  /**
   * Skip the LLM call entirely. Used by hot paths (agent reply) where
   * the LLM round-trip is too expensive on every send.
   */
  heuristicsOnly?: boolean;
}

// ----------------------------------------------------------------------------
// Heuristics
// ----------------------------------------------------------------------------

// Curated, deliberately small. Tenant-specific lists can be layered on
// later via a TenantComplianceRule table; this is the slice-1 floor.
const HARD_BLOCK_KEYWORDS = [
  // Pump-and-dump
  "guaranteed returns",
  "double your money",
  "100x",
  "moonshot",
  // Adult / gambling
  "adult content",
  "xxx",
  "live cam",
  "casino bonus",
  "betting tips",
  // Phishing / impersonation
  "verify your account immediately",
  "click here to claim",
  "your account will be suspended",
  // Health quackery
  "miracle cure",
  "lose weight overnight",
  "cures cancer",
];

const SOFT_FLAG_KEYWORDS = [
  "free!",
  "act now",
  "limited time",
  "click below",
  "buy now",
  "urgent",
];

// Opt-out keywords reflected back to a customer are a quality-rating
// disaster — Meta interprets it as the BUSINESS asking to be opted out.
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "cancel"];

function hardBlockKeyword(content: string): string | null {
  const lower = content.toLowerCase();
  for (const kw of HARD_BLOCK_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function softFlagKeyword(content: string): string | null {
  const lower = content.toLowerCase();
  for (const kw of SOFT_FLAG_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function leaksOptOut(content: string): boolean {
  // Match the keyword as a standalone token — "STOP all spammers!" is fine,
  // a body that just says "Reply STOP to opt out" inside outbound copy is
  // suspicious because we'd be telling the customer to opt them out for us.
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const tokens = line.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (const kw of OPT_OUT_KEYWORDS) {
      if (tokens.includes(kw)) return true;
    }
  }
  return false;
}

function capsDensity(content: string): number {
  const letters = content.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

function currencyStorm(content: string): number {
  const matches = content.match(/[$₹€£¥]/g);
  return matches?.length ?? 0;
}

function emojiBurstCount(content: string): number {
  // Rough emoji approximation — covers most chat emoji ranges. Not perfect,
  // but a body with 10+ emoji is a soft flag regardless of the exact match.
  const matches = content.match(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
  );
  return matches?.length ?? 0;
}

interface HeuristicResult {
  violations: ComplianceViolation[];
  score: number; // 0-100
  hardBlock: boolean;
}

function runHeuristics(content: string, scope: ComplianceScope): HeuristicResult {
  const violations: ComplianceViolation[] = [];
  let score = 0;
  let hardBlock = false;

  const blockKw = hardBlockKeyword(content);
  if (blockKw) {
    violations.push({
      code: "BLOCKED_KEYWORD",
      severity: "high",
      detail: `Contains forbidden keyword: "${blockKw}". WhatsApp + Meta policy will reject this.`,
    });
    hardBlock = true;
    score = 100;
  }

  // Opt-out leak in CAMPAIGN / DRIP_STEP / TEMPLATE is hard block (we'd be
  // telling Meta to opt the customer out for us). In REPLY it's allowed —
  // an agent legitimately telling a customer how to opt out is fine.
  if (
    scope !== ComplianceScope.REPLY &&
    leaksOptOut(content)
  ) {
    violations.push({
      code: "OPT_OUT_LEAK",
      severity: "high",
      detail:
        "Outbound copy contains an opt-out keyword (STOP/UNSUBSCRIBE/CANCEL). " +
        "Meta will treat this as the business asking to opt the customer out.",
    });
    hardBlock = true;
    score = Math.max(score, 100);
  }

  const soft = softFlagKeyword(content);
  if (soft) {
    violations.push({
      code: "SPAMMY_PHRASE",
      severity: "medium",
      detail: `Contains spam-flag phrase: "${soft}".`,
    });
    score = Math.max(score, 55);
  }

  const caps = capsDensity(content);
  if (caps > 0.5) {
    violations.push({
      code: "ALL_CAPS",
      severity: "high",
      detail: `Body is ${Math.round(caps * 100)}% uppercase — Meta flags this as shouty/spam.`,
    });
    hardBlock = true;
    score = Math.max(score, 95);
  } else if (caps > 0.3) {
    violations.push({
      code: "MOSTLY_CAPS",
      severity: "medium",
      detail: `Body is ${Math.round(caps * 100)}% uppercase — consider sentence case.`,
    });
    score = Math.max(score, 60);
  }

  const cs = currencyStorm(content);
  if (cs >= 8) {
    violations.push({
      code: "CURRENCY_STORM",
      severity: "high",
      detail: `${cs} currency symbols in one message — spam classifiers flag this.`,
    });
    hardBlock = true;
    score = Math.max(score, 95);
  } else if (cs >= 5) {
    violations.push({
      code: "CURRENCY_HEAVY",
      severity: "medium",
      detail: `${cs} currency symbols — consider trimming.`,
    });
    score = Math.max(score, 60);
  }

  const emojis = emojiBurstCount(content);
  if (emojis >= 10) {
    violations.push({
      code: "EMOJI_BURST",
      severity: "medium",
      detail: `${emojis} emojis in one message — trim to <5 for higher delivery.`,
    });
    score = Math.max(score, 55);
  }

  return { violations, score, hardBlock };
}

// ----------------------------------------------------------------------------
// LLM review
// ----------------------------------------------------------------------------

interface LlmOutput {
  spam_risk: number;
  violations: Array<{ code?: string; severity?: string; detail: string }>;
  rewrite?: string;
  reasoning?: string;
}

async function runLlmReview(args: {
  tenantId: string;
  content: string;
  scope: ComplianceScope;
  industry?: string;
  audienceDescription?: string;
}): Promise<LlmOutput | null> {
  // Lazy import to avoid the circular service edge with ai.service.
  let runTenantLlmJson: (typeof import("./ai.service"))["runTenantLlmJson"];
  try {
    ({ runTenantLlmJson } = await import("./ai.service"));
  } catch {
    return null;
  }

  const prompt = [
    "You are a WhatsApp Business Policy compliance reviewer.",
    `Scope: ${args.scope}`,
    args.industry ? `Tenant industry: ${args.industry}` : "",
    args.audienceDescription
      ? `Audience: ${args.audienceDescription}`
      : "Audience: (unspecified)",
    "",
    "Outbound message:",
    "```",
    args.content,
    "```",
    "",
    "Score this message for spam / policy risk on a 0-100 scale where",
    "0 = perfectly fine and 100 = a serious WhatsApp Business Policy violation",
    "that would suspend the WABA.",
    "",
    "Identify each soft violation (max 5). Do not invent violations the",
    "message doesn't have. Suggest a rewrite that fixes the issues while",
    "keeping the operator's intent.",
    "",
    "Return strict JSON:",
    "{",
    '  "spam_risk": 0-100,',
    '  "violations": [{"code": "SHORT_TOKEN", "severity": "low|medium|high", "detail": "one-line explanation"}],',
    '  "rewrite": "fixed version",',
    '  "reasoning": "one short sentence"',
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    return await runTenantLlmJson<LlmOutput>({
      tenantId: args.tenantId,
      feature: "compliance_check",
      system:
        "You are NexaFlow's compliance firewall. You output strict JSON, never invent violations not present in the message, and lean conservative (a borderline case is REVIEW, not PASS).",
      prompt,
      maxTokens: 700,
      temperature: 0.2,
    });
  } catch (err) {
    // LLM failure is non-fatal — the heuristic layer always runs and the
    // operator still gets a verdict. We just don't get the rewrite/reasoning.
    console.warn(
      `[compliance] LLM review failed (tenant=${args.tenantId}):`,
      (err as Error).message,
    );
    return null;
  }
}

// ----------------------------------------------------------------------------
// Verdict combiner + main entry
// ----------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function resolveMode(args: {
  tenant: { complianceMode: unknown };
  scope: ComplianceScope;
}): ComplianceMode {
  const raw = args.tenant.complianceMode as
    | { default?: string; [key: string]: string | undefined }
    | null;
  const candidates = [raw?.[args.scope], raw?.default];
  for (const c of candidates) {
    if (c === "MANUAL" || c === "ASSISTED" || c === "AUTOPILOT") {
      return c as ComplianceMode;
    }
  }
  return ComplianceMode.ASSISTED;
}

function combineVerdict(heuristic: HeuristicResult, llm: LlmOutput | null): {
  verdict: ComplianceVerdict;
  score: number;
  violations: ComplianceViolation[];
  rewrite: string | null;
  reasoning: string | null;
} {
  // Hard heuristic violation always wins.
  if (heuristic.hardBlock) {
    return {
      verdict: ComplianceVerdict.BLOCK,
      score: 100,
      violations: heuristic.violations,
      rewrite: llm?.rewrite ?? null,
      reasoning:
        llm?.reasoning ??
        "Heuristic check blocked this message before LLM review.",
    };
  }

  const llmScore = llm ? Math.max(0, Math.min(100, Math.round(llm.spam_risk))) : 0;
  const llmViolations: ComplianceViolation[] =
    (llm?.violations ?? []).slice(0, 5).map((v, idx) => ({
      code: v.code ?? `LLM_${idx}`,
      severity:
        v.severity === "low" || v.severity === "medium" || v.severity === "high"
          ? v.severity
          : "medium",
      detail: v.detail,
    }));
  const combinedScore = Math.max(heuristic.score, llmScore);
  const combinedViolations = [...heuristic.violations, ...llmViolations];

  let verdict: ComplianceVerdict;
  if (combinedScore >= 90) verdict = ComplianceVerdict.BLOCK;
  else if (combinedScore >= 50) verdict = ComplianceVerdict.REVIEW;
  else verdict = ComplianceVerdict.PASS;

  return {
    verdict,
    score: combinedScore,
    violations: combinedViolations,
    rewrite: llm?.rewrite ?? null,
    reasoning: llm?.reasoning ?? null,
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 min

export interface RunComplianceCheckResult {
  id: string;
  verdict: ComplianceVerdict;
  score: number;
  violations: ComplianceViolation[];
  rewrite: string | null;
  reasoning: string | null;
  mode: ComplianceMode;
  // Convenience: true when verdict + mode combination requires the send to
  // be blocked rather than just surfaced for review.
  enforced: boolean;
}

/**
 * Run the firewall against one piece of content. Idempotent within a 5min
 * window on (tenantId, scope, content-hash) — running the same preview
 * twice doesn't re-bill the LLM.
 */
export async function runComplianceCheck(
  input: ComplianceCheckInput,
): Promise<RunComplianceCheckResult> {
  const content = input.content?.trim();
  if (!content) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "content is required for a compliance check.",
    );
  }
  const contentHash = sha256(`${input.scope}:${content}`);

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { complianceMode: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }
  const mode = resolveMode({ tenant, scope: input.scope });

  // Idempotency probe.
  const recent = await prisma.complianceCheck.findFirst({
    where: {
      tenantId: input.tenantId,
      contentHash,
      createdAt: { gt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return {
      id: recent.id,
      verdict: recent.verdict,
      score: recent.score,
      violations: (recent.violations as unknown as ComplianceViolation[]) ?? [],
      rewrite: recent.rewrite,
      reasoning: recent.reasoning,
      mode: recent.mode,
      enforced: enforcedFor(recent.verdict, recent.mode),
    };
  }

  const heuristic = runHeuristics(content, input.scope);

  // Skip the LLM call entirely when:
  //  - heuristics already returned a hard block (paying Anthropic to tell
  //    us what we already know is wasteful), OR
  //  - the caller asked for heuristics-only (hot path; agent reply on
  //    every send is too expensive at LLM rates).
  const llm =
    heuristic.hardBlock || input.heuristicsOnly
      ? null
      : await runLlmReview({
          tenantId: input.tenantId,
          content,
          scope: input.scope,
          industry: input.industry,
          audienceDescription: input.audienceDescription,
        });

  const combined = combineVerdict(heuristic, llm);

  const row = await prisma.complianceCheck.create({
    data: {
      tenantId: input.tenantId,
      scope: input.scope,
      refId: input.refId ?? null,
      content,
      contentHash,
      verdict: combined.verdict,
      score: combined.score,
      violations: combined.violations as unknown as object,
      rewrite: combined.rewrite,
      reasoning: combined.reasoning,
      mode,
      createdByUserId: input.userId ?? null,
    },
  });

  return {
    id: row.id,
    verdict: combined.verdict,
    score: combined.score,
    violations: combined.violations,
    rewrite: combined.rewrite,
    reasoning: combined.reasoning,
    mode,
    enforced: enforcedFor(combined.verdict, mode),
  };
}

/**
 * Whether a verdict should block the send for the given mode.
 *   - PASS   → never enforced
 *   - REVIEW → enforced in AUTOPILOT only
 *   - BLOCK  → enforced in AUTOPILOT + ASSISTED (MANUAL allows override)
 */
function enforcedFor(verdict: ComplianceVerdict, mode: ComplianceMode): boolean {
  if (verdict === ComplianceVerdict.PASS) return false;
  if (mode === ComplianceMode.AUTOPILOT) return true;
  if (mode === ComplianceMode.ASSISTED) {
    return verdict === ComplianceVerdict.BLOCK;
  }
  // MANUAL: nothing is enforced; operator must approve in-app.
  return false;
}

export async function listRecentChecks(
  tenantId: string,
  limit = 100,
): Promise<
  Array<{
    id: string;
    scope: ComplianceScope;
    refId: string | null;
    content: string;
    verdict: ComplianceVerdict;
    score: number;
    mode: ComplianceMode;
    overridden: boolean;
    createdAt: Date;
  }>
> {
  const rows = await prisma.complianceCheck.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
    select: {
      id: true,
      scope: true,
      refId: true,
      content: true,
      verdict: true,
      score: true,
      mode: true,
      overridden: true,
      createdAt: true,
    },
  });
  return rows;
}

/**
 * Record an override (operator decided to send despite a non-PASS verdict).
 * Returns the updated row so the caller can audit-log the action.
 */
export async function recordOverride(args: {
  tenantId: string;
  checkId: string;
  userId: string;
  reason: string;
}) {
  const existing = await prisma.complianceCheck.findFirst({
    where: { id: args.checkId, tenantId: args.tenantId },
  });
  if (!existing) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Compliance check not found.",
    );
  }
  if (existing.verdict === ComplianceVerdict.PASS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Check passed — no override needed.",
    );
  }
  if (existing.mode === ComplianceMode.AUTOPILOT) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "AUTOPILOT mode does not allow operator override.",
    );
  }
  return prisma.complianceCheck.update({
    where: { id: existing.id },
    data: {
      overridden: true,
      overriddenReason: args.reason.trim() || null,
      overriddenByUserId: args.userId,
    },
  });
}

// ----------------------------------------------------------------------------
// Enforcement wrapper — call this from send paths instead of runComplianceCheck
// when you want a hard stop on enforced verdicts.
// ----------------------------------------------------------------------------

export class ComplianceBlockedError extends ApiError {
  /**
   * The persisted ComplianceCheck row, so callers (or route error handlers)
   * can surface violation + rewrite info to the client.
   */
  readonly check: RunComplianceCheckResult;

  constructor(check: RunComplianceCheckResult) {
    const detail =
      check.violations.length > 0
        ? check.violations.map((v) => `${v.code}: ${v.detail}`).join("; ")
        : "Compliance Firewall blocked this send.";
    super(
      ErrorCodes.FORBIDDEN,
      403,
      `Compliance Firewall (${check.verdict}, score ${check.score}): ${detail}`,
    );
    this.name = "ComplianceBlockedError";
    this.check = check;
  }
}

/**
 * Run the firewall and throw ComplianceBlockedError if the verdict is
 * enforced under the tenant's current mode. Use this in send paths; use
 * runComplianceCheck directly for previews / dashboards.
 */
export async function enforceCompliance(
  input: ComplianceCheckInput,
): Promise<RunComplianceCheckResult> {
  const result = await runComplianceCheck(input);
  if (result.enforced) {
    throw new ComplianceBlockedError(result);
  }
  return result;
}
