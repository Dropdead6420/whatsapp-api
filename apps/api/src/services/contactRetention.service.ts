// ============================================================================
// AI Retention Engine (PRD-v2 §7, Sprint 4 slice 1)
//
// Customer-facing contact retention scoring. The scan rates each contact's
// engagement decay from cheap Contact-row signals — last-interaction
// recency, opt-out, lifecycle stage, and AI lead score — with NO per-contact
// message fan-out, so it scales to large contact books with one findMany.
//
// Tier is derived deterministically from recency + opt-out. The score is a
// 0-100 composite (higher = healthier retention). Each daily row carries a
// per-signal `factors` breakdown plus a deterministic recommendation; slice 2
// layers LLM win-back copy and auto-enroll-into-drip on top.
// ============================================================================

import {
  prisma,
  Prisma,
  RetentionTier,
  RetentionMode,
  DripSequenceStatus,
  LifecycleStage,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

type FactorKey = "recency" | "lifecycle" | "intent";

interface RetentionFactor {
  score: number; // 0-1
  weight: number; // 0-1
  contribution: number; // 0-100
  detail: string;
}

export interface ContactRetentionRow {
  contactId: string;
  name: string;
  phoneNumber: string;
  tier: RetentionTier;
  score: number;
  daysSinceInteraction: number;
  optedOut: boolean;
  lifecycleStage: LifecycleStage;
  recommendation: string;
  assessedAt: Date;
  factors: Record<FactorKey, RetentionFactor>;
}

export interface RetentionSummary {
  tenantId: string;
  generatedAt: Date;
  totals: Record<RetentionTier, number>;
  totalScored: number;
  rows: ContactRetentionRow[];
}

const WEIGHTS: Record<FactorKey, number> = {
  recency: 0.6,
  lifecycle: 0.25,
  intent: 0.15,
};

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TENANTS_PER_SCAN = 25;
const CONTACTS_PER_TENANT = 2000;
const DAY_MS = 86_400_000;

let timer: ReturnType<typeof setInterval> | null = null;

function dayKeyUtc(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Recency → 0-1 health. Step decay so the curve is explainable to users. */
function recencyScore(days: number): number {
  if (days <= 7) return 1;
  if (days <= 14) return 0.85;
  if (days <= 30) return 0.6;
  if (days <= 60) return 0.35;
  if (days <= 90) return 0.18;
  return 0.05;
}

function lifecycleScore(stage: LifecycleStage): number {
  switch (stage) {
    case LifecycleStage.VIP:
      return 1;
    case LifecycleStage.REPEAT_CUSTOMER:
      return 0.9;
    case LifecycleStage.CUSTOMER:
      return 0.75;
    case LifecycleStage.PROSPECT:
      return 0.55;
    case LifecycleStage.LEAD:
      return 0.4;
    case LifecycleStage.CHURNED:
      return 0.1;
    default:
      return 0.4;
  }
}

/**
 * Deterministic tier. Opt-out is terminal (LOST) regardless of recency;
 * otherwise recency windows drive the tier so it stays explainable.
 */
function tierFor(args: { optedOut: boolean; days: number }): RetentionTier {
  if (args.optedOut) return RetentionTier.LOST;
  if (args.days <= 14) return RetentionTier.ACTIVE;
  if (args.days <= 30) return RetentionTier.COOLING;
  if (args.days <= 90) return RetentionTier.DORMANT;
  return RetentionTier.LOST;
}

function recommendationFor(args: {
  tier: RetentionTier;
  days: number;
  name: string;
  lifecycleStage: LifecycleStage;
}): string {
  switch (args.tier) {
    case RetentionTier.ACTIVE:
      return "Engaged recently — no action needed. Keep nurturing.";
    case RetentionTier.COOLING:
      return `Slipping (${args.days}d quiet). Send a light check-in or value tip before they cool further.`;
    case RetentionTier.DORMANT:
      return `Dormant (${args.days}d quiet). Launch a win-back offer or re-introduction message.`;
    case RetentionTier.LOST:
      return args.lifecycleStage === LifecycleStage.CHURNED
        ? "Marked churned. Move to a low-frequency reactivation list only."
        : `No engagement in ${args.days}d. One final win-back, then suppress to protect deliverability.`;
    default:
      return "Monitor engagement.";
  }
}

interface ContactRow {
  id: string;
  name: string;
  phoneNumber: string;
  optedOut: boolean;
  lifecycleStage: LifecycleStage;
  aiScore: number | null;
  lastInteractionAt: Date | null;
  createdAt: Date;
}

/** Pure scoring — exported for unit tests. */
export function scoreContact(contact: ContactRow, now = new Date()): {
  tier: RetentionTier;
  score: number;
  daysSinceInteraction: number;
  factors: Record<FactorKey, RetentionFactor>;
  recommendation: string;
} {
  const reference = contact.lastInteractionAt ?? contact.createdAt;
  const daysSinceInteraction = Math.max(
    0,
    Math.floor((now.getTime() - reference.getTime()) / DAY_MS),
  );

  const rec = recencyScore(daysSinceInteraction);
  const life = lifecycleScore(contact.lifecycleStage);
  const intent = clamp01(contact.aiScore ?? 0.4);

  const factors: Record<FactorKey, RetentionFactor> = {
    recency: {
      score: Number(rec.toFixed(2)),
      weight: WEIGHTS.recency,
      contribution: roundScore(rec * WEIGHTS.recency * 100),
      detail: contact.lastInteractionAt
        ? `Last interaction ${daysSinceInteraction}d ago.`
        : `No interaction yet; ${daysSinceInteraction}d since added.`,
    },
    lifecycle: {
      score: Number(life.toFixed(2)),
      weight: WEIGHTS.lifecycle,
      contribution: roundScore(life * WEIGHTS.lifecycle * 100),
      detail: `Lifecycle stage ${contact.lifecycleStage}.`,
    },
    intent: {
      score: Number(intent.toFixed(2)),
      weight: WEIGHTS.intent,
      contribution: roundScore(intent * WEIGHTS.intent * 100),
      detail:
        contact.aiScore != null
          ? `AI lead score ${Math.round(contact.aiScore * 100)}/100.`
          : "No AI lead score yet; neutral.",
    },
  };

  // Opt-out forces the floor regardless of other signals.
  const rawScore = contact.optedOut
    ? 0
    : roundScore(Object.values(factors).reduce((s, f) => s + f.contribution, 0));
  const tier = tierFor({ optedOut: contact.optedOut, days: daysSinceInteraction });
  const recommendation = recommendationFor({
    tier,
    days: daysSinceInteraction,
    name: contact.name,
    lifecycleStage: contact.lifecycleStage,
  });

  return { tier, score: rawScore, daysSinceInteraction, factors, recommendation };
}

/**
 * Score every contact for one tenant and upsert today's row. Returns the
 * rows sorted worst-first (LOST/DORMANT before ACTIVE) for the UI.
 */
export async function assessTenantRetention(
  tenantId: string,
  opts: { limit?: number; persist?: boolean } = {},
): Promise<RetentionSummary> {
  const persist = opts.persist ?? true;
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    orderBy: { lastInteractionAt: { sort: "asc", nulls: "first" } },
    take: Math.min(opts.limit ?? CONTACTS_PER_TENANT, CONTACTS_PER_TENANT),
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      optedOut: true,
      lifecycleStage: true,
      aiScore: true,
      lastInteractionAt: true,
      createdAt: true,
    },
  });

  const now = new Date();
  const dayKey = dayKeyUtc(now);
  const totals: Record<RetentionTier, number> = {
    [RetentionTier.ACTIVE]: 0,
    [RetentionTier.COOLING]: 0,
    [RetentionTier.DORMANT]: 0,
    [RetentionTier.LOST]: 0,
  };
  const rows: ContactRetentionRow[] = [];

  for (const contact of contacts) {
    const scored = scoreContact(contact, now);
    totals[scored.tier] += 1;
    rows.push({
      contactId: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      tier: scored.tier,
      score: scored.score,
      daysSinceInteraction: scored.daysSinceInteraction,
      optedOut: contact.optedOut,
      lifecycleStage: contact.lifecycleStage,
      recommendation: scored.recommendation,
      assessedAt: now,
      factors: scored.factors,
    });

    if (persist) {
      const factorsJson = scored.factors as unknown as Prisma.InputJsonValue;
      try {
        await prisma.contactRetentionScore.upsert({
          where: {
            tenantId_contactId_dayKey: { tenantId, contactId: contact.id, dayKey },
          },
          update: {
            assessedAt: now,
            score: scored.score,
            tier: scored.tier,
            daysSinceInteraction: scored.daysSinceInteraction,
            factors: factorsJson,
            recommendation: scored.recommendation,
          },
          create: {
            tenantId,
            contactId: contact.id,
            dayKey,
            score: scored.score,
            tier: scored.tier,
            daysSinceInteraction: scored.daysSinceInteraction,
            factors: factorsJson,
            recommendation: scored.recommendation,
          },
        });
      } catch (err) {
        console.error(
          `[retention] upsert failed for contact ${contact.id}:`,
          err,
        );
      }
    }
  }

  const tierRank: Record<RetentionTier, number> = {
    [RetentionTier.LOST]: 0,
    [RetentionTier.DORMANT]: 1,
    [RetentionTier.COOLING]: 2,
    [RetentionTier.ACTIVE]: 3,
  };
  rows.sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.score - b.score);

  return { tenantId, generatedAt: now, totals, totalScored: rows.length, rows };
}

