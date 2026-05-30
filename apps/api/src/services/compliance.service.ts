import crypto from "node:crypto";
import {
  ComplianceMode,
  ComplianceScope,
  ComplianceVerdict,
  prisma,
  type ComplianceCheck,
  type Prisma,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { runTenantLlmJson } from "./ai.service";

type ViolationSeverity = "info" | "warn" | "violation";

export interface ComplianceViolation {
  code: string;
  severity: ViolationSeverity;
  detail: string;
}

export interface RunComplianceCheckInput {
  tenantId: string;
  scope: ComplianceScope;
  refId?: string | null;
  content: string;
  mode?: ComplianceMode;
  createdByUserId?: string | null;
  useAi?: boolean;
}

interface LegacyEnforceComplianceInput {
  tenantId: string;
  userId?: string | null;
  scope: ComplianceScope;
  refId?: string | null;
  content: string;
  heuristicsOnly?: boolean;
}

export interface ComplianceDecision {
  allowed: boolean;
  requiresOverride: boolean;
  blocked: boolean;
  reason: string | null;
}

export interface ComplianceCheckResult {
  check: ComplianceCheck;
  cached: boolean;
  decision: ComplianceDecision;
}

export type TenantComplianceModeConfig = {
  default: ComplianceMode;
  CAMPAIGN?: ComplianceMode;
  DRIP_STEP?: ComplianceMode;
  TEMPLATE?: ComplianceMode;
  REPLY?: ComplianceMode;
};

type TenantComplianceModeUpdates = {
  default?: ComplianceMode;
  CAMPAIGN?: ComplianceMode | null;
  DRIP_STEP?: ComplianceMode | null;
  TEMPLATE?: ComplianceMode | null;
  REPLY?: ComplianceMode | null;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MODE = ComplianceMode.ASSISTED;

const SHORT_LINK_RE = /\b(?:bit\.ly|t\.co|tinyurl\.com|cutt\.ly|rebrand\.ly|is\.gd|s\.id|rb\.gy)\b/i;

const REVIEW_PHRASES = [
  "click now",
  "act now",
  "limited time",
  "don't miss out",
  "free money",
  "risk free",
  "winner",
  "congratulations you have won",
  "lowest price guaranteed",
  "urgent offer",
];

const BLOCK_PHRASES = [
  "guaranteed profit",
  "100% guaranteed",
  "miracle cure",
  "cure diabetes",
  "cure cancer",
  "loan approved instantly",
  "no opt out",
  "cannot unsubscribe",
  "do not unsubscribe",
  "don't unsubscribe",
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function maxVerdict(a: ComplianceVerdict, b: ComplianceVerdict): ComplianceVerdict {
  const rank = {
    [ComplianceVerdict.PASS]: 0,
    [ComplianceVerdict.REVIEW]: 1,
    [ComplianceVerdict.BLOCK]: 2,
  };
  return rank[b] > rank[a] ? b : a;
}

function verdictFromScore(score: number): ComplianceVerdict {
  if (score >= 75) return ComplianceVerdict.BLOCK;
  if (score >= 40) return ComplianceVerdict.REVIEW;
  return ComplianceVerdict.PASS;
}

function verdictFromViolations(violations: ComplianceViolation[]): ComplianceVerdict {
  if (violations.some((v) => v.severity === "violation")) {
    return ComplianceVerdict.BLOCK;
  }
  if (violations.some((v) => v.severity === "warn")) {
    return ComplianceVerdict.REVIEW;
  }
  return ComplianceVerdict.PASS;
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function hashComplianceContent(
  scope: ComplianceScope,
  content: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${scope}\0${normalizeContent(content)}`)
    .digest("hex");
}

function parseModeValue(value: unknown): ComplianceMode | null {
  if (
    value === ComplianceMode.MANUAL ||
    value === ComplianceMode.ASSISTED ||
    value === ComplianceMode.AUTOPILOT
  ) {
    return value;
  }
  return null;
}

export function parseComplianceModeConfig(
  raw: unknown,
): TenantComplianceModeConfig {
  let source = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      source = JSON.parse(raw) as unknown;
    } catch {
      source = {};
    }
  }
  const obj =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  return {
    default: parseModeValue(obj.default) ?? DEFAULT_MODE,
    CAMPAIGN: parseModeValue(obj.CAMPAIGN) ?? undefined,
    DRIP_STEP: parseModeValue(obj.DRIP_STEP) ?? undefined,
    TEMPLATE: parseModeValue(obj.TEMPLATE) ?? undefined,
    REPLY: parseModeValue(obj.REPLY) ?? undefined,
  };
}

export async function getTenantComplianceModeConfig(
  tenantId: string,
): Promise<TenantComplianceModeConfig> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { complianceMode: true },
  });
  return parseComplianceModeConfig(tenant?.complianceMode ?? null);
}

export async function setTenantComplianceModeConfig(
  tenantId: string,
  updates: TenantComplianceModeUpdates,
): Promise<TenantComplianceModeConfig> {
  const current = await getTenantComplianceModeConfig(tenantId);
  const merged: TenantComplianceModeConfig = { ...current };
  if (updates.default !== undefined) merged.default = updates.default;
  for (const scope of [
    ComplianceScope.CAMPAIGN,
    ComplianceScope.DRIP_STEP,
    ComplianceScope.TEMPLATE,
    ComplianceScope.REPLY,
  ]) {
    if (!Object.prototype.hasOwnProperty.call(updates, scope)) continue;
    const value = updates[scope];
    if (value === null) delete merged[scope];
    else if (value !== undefined) merged[scope] = value;
  }
  // Build a plain Record first — Prisma's InputJsonObject type has a
  // readonly index signature, so we can't mutate it after construction.
  const stored: Record<string, ComplianceMode> = { default: merged.default };
  for (const scope of [
    ComplianceScope.CAMPAIGN,
    ComplianceScope.DRIP_STEP,
    ComplianceScope.TEMPLATE,
    ComplianceScope.REPLY,
  ]) {
    const mode = merged[scope];
    if (mode && mode !== merged.default) stored[scope] = mode;
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { complianceMode: stored as Prisma.InputJsonValue },
  });
  return merged;
}

export function modeForScope(
  config: TenantComplianceModeConfig,
  scope: ComplianceScope,
): ComplianceMode {
  return config[scope] ?? config.default ?? DEFAULT_MODE;
}

function heuristicReview(content: string): {
  score: number;
  violations: ComplianceViolation[];
  reasoning: string;
} {
  const normalized = normalizeContent(content);
  const lower = normalized.toLowerCase();
  const violations: ComplianceViolation[] = [];

  for (const phrase of BLOCK_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({
        code: "hard_policy_phrase",
        severity: "violation",
        detail: `Contains hard-risk phrase "${phrase}".`,
      });
    }
  }

  for (const phrase of REVIEW_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({
        code: "aggressive_marketing_phrase",
        severity: "warn",
        detail: `Contains aggressive marketing phrase "${phrase}".`,
      });
    }
  }

  if (SHORT_LINK_RE.test(normalized)) {
    violations.push({
      code: "short_link",
      severity: "warn",
      detail: "Contains a public URL shortener, which increases spam risk.",
    });
  }

  const letters = normalized.match(/[A-Za-z]/g)?.length ?? 0;
  const upperLetters = normalized.match(/[A-Z]/g)?.length ?? 0;
  if (letters >= 24 && upperLetters / letters > 0.65) {
    violations.push({
      code: "all_caps_density",
      severity: "warn",
      detail: "Message uses unusually high all-caps density.",
    });
  }

  const currencyHits = normalized.match(/[₹$€£]/g)?.length ?? 0;
  if (currencyHits >= 4) {
    violations.push({
      code: "currency_storm",
      severity: "warn",
      detail: "Message repeats currency symbols many times.",
    });
  }

  const exclamations = normalized.match(/!/g)?.length ?? 0;
  if (exclamations >= 5) {
    violations.push({
      code: "excessive_punctuation",
      severity: "warn",
      detail: "Message uses excessive exclamation marks.",
    });
  }

  const hasHard = violations.some((v) => v.severity === "violation");
  const warnCount = violations.filter((v) => v.severity === "warn").length;
  const score = clampScore((hasHard ? 85 : 10) + warnCount * 18);
  return {
    score,
    violations,
    reasoning:
      violations.length > 0
        ? `Heuristic review found ${violations.length} risk signal(s).`
        : "Heuristic review found no material risk signals.",
  };
}

async function runAiComplianceReview(args: {
  tenantId: string;
  scope: ComplianceScope;
  content: string;
}): Promise<{
  score: number;
  violations: ComplianceViolation[];
  rewrite?: string | null;
  reasoning: string;
}> {
  const parsed = await runTenantLlmJson<{
    spam_risk?: unknown;
    violations?: unknown;
    rewrite?: unknown;
    reasoning?: unknown;
  }>({
    tenantId: args.tenantId,
    feature: "compliance_firewall",
    system:
      "You are a WhatsApp Business compliance reviewer. Be practical: only flag real policy, spam, restricted-claim, or opt-out risks. Return strict JSON.",
    prompt: `Review this outbound WhatsApp content before it is sent.

Scope: ${args.scope}
Content: ${JSON.stringify(args.content.slice(0, 3000))}

Return JSON:
{
  "spam_risk": <0-100 integer>,
  "violations": [{"code":"...", "severity":"info"|"warn"|"violation", "detail":"..."}],
  "rewrite": "<safer rewrite or null>",
  "reasoning": "<one concise paragraph>"
}`,
    maxTokens: 900,
    temperature: 0,
  });

  const violations: ComplianceViolation[] = [];
  if (Array.isArray(parsed.violations)) {
    for (const raw of parsed.violations) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const severity =
        item.severity === "info" ||
        item.severity === "warn" ||
        item.severity === "violation"
          ? item.severity
          : "warn";
      const detail =
        typeof item.detail === "string" && item.detail.trim()
          ? item.detail.trim()
          : "AI reviewer flagged this content.";
      violations.push({
        code:
          typeof item.code === "string" && item.code.trim()
            ? item.code.trim().slice(0, 80)
            : "ai_policy_signal",
        severity,
        detail: detail.slice(0, 500),
      });
    }
  }

  return {
    score: clampScore(Number(parsed.spam_risk ?? 0)),
    violations,
    rewrite:
      typeof parsed.rewrite === "string" && parsed.rewrite.trim()
        ? parsed.rewrite.trim().slice(0, 2000)
        : null,
    reasoning:
      typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 1000)
        : "AI review completed.",
  };
}

function toJsonArray(violations: ComplianceViolation[]): Prisma.InputJsonArray {
  return violations.map((v) => ({
    code: v.code,
    severity: v.severity,
    detail: v.detail,
  }));
}

function computeDecision(
  verdict: ComplianceVerdict,
  mode: ComplianceMode,
  overridden: boolean,
): ComplianceDecision {
  if (mode === ComplianceMode.MANUAL) {
    return { allowed: true, requiresOverride: false, blocked: false, reason: null };
  }
  if (
    mode === ComplianceMode.ASSISTED &&
    verdict === ComplianceVerdict.REVIEW &&
    overridden
  ) {
    return { allowed: true, requiresOverride: false, blocked: false, reason: null };
  }
  if (verdict === ComplianceVerdict.PASS) {
    return { allowed: true, requiresOverride: false, blocked: false, reason: null };
  }
  if (mode === ComplianceMode.ASSISTED && verdict === ComplianceVerdict.REVIEW) {
    return {
      allowed: false,
      requiresOverride: true,
      blocked: false,
      reason: "Compliance review required before this content can be sent.",
    };
  }
  return {
    allowed: false,
    requiresOverride: false,
    blocked: true,
    reason:
      verdict === ComplianceVerdict.BLOCK
        ? "Compliance Firewall blocked this content."
        : "Compliance Firewall requires a passing verdict in Autopilot mode.",
  };
}

export function decisionForCheck(check: Pick<ComplianceCheck, "verdict" | "mode" | "overridden">): ComplianceDecision {
  return computeDecision(check.verdict, check.mode, check.overridden);
}

async function cloneFromCachedCheck(args: {
  cached: ComplianceCheck;
  tenantId: string;
  scope: ComplianceScope;
  refId?: string | null;
  content: string;
  contentHash: string;
  mode: ComplianceMode;
  createdByUserId?: string | null;
}): Promise<ComplianceCheck> {
  return prisma.complianceCheck.create({
    data: {
      tenantId: args.tenantId,
      scope: args.scope,
      refId: args.refId ?? null,
      content: args.content,
      contentHash: args.contentHash,
      verdict: args.cached.verdict,
      score: args.cached.score,
      violations: args.cached.violations as Prisma.InputJsonValue,
      rewrite: args.cached.rewrite,
      reasoning: `${args.cached.reasoning ?? "Cached compliance analysis."} Reused cached analysis from ${args.cached.id}.`,
      mode: args.mode,
      createdByUserId: args.createdByUserId ?? null,
    },
  });
}

export async function runComplianceCheck(
  input: RunComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  const content = normalizeContent(input.content);
  if (!content) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Content is required.");
  }

  const mode =
    input.mode ??
    modeForScope(await getTenantComplianceModeConfig(input.tenantId), input.scope);
  const contentHash = hashComplianceContent(input.scope, content);
  const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS);

  const cached = await prisma.complianceCheck.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: input.scope,
      contentHash,
      createdAt: { gte: cacheCutoff },
    },
    orderBy: { createdAt: "desc" },
  });

  if (cached) {
    const check =
      cached.refId === (input.refId ?? null) &&
      cached.mode === mode &&
      !cached.overridden
        ? cached
        : await cloneFromCachedCheck({
            cached,
            tenantId: input.tenantId,
            scope: input.scope,
            refId: input.refId,
            content,
            contentHash,
            mode,
            createdByUserId: input.createdByUserId,
          });
    return {
      check,
      cached: true,
      decision: decisionForCheck(check),
    };
  }

  const heuristic = heuristicReview(content);
  let score = heuristic.score;
  let verdict = maxVerdict(
    verdictFromScore(heuristic.score),
    verdictFromViolations(heuristic.violations),
  );
  let rewrite: string | null = null;
  const violations = [...heuristic.violations];
  const reasoning = [heuristic.reasoning];

  if (input.useAi !== false) {
    try {
      const ai = await runAiComplianceReview({
        tenantId: input.tenantId,
        scope: input.scope,
        content,
      });
      score = Math.max(score, ai.score);
      violations.push(...ai.violations);
      verdict = maxVerdict(
        verdict,
        maxVerdict(verdictFromScore(ai.score), verdictFromViolations(ai.violations)),
      );
      rewrite = ai.rewrite ?? null;
      reasoning.push(ai.reasoning);
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI review failed";
      reasoning.push(`AI review skipped or failed; heuristic verdict used. ${message}`);
    }
  } else {
    reasoning.push("AI review skipped for latency-sensitive send path.");
  }

  const check = await prisma.complianceCheck.create({
    data: {
      tenantId: input.tenantId,
      scope: input.scope,
      refId: input.refId ?? null,
      content,
      contentHash,
      verdict,
      score,
      violations: toJsonArray(violations),
      rewrite,
      reasoning: reasoning.join(" "),
      mode,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  return {
    check,
    cached: false,
    decision: decisionForCheck(check),
  };
}

export function complianceStopMessage(result: ComplianceCheckResult): string {
  const { check, decision } = result;
  if (decision.requiresOverride) {
    return `Compliance review required (${check.verdict}, score ${check.score}).`;
  }
  return `${decision.reason ?? "Compliance Firewall stopped this send"} (${check.verdict}, score ${check.score}).`;
}

export async function assertComplianceAllowed(
  input: RunComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  const result = await runComplianceCheck(input);
  if (!result.decision.allowed) {
    throw new ApiError(
      ErrorCodes.COMPLIANCE_BLOCKED,
      409,
      complianceStopMessage(result),
    );
  }
  return result;
}

export async function overrideComplianceCheck(args: {
  tenantId: string;
  checkId: string;
  userId: string;
  reason: string;
}): Promise<ComplianceCheck> {
  const check = await prisma.complianceCheck.findFirst({
    where: { id: args.checkId, tenantId: args.tenantId },
  });
  if (!check) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Compliance check not found.");
  }
  if (check.verdict !== ComplianceVerdict.REVIEW) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Only REVIEW verdicts can be overridden.",
    );
  }
  if (check.mode !== ComplianceMode.ASSISTED) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Only ASSISTED mode checks can be overridden.",
    );
  }
  return prisma.complianceCheck.update({
    where: { id: check.id },
    data: {
      overridden: true,
      overriddenReason: args.reason,
      overriddenByUserId: args.userId,
    },
  });
}

export async function enforceCompliance(
  input: LegacyEnforceComplianceInput,
): Promise<ComplianceCheck> {
  const result = await assertComplianceAllowed({
    tenantId: input.tenantId,
    scope: input.scope,
    refId: input.refId,
    content: input.content,
    createdByUserId: input.userId,
    useAi: !input.heuristicsOnly,
  });
  return result.check;
}

export async function listRecentChecks(
  tenantId: string,
  limit = 100,
): Promise<ComplianceCheck[]> {
  return prisma.complianceCheck.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 500)),
  });
}

export async function recordOverride(args: {
  tenantId: string;
  checkId: string;
  userId: string;
  reason: string;
}): Promise<ComplianceCheck> {
  return overrideComplianceCheck(args);
}

export { ComplianceMode, ComplianceScope, ComplianceVerdict };
