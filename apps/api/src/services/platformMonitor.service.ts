import { Worker } from "bullmq";
import {
  prisma,
  PlatformActionCode,
  PlatformActionSeverity,
  PlatformActionStatus,
  WalletRiskTier,
  WhatsAppProviderKey,
  ComplianceVerdict,
  type Prisma,
} from "@nexaflow/db";
import {
  getPlatformMonitorQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type PlatformMonitorJobData,
} from "../lib/queue";

// ----------------------------------------------------------------------------
// AI Platform Monitor / Autonomous SaaS Operator (PRD-v2 §8, Sprint 2).
//
// The SuperAdmin's triage queue. The scheduled scan ingests signals from
// the other Sprint-2 engines (Wallet Risk, Compliance Firewall, Provider
// Router) and writes PlatformActionItem rows. dedupeKey lets the scan
// upsert cleanly so a condition that holds across multiple scans
// converges on a single row, not a stack of duplicates.
//
// Slice 1 (this file) implements the deterministic signal gatherers.
// Slice 2 will add an LLM "daily plan" summary on top + push alerts
// when a HIGH/URGENT item lands.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SCAN_JOB_NAME = "scan";

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Helper that turns the gathered signal into a stable upsert. dedupeKey
// embeds the day so we get one row per condition per day; the body /
// severity / context can move from scan to scan as the underlying
// numbers change.
async function upsertItem(args: {
  code: PlatformActionCode;
  severity: PlatformActionSeverity;
  title: string;
  body: string;
  targetTenantId?: string | null;
  context?: Record<string, unknown>;
  dedupeKey: string;
}) {
  const baseData = {
    code: args.code,
    severity: args.severity,
    title: args.title,
    body: args.body,
    targetTenantId: args.targetTenantId ?? null,
    context: (args.context ?? {}) as Prisma.InputJsonValue,
  };
  return prisma.platformActionItem.upsert({
    where: { dedupeKey: args.dedupeKey },
    create: { ...baseData, dedupeKey: args.dedupeKey },
    update: {
      ...baseData,
      // Re-open if a resolved item is observed again the next day —
      // operators should see it back in the queue.
      status: PlatformActionStatus.OPEN,
      resolvedAt: null,
      resolvedByUserId: null,
      snoozedUntil: null,
    },
  });
}

// ----------------------------------------------------------------------------
// Wallet-risk signals — every CRITICAL or URGENT assessment in the last
// 24h becomes an item. severity maps directly (CRITICAL→URGENT,
// URGENT→HIGH); the body cites days-to-zero so the operator can act
// without clicking into the wallet page first.
// ----------------------------------------------------------------------------