/**
 * Customer-facing read. With refresh=true it recomputes (and persists)
 * today's scores; otherwise it serves the latest persisted rows and only
 * recomputes if nothing has been scored yet.
 */
export async function listRetention(args: {
  tenantId: string;
  refresh?: boolean;
  tier?: RetentionTier;
  limit?: number;
}): Promise<RetentionSummary> {
  if (args.refresh) {
    const summary = await assessTenantRetention(args.tenantId, {
      limit: args.limit,
    });
    return filterSummary(summary, args.tier, args.limit);
  }

  const latest = await prisma.contactRetentionScore.findFirst({
    where: { tenantId: args.tenantId },
    orderBy: { assessedAt: "desc" },
    select: { dayKey: true },
  });
  if (!latest) {
    const summary = await assessTenantRetention(args.tenantId, {
      limit: args.limit,
    });
    return filterSummary(summary, args.tier, args.limit);
  }

  const stored = await prisma.contactRetentionScore.findMany({
    where: {
      tenantId: args.tenantId,
      dayKey: latest.dayKey,
      ...(args.tier ? { tier: args.tier } : {}),
    },
    orderBy: [{ score: "asc" }],
    take: args.limit ?? 200,
    include: {
      contact: {
        select: {
          name: true,
          phoneNumber: true,
          optedOut: true,
          lifecycleStage: true,
        },
      },
    },
  });

  // Totals come from the full day's set, independent of the tier filter.
  const grouped = await prisma.contactRetentionScore.groupBy({
    by: ["tier"],
    where: { tenantId: args.tenantId, dayKey: latest.dayKey },
    _count: { _all: true },
  });
  const totals: Record<RetentionTier, number> = {
    [RetentionTier.ACTIVE]: 0,
    [RetentionTier.COOLING]: 0,
    [RetentionTier.DORMANT]: 0,
    [RetentionTier.LOST]: 0,
  };
  for (const g of grouped) totals[g.tier] = g._count._all;

  const rows: ContactRetentionRow[] = stored.map((s) => ({
    contactId: s.contactId,
    name: s.contact.name,
    phoneNumber: s.contact.phoneNumber,
    tier: s.tier,
    score: s.score,
    daysSinceInteraction: s.daysSinceInteraction,
    optedOut: s.contact.optedOut,
    lifecycleStage: s.contact.lifecycleStage,
    recommendation: s.recommendation ?? "",
    assessedAt: s.assessedAt,
    factors: s.factors as unknown as Record<FactorKey, RetentionFactor>,
  }));

  return {
    tenantId: args.tenantId,
    generatedAt: stored[0]?.assessedAt ?? new Date(),
    totals,
    totalScored: Object.values(totals).reduce((a, b) => a + b, 0),
    rows,
  };
}

function filterSummary(
  summary: RetentionSummary,
  tier: RetentionTier | undefined,
  limit: number | undefined,
): RetentionSummary {
  if (!tier) {
    return limit ? { ...summary, rows: summary.rows.slice(0, limit) } : summary;
  }
  const rows = summary.rows.filter((r) => r.tier === tier);
  return {
    ...summary,
    rows: limit ? rows.slice(0, limit) : rows,
  };
}

// ----------------------------------------------------------------------------
// Scheduled scan worker — bounded fan-out across active BUSINESS tenants.
// ----------------------------------------------------------------------------

export async function scanRetention(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { type: "BUSINESS", status: "ACTIVE" },
    select: { id: true },
    take: TENANTS_PER_SCAN,
    orderBy: { updatedAt: "desc" },
  });
  let scored = 0;
  for (const tenant of tenants) {
    try {
      const summary = await assessTenantRetention(tenant.id);
      scored += summary.totalScored;
      // Self-gating: no-ops cheaply unless the tenant is in AUTOPILOT with
      // a configured win-back sequence. Never let an autopilot hiccup abort
      // the rest of the scan.
      await runRetentionAutopilot({ tenantId: tenant.id, triggeredBy: "worker" });
    } catch (err) {
      console.error(`[retention] scan failed for tenant ${tenant.id}:`, err);
    }
  }
  return scored;
}