async function gatherWalletRiskSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await prisma.walletRiskAssessment.findMany({
    where: {
      assessedAt: { gte: since },
      riskTier: { in: [WalletRiskTier.CRITICAL, WalletRiskTier.URGENT] },
    },
    select: {
      id: true,
      tenantId: true,
      riskTier: true,
      daysToZero: true,
      balanceCredits: true,
      recommendedActionCode: true,
      tenant: { select: { name: true } },
    },
    orderBy: { assessedAt: "desc" },
    take: 500,
  });

  // De-dup by tenant: keep the freshest assessment per tenant (the
  // findMany is already ordered desc).
  const byTenant = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, row);
  }

  let written = 0;
  const today = dayKey(now);
  for (const row of byTenant.values()) {
    const isCritical = row.riskTier === WalletRiskTier.CRITICAL;
    const code = isCritical
      ? PlatformActionCode.WALLET_RISK_CRITICAL
      : PlatformActionCode.WALLET_RISK_URGENT;
    const severity = isCritical
      ? PlatformActionSeverity.URGENT
      : PlatformActionSeverity.HIGH;
    const days =
      row.daysToZero != null && Number.isFinite(row.daysToZero)
        ? row.daysToZero < 1
          ? "less than a day"
          : `~${Math.round(row.daysToZero)} days`
        : "balance below threshold";
    await upsertItem({
      code,
      severity,
      title: `${row.tenant.name}: wallet ${row.riskTier}`,
      body: `${days} of runway left. Suggested action: ${row.recommendedActionCode}.`,
      targetTenantId: row.tenantId,
      context: {
        assessmentId: row.id,
        riskTier: row.riskTier,
        daysToZero: row.daysToZero,
        balanceCredits: row.balanceCredits,
        recommendedActionCode: row.recommendedActionCode,
      },
      dedupeKey: `${code}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Compliance signals — tenants with ≥3 BLOCK verdicts in the last 24h get
// a single COMPLIANCE_BLOCK_SPIKE item rather than one per check. The
// context carries the most-recent block IDs so the operator can click
// through.
// ----------------------------------------------------------------------------

const BLOCK_SPIKE_THRESHOLD = 3;

async function gatherComplianceSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const grouped = await prisma.complianceCheck.groupBy({
    by: ["tenantId"],
    _count: { _all: true },
    where: {
      createdAt: { gte: since },
      verdict: ComplianceVerdict.BLOCK,
    },
    having: { tenantId: { _count: { gte: BLOCK_SPIKE_THRESHOLD } } },
    orderBy: { _count: { tenantId: "desc" } },
    take: 200,
  });
  if (grouped.length === 0) return 0;

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: grouped.map((g) => g.tenantId) } },
    select: { id: true, name: true },
  });
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  let written = 0;
  const today = dayKey(now);
  for (const row of grouped) {
    const recent = await prisma.complianceCheck.findMany({
      where: {
        tenantId: row.tenantId,
        verdict: ComplianceVerdict.BLOCK,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, scope: true, score: true },
    });

    await upsertItem({
      code: PlatformActionCode.COMPLIANCE_BLOCK_SPIKE,
      severity:
        row._count._all >= 10
          ? PlatformActionSeverity.URGENT
          : PlatformActionSeverity.HIGH,
      title: `${tenantName.get(row.tenantId) ?? "Tenant"}: ${row._count._all} compliance blocks`,
      body: `Compliance Firewall blocked ${row._count._all} outbound items in the last 24h. Investigate content quality / forbidden phrases.`,
      targetTenantId: row.tenantId,
      context: {
        blockCount24h: row._count._all,
        recentCheckIds: recent.map((r) => r.id),
        recentScopes: recent.map((r) => r.scope),
      },
      dedupeKey: `${PlatformActionCode.COMPLIANCE_BLOCK_SPIKE}:${row.tenantId}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Webhook failure signals — a tenant whose outbound webhook is failing
// at high rate in the last 24h shows up as WEBHOOK_FAILURE_SPIKE. The
// auto-heal action (slice 1 reliability slice): a catastrophic 95%+
// failure rate on ≥20 events flips Webhook.isActive=false so the
// dispatcher stops hammering a clearly-dead endpoint. The Webhook row
// stays — operator/tenant can re-enable manually after fixing the
// upstream issue.
// ----------------------------------------------------------------------------

const WEBHOOK_MIN_VOLUME = 10;
const WEBHOOK_HIGH_RATE = 0.5;
const WEBHOOK_URGENT_RATE = 0.8;
const WEBHOOK_AUTO_DISABLE_RATE = 0.95;
const WEBHOOK_AUTO_DISABLE_MIN_VOLUME = 20;

export interface WebhookClassification {
  severity: PlatformActionSeverity | null;
  shouldAutoDisable: boolean;
  rate: number;
}

/**
 * Pure classifier for a webhook's 24h reliability — exported for tests.
 *
 *   total < 10                                  → null (too small to judge)
 *   95%+ failures AND total >= 20               → URGENT + auto-disable
 *   80%+ failures                               → URGENT
 *   50%+ failures                               → HIGH
 *   else                                        → null
 */
export function classifyWebhookHealth(args: {
  total: number;
  failures: number;
}): WebhookClassification {
  if (args.total < WEBHOOK_MIN_VOLUME) {
    return { severity: null, shouldAutoDisable: false, rate: 0 };
  }
  const rate = args.failures / args.total;
  if (
    rate >= WEBHOOK_AUTO_DISABLE_RATE &&
    args.total >= WEBHOOK_AUTO_DISABLE_MIN_VOLUME
  ) {
    return {
      severity: PlatformActionSeverity.URGENT,
      shouldAutoDisable: true,
      rate,
    };
  }
  if (rate >= WEBHOOK_URGENT_RATE) {
    return { severity: PlatformActionSeverity.URGENT, shouldAutoDisable: false, rate };
  }
  if (rate >= WEBHOOK_HIGH_RATE) {
    return { severity: PlatformActionSeverity.HIGH, shouldAutoDisable: false, rate };
  }
  return { severity: null, shouldAutoDisable: false, rate };
}

async function gatherWebhookFailureSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // WebhookLog has no tenantId column; group by webhookId, then resolve
  // tenant + active state in one Webhook query keyed by the same ids.
  const totals = await prisma.webhookLog.groupBy({
    by: ["webhookId"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  if (totals.length === 0) return 0;

  const failures = await prisma.webhookLog.groupBy({
    by: ["webhookId"],
    where: {
      createdAt: { gte: since },
      OR: [
        { statusCode: { gte: 400 } },
        { statusCode: null }, // dispatcher never got a response
        { error: { not: null } },
      ],
    },
    _count: { _all: true },
  });
  const failureMap = new Map<string, number>();
  for (const f of failures) failureMap.set(f.webhookId, f._count._all);

  const candidates: Array<{
    webhookId: string;
    total: number;
    failures: number;
    classification: WebhookClassification;
  }> = [];
  for (const row of totals) {
    const total = row._count._all;
    const fails = failureMap.get(row.webhookId) ?? 0;
    const classification = classifyWebhookHealth({ total, failures: fails });
    if (classification.severity) {
      candidates.push({ webhookId: row.webhookId, total, failures: fails, classification });
    }
  }
  if (candidates.length === 0) return 0;

  // Resolve tenant + active state for every candidate in one round trip.
  const webhooks = await prisma.webhook.findMany({
    where: { id: { in: candidates.map((c) => c.webhookId) } },
    select: { id: true, tenantId: true, url: true, isActive: true },
  });
  const webhookMap = new Map(webhooks.map((w) => [w.id, w]));

  let written = 0;
  const today = dayKey(now);
  for (const c of candidates) {
    const webhook = webhookMap.get(c.webhookId);
    // Skip orphaned logs whose webhook row is gone.
    if (!webhook) continue;

    // Auto-heal: flip isActive=false on catastrophic failure rate.
    // Only act once — if it's already disabled, skip the write so we
    // don't churn updatedAt every scan.
    let autoDisabled = false;
    if (c.classification.shouldAutoDisable && webhook.isActive) {
      try {
        await prisma.webhook.update({
          where: { id: webhook.id },
          data: { isActive: false },
        });
        autoDisabled = true;
      } catch (err) {
        console.warn(
          `[platform-monitor] auto-disable failed for webhook ${webhook.id}:`,
          (err as Error).message,
        );
      }
    }

    await upsertItem({
      code: PlatformActionCode.WEBHOOK_FAILURE_SPIKE,
      severity: c.classification.severity!,
      title: `Webhook failing: ${(c.classification.rate * 100).toFixed(0)}% errors`,
      body: autoDisabled
        ? `Auto-disabled ${webhook.url} after ${c.failures}/${c.total} failed deliveries in 24h. Re-enable manually after fixing the endpoint.`
        : `${c.failures}/${c.total} deliveries failed in 24h for ${webhook.url}. Investigate the endpoint.`,
      targetTenantId: webhook.tenantId,
      context: {
        webhookId: webhook.id,
        webhookUrl: webhook.url,
        failureRate: c.classification.rate,
        failures: c.failures,
        total: c.total,
        autoDisabled,
      },
      dedupeKey: `${PlatformActionCode.WEBHOOK_FAILURE_SPIKE}:${webhook.id}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Provider Router signals — a provider with <90% success and ≥20 samples
// in the last 24h shows up as PROVIDER_HEALTH_DEGRADED. Cross-tenant; the
// item targets the platform, not a specific tenant.
// ----------------------------------------------------------------------------

const PROVIDER_DEGRADED_THRESHOLD = 0.9;
const PROVIDER_MIN_VOLUME = 20;

async function gatherProviderHealthSignals(now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const samples = await prisma.providerHealthSample.findMany({
    where: { createdAt: { gte: since } },
    select: { providerKey: true, success: true },
    take: 200_000,
  });
  if (samples.length === 0) return 0;

  const buckets = new Map<
    WhatsAppProviderKey,
    { total: number; success: number }
  >();
  for (const s of samples) {
    let bucket = buckets.get(s.providerKey);
    if (!bucket) {
      bucket = { total: 0, success: 0 };
      buckets.set(s.providerKey, bucket);
    }
    bucket.total += 1;
    if (s.success) bucket.success += 1;
  }

  let written = 0;
  const today = dayKey(now);
  for (const [providerKey, b] of buckets.entries()) {
    if (b.total < PROVIDER_MIN_VOLUME) continue;
    const rate = b.success / b.total;
    if (rate >= PROVIDER_DEGRADED_THRESHOLD) continue;

    const severity =
      rate < 0.7
        ? PlatformActionSeverity.URGENT
        : rate < 0.85
          ? PlatformActionSeverity.HIGH
          : PlatformActionSeverity.MEDIUM;

    await upsertItem({
      code: PlatformActionCode.PROVIDER_HEALTH_DEGRADED,
      severity,
      title: `${providerKey}: success rate ${(rate * 100).toFixed(1)}%`,
      body: `${b.success}/${b.total} sends succeeded in the last 24h. Consider switching the route or alerting the BSP.`,
      // Platform-level, not tenant-scoped.
      targetTenantId: null,
      context: {
        providerKey,
        successRate: rate,
        successCount: b.success,
        totalSends: b.total,
      },
      dedupeKey: `${PlatformActionCode.PROVIDER_HEALTH_DEGRADED}:${providerKey}:${today}`,
    });
    written += 1;
  }
  return written;
}

// ----------------------------------------------------------------------------
// Orchestration
// ----------------------------------------------------------------------------

export interface ScanResult {
  walletItems: number;
  complianceItems: number;
  providerItems: number;
  webhookItems: number;
  total: number;
}

export async function runDailyScan(): Promise<ScanResult> {
  const now = new Date();
  // Per-gatherer try/catch so a flaky signal source can't kill the rest
  // of the scan. Failures land in logs; the missing signals just don't
  // appear in this scan's output.
  let walletItems = 0;
  let complianceItems = 0;
  let providerItems = 0;
  let webhookItems = 0;
  try {
    walletItems = await gatherWalletRiskSignals(now);
  } catch (err) {
    console.warn("[platform-monitor] wallet scan failed:", (err as Error).message);
  }
  try {
    complianceItems = await gatherComplianceSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] compliance scan failed:",
      (err as Error).message,
    );
  }
  try {
    providerItems = await gatherProviderHealthSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] provider scan failed:",
      (err as Error).message,
    );
  }
  try {
    webhookItems = await gatherWebhookFailureSignals(now);
  } catch (err) {
    console.warn(
      "[platform-monitor] webhook scan failed:",
      (err as Error).message,
    );
  }
  return {
    walletItems,
    complianceItems,
    providerItems,
    webhookItems,
    total: walletItems + complianceItems + providerItems + webhookItems,
  };
}

// ----------------------------------------------------------------------------
// Reads + status mutations (SuperAdmin route uses these)
// ----------------------------------------------------------------------------

export interface ListItemsFilter {
  status?: PlatformActionStatus;
  severity?: PlatformActionSeverity;
  code?: PlatformActionCode;
  tenantId?: string;
  limit?: number;
}

const SEVERITY_RANK: Record<PlatformActionSeverity, number> = {
  [PlatformActionSeverity.URGENT]: 0,
  [PlatformActionSeverity.HIGH]: 1,
  [PlatformActionSeverity.MEDIUM]: 2,
  [PlatformActionSeverity.LOW]: 3,
};

export async function listItems(filter: ListItemsFilter = {}) {
  const rows = await prisma.platformActionItem.findMany({
    where: {
      ...(filter.status && { status: filter.status }),
      ...(filter.severity && { severity: filter.severity }),
      ...(filter.code && { code: filter.code }),
      ...(filter.tenantId && { targetTenantId: filter.tenantId }),
    },
    include: {
      targetTenant: { select: { id: true, name: true } },
    },
    take: Math.min(filter.limit ?? 500, 1000),
    orderBy: { createdAt: "desc" },
  });
  // Severity-first sort matches the wallet-risk portfolio convention.
  rows.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return rows;
}

export async function updateItemStatus(args: {
  itemId: string;
  status: PlatformActionStatus;
  userId: string;
  snoozedUntil?: Date | null;
}) {
  const data: Record<string, unknown> = {
    status: args.status,
  };
  if (args.status === PlatformActionStatus.RESOLVED) {
    data.resolvedAt = new Date();
    data.resolvedByUserId = args.userId;
  } else if (args.status === PlatformActionStatus.OPEN) {
    data.resolvedAt = null;
    data.resolvedByUserId = null;
    data.snoozedUntil = null;
  } else if (args.status === PlatformActionStatus.SNOOZED) {
    data.snoozedUntil = args.snoozedUntil ?? null;
  }
  return prisma.platformActionItem.update({
    where: { id: args.itemId },
    data,
    include: { targetTenant: { select: { id: true, name: true } } },
  });
}

// ----------------------------------------------------------------------------
// Worker
// ----------------------------------------------------------------------------

let platformMonitorWorker: Worker<PlatformMonitorJobData> | null = null;

export async function startPlatformMonitorWorker(): Promise<void> {
  if (platformMonitorWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[platform-monitor] database unavailable; worker not started.",
    );
    return;
  }
  const q = getPlatformMonitorQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[platform-monitor] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }
  platformMonitorWorker = new Worker<PlatformMonitorJobData>(
    QueueNames.PLATFORM_MONITOR,
    async (job) => {
      if (job.name === SCAN_JOB_NAME) return runDailyScan();
      return { skipped: true };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  platformMonitorWorker.on("failed", (job, err) => {
    console.error(
      `[platform-monitor] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });
  trackWorker(platformMonitorWorker);
}

export function stopPlatformMonitorWorker(): void {
  if (!platformMonitorWorker) return;
  void platformMonitorWorker.close();
  platformMonitorWorker = null;
}