// ----------------------------------------------------------------------------
// Retention config + win-back autopilot (slice 2).
// ----------------------------------------------------------------------------

export interface RetentionConfigView {
  mode: RetentionMode;
  winbackSequenceId: string | null;
  maxEnrollPerRun: number;
  lastRunAt: Date | null;
  lastEnrolledCount: number;
}

const DEFAULT_CONFIG: RetentionConfigView = {
  mode: RetentionMode.MANUAL,
  winbackSequenceId: null,
  maxEnrollPerRun: 50,
  lastRunAt: null,
  lastEnrolledCount: 0,
};

export async function getRetentionConfig(
  tenantId: string,
): Promise<RetentionConfigView> {
  const row = await prisma.retentionConfig.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    mode: row.mode,
    winbackSequenceId: row.winbackSequenceId,
    maxEnrollPerRun: row.maxEnrollPerRun,
    lastRunAt: row.lastRunAt,
    lastEnrolledCount: row.lastEnrolledCount,
  };
}

export async function upsertRetentionConfig(args: {
  tenantId: string;
  mode?: RetentionMode;
  winbackSequenceId?: string | null;
  maxEnrollPerRun?: number;
}): Promise<RetentionConfigView> {
  // Validate the sequence belongs to this tenant before persisting so a
  // config can never point at another tenant's drip.
  if (args.winbackSequenceId) {
    const seq = await prisma.dripSequence.findFirst({
      where: { id: args.winbackSequenceId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!seq) {
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        404,
        "Win-back sequence not found for this tenant.",
      );
    }
  }

  const row = await prisma.retentionConfig.upsert({
    where: { tenantId: args.tenantId },
    update: {
      ...(args.mode !== undefined ? { mode: args.mode } : {}),
      ...(args.winbackSequenceId !== undefined
        ? { winbackSequenceId: args.winbackSequenceId }
        : {}),
      ...(args.maxEnrollPerRun !== undefined
        ? { maxEnrollPerRun: args.maxEnrollPerRun }
        : {}),
    },
    create: {
      tenantId: args.tenantId,
      mode: args.mode ?? RetentionMode.MANUAL,
      winbackSequenceId: args.winbackSequenceId ?? null,
      maxEnrollPerRun: args.maxEnrollPerRun ?? 50,
    },
  });

  return {
    mode: row.mode,
    winbackSequenceId: row.winbackSequenceId,
    maxEnrollPerRun: row.maxEnrollPerRun,
    lastRunAt: row.lastRunAt,
    lastEnrolledCount: row.lastEnrolledCount,
  };
}

export interface RetentionAutopilotResult {
  tenantId: string;
  mode: RetentionMode;
  winbackSequenceId: string | null;
  candidates: number;
  enrolled: number;
  skipped: number;
  reason?: string;
}

/**
 * Win-back autopilot. Selects DORMANT, non-opted-out contacts from the
 * latest scan that aren't already enrolled in the configured win-back
 * sequence, then:
 *   - MANUAL    → no-op (recommendations only).
 *   - ASSISTED  → returns the candidate count for operator approval; no enroll.
 *   - AUTOPILOT → enrolls up to `maxEnrollPerRun`.
 * `dryRun` forces candidate-only regardless of mode (used by the preview UI).
 */
export async function runRetentionAutopilot(args: {
  tenantId: string;
  dryRun?: boolean;
  triggeredBy?: "worker" | "manual";
}): Promise<RetentionAutopilotResult> {
  const config = await prisma.retentionConfig.findUnique({
    where: { tenantId: args.tenantId },
  });
  const mode = config?.mode ?? RetentionMode.MANUAL;
  const winbackSequenceId = config?.winbackSequenceId ?? null;
  const cap = Math.max(1, Math.min(config?.maxEnrollPerRun ?? 50, 500));
  const base: RetentionAutopilotResult = {
    tenantId: args.tenantId,
    mode,
    winbackSequenceId,
    candidates: 0,
    enrolled: 0,
    skipped: 0,
  };

  if (mode === RetentionMode.MANUAL) {
    return { ...base, reason: "Mode is MANUAL; no enrollment performed." };
  }
  if (!winbackSequenceId) {
    return { ...base, reason: "No win-back sequence configured." };
  }

  // The sequence must be ACTIVE with steps, else enrollment would throw for
  // every contact — surface a clear reason instead.
  const seq = await prisma.dripSequence.findFirst({
    where: { id: winbackSequenceId, tenantId: args.tenantId },
    select: { status: true },
  });
  if (!seq) {
    return { ...base, reason: "Configured win-back sequence no longer exists." };
  }
  if (seq.status !== DripSequenceStatus.ACTIVE) {
    return { ...base, reason: "Win-back sequence is not ACTIVE." };
  }

  const latest = await prisma.contactRetentionScore.findFirst({
    where: { tenantId: args.tenantId },
    orderBy: { assessedAt: "desc" },
    select: { dayKey: true },
  });
  if (!latest) {
    return { ...base, reason: "No retention scores yet; run a scan first." };
  }

  const dormant = await prisma.contactRetentionScore.findMany({
    where: {
      tenantId: args.tenantId,
      dayKey: latest.dayKey,
      tier: RetentionTier.DORMANT,
    },
    select: { contactId: true },
    take: 1000,
  });
  if (dormant.length === 0) {
    return { ...base, reason: "No dormant contacts in the latest scan." };
  }
  const dormantIds = dormant.map((d) => d.contactId);

  // Drop opted-out contacts (belt-and-suspenders: enrollContact also guards).
  const eligible = await prisma.contact.findMany({
    where: { tenantId: args.tenantId, id: { in: dormantIds }, optedOut: false },
    select: { id: true },
  });
  const eligibleIds = eligible.map((c) => c.id);

  // Skip anyone already enrolled in this sequence (any status) so a
  // re-scan never re-spams a contact who already went through win-back.
  const alreadyEnrolled = await prisma.dripEnrollment.findMany({
    where: {
      tenantId: args.tenantId,
      sequenceId: winbackSequenceId,
      contactId: { in: eligibleIds },
    },
    select: { contactId: true },
  });
  const enrolledSet = new Set(alreadyEnrolled.map((e) => e.contactId));
  const toEnroll = eligibleIds.filter((id) => !enrolledSet.has(id)).slice(0, cap);
  base.candidates = toEnroll.length;

  if (args.dryRun || mode === RetentionMode.ASSISTED) {
    return {
      ...base,
      reason: args.dryRun
        ? "Dry run; candidates surfaced, no enrollment."
        : "Mode is ASSISTED; candidates surfaced for approval.",
    };
  }

  // AUTOPILOT — enroll each candidate. enrollContact is idempotent and
  // opt-out-safe, so a race or stale filter can't double-send.
  const { enrollContact } = await import("./dripSequence.service");
  let enrolled = 0;
  let skipped = 0;
  for (const contactId of toEnroll) {
    try {
      await enrollContact({
        tenantId: args.tenantId,
        sequenceId: winbackSequenceId,
        contactId,
      });
      enrolled += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        `[retention] autopilot enroll skipped contact=${contactId}: ${(err as Error).message}`,
      );
    }
  }

  try {
    await prisma.retentionConfig.update({
      where: { tenantId: args.tenantId },
      data: { lastRunAt: new Date(), lastEnrolledCount: enrolled },
    });
  } catch (err) {
    console.error("[retention] failed to stamp autopilot run:", err);
  }

  return { ...base, enrolled, skipped };
}

export function startContactRetentionWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void scanRetention().catch((err) => {
      console.error("[retention] scan failed:", err);
    });
  }, SCAN_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  void scanRetention().catch((err) => {
    console.error("[retention] initial scan failed:", err);
  });
}

export function stopContactRetentionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ----------------------------------------------------------------------------
// LLM win-back copy (slice 3). Generate-then-approve: this only DRAFTS a
// message for a single at-risk contact — it never sends. The operator
// reviews/edits and pastes it into a template, campaign, or drip. Billed to
// the tenant; deterministic fallback so the UI is never empty.
// ----------------------------------------------------------------------------

export interface WinbackCopyResult {
  contactId: string;
  message: string;
  variants: string[];
  source: "ai" | "fallback";
}

function clampText(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

export async function generateWinbackCopy(args: {
  tenantId: string;
  contactId: string;
  tone?: string;
  businessName?: string;
}): Promise<WinbackCopyResult> {
  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, tenantId: args.tenantId },
    select: {
      id: true,
      name: true,
      lifecycleStage: true,
      optedOut: true,
      aiScore: true,
      lastInteractionAt: true,
      createdAt: true,
      tags: true,
    },
  });
  if (!contact) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
  }
  // Never help craft outreach to someone who opted out.
  if (contact.optedOut) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Contact has opted out; cannot draft outreach.",
    );
  }

  const scored = scoreContact(
    { ...contact, phoneNumber: "" },
    new Date(),
  );
  const firstName = (contact.name || "there").split(" ")[0] || "there";

  const fallback: WinbackCopyResult = {
    contactId: contact.id,
    message: `Hi ${firstName}, we've missed you! It's been a little while — is there anything we can help you with today? Just reply here and we'll take care of it. 💬`,
    variants: [
      `Hey ${firstName}, checking in 👋 We'd love to have you back — can we help with anything?`,
      `Hi ${firstName}, a quick nudge from us: reply to pick up right where you left off. We're one message away.`,
    ],
    source: "fallback",
  };

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{ message?: string; variants?: string[] }>({
      tenantId: args.tenantId,
      feature: "retention_winback_copy",
      system:
        "You are a WhatsApp win-back copywriter for a business re-engaging a " +
        "quiet contact. Write warm, concise, non-pushy messages that invite a " +
        "reply. Under 320 characters each, at most one emoji, no spammy ALL-CAPS, " +
        "no fake urgency, and always respect that the person can ignore it. " +
        'Return JSON: {"message":"primary message","variants":["alt 1","alt 2"]}',
      prompt: JSON.stringify({
        firstName,
        businessName: args.businessName,
        lifecycleStage: contact.lifecycleStage,
        daysSinceInteraction: scored.daysSinceInteraction,
        tier: scored.tier,
        tags: (contact.tags ?? []).slice(0, 5),
        tone: args.tone ?? "warm and friendly",
      }),
      maxTokens: 500,
      temperature: 0.7,
    });

    const message = clampText(llm.message, 1000);
    const variants = Array.isArray(llm.variants)
      ? llm.variants
          .filter((v) => typeof v === "string" && v.trim())
          .slice(0, 3)
          .map((v) => v.trim().slice(0, 1000))
      : [];

    if (!message && variants.length === 0) return fallback;

    return {
      contactId: contact.id,
      message: message || variants[0],
      variants: message ? variants : variants.slice(1),
      source: "ai",
    };
  } catch (err) {
    console.error("[retention] winback copy generation failed:", err);
    return fallback;
  }
}
