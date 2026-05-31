// ============================================================================
// White-label Domain Health monitor (PRD-v2 §5, Sprint 5 slice 1)
//
// Scheduled DNS/SSL drift watcher for every VERIFIED partner / customer
// domain. checkDomain (services/domain.service.ts) already runs a single
// end-to-end probe and updates the Domain row's authoritative state; this
// service wraps that into a 6-hour scan that:
//
//   1. Picks domains in a "should-be-healthy" state (LIVE / SSL_ACTIVE /
//      TXT_VERIFIED / SSL_PENDING). Domains that are still PENDING_DNS or
//      DNS_FOUND are skipped — they haven't reached the verified bar yet
//      and the operator owns that flow.
//   2. Runs checkDomain on each, records a DomainHealthSample row with
//      the cname/txt/ssl booleans and latency.
//   3. Walks the rolling history per domain: 3 consecutive non-OK samples
//      escalate to a PlatformActionItem DOMAIN_HEALTH_DEGRADED so a
//      SuperAdmin (and the owning partner) sees it in the triage queue.
//
// The escalation key embeds the domain id + day so a sustained outage
// upserts the same row instead of stacking duplicates.
// ============================================================================

import dns from "node:dns/promises";
import https from "node:https";
import {
  prisma,
  Prisma,
  DomainHealthOutcome,
  DomainStatus,
  DomainSslStatus,
  PlatformActionCode,
  PlatformActionSeverity,
  PlatformActionStatus,
} from "@nexaflow/db";

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const CONSECUTIVE_FAILS_TO_ESCALATE = 3;
const SAMPLE_RETENTION_DAYS = 14;
const SSL_PROBE_TIMEOUT_MS = 5000;

let timer: ReturnType<typeof setInterval> | null = null;

const HEALTHY_STATES: DomainStatus[] = [
  DomainStatus.LIVE,
  DomainStatus.SSL_ACTIVE,
  DomainStatus.TXT_VERIFIED,
  DomainStatus.SSL_PENDING,
];

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function normalizeDnsValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

async function probeCname(host: string, expected: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(host);
    const want = normalizeDnsValue(expected);
    return records.some((r) => normalizeDnsValue(r) === want);
  } catch {
    return false;
  }
}

async function probeTxt(host: string, expected: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(host);
    return records.map((parts) => parts.join("")).some((r) => r.trim() === expected);
  } catch {
    return false;
  }
}

/** Light SSL probe — just needs a valid cert in date range. */
async function probeSsl(domain: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.request(
      {
        hostname: domain,
        path: "/",
        method: "HEAD",
        agent,
        timeout: SSL_PROBE_TIMEOUT_MS,
      },
      (res) => {
        const sock = res.socket as import("node:tls").TLSSocket | undefined;
        const cert = sock?.getPeerCertificate?.(false);
        if (!cert?.valid_from || !cert?.valid_to) {
          resolve(false);
          return;
        }
        const now = Date.now();
        resolve(now >= Date.parse(cert.valid_from) && now <= Date.parse(cert.valid_to));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

interface DomainRow {
  id: string;
  tenantId: string;
  partnerTenantId: string | null;
  domain: string;
  cnameHost: string;
  cnameValue: string;
  txtHost: string;
  txtValue: string;
  status: DomainStatus;
}

export interface DomainHealthSampleResult {
  outcome: DomainHealthOutcome;
  cnameOk: boolean;
  txtOk: boolean;
  sslOk: boolean;
  latencyMs: number;
  error: string | null;
}

function classify(args: {
  cnameOk: boolean;
  txtOk: boolean;
  sslOk: boolean;
  sslExpected: boolean;
  errored: boolean;
}): { outcome: DomainHealthOutcome; error: string | null } {
  if (args.errored) {
    return { outcome: DomainHealthOutcome.UNREACHABLE, error: "Probe failed" };
  }
  if (!args.cnameOk || !args.txtOk) {
    return {
      outcome: DomainHealthOutcome.DNS_DRIFT,
      error: !args.cnameOk ? "CNAME no longer resolves." : "TXT record missing.",
    };
  }
  if (args.sslExpected && !args.sslOk) {
    return { outcome: DomainHealthOutcome.SSL_FAILED, error: "SSL cert invalid or expired." };
  }
  return { outcome: DomainHealthOutcome.OK, error: null };
}

/**
 * Probe one domain and persist a sample. Returns the sample for callers
 * that want to react (e.g. the scan loop computing consecutive failures).
 * Exported for tests and the manual "Refresh" hook.
 */
export async function sampleDomainHealth(
  row: DomainRow,
): Promise<DomainHealthSampleResult> {
  const started = Date.now();
  // SSL only counts against a domain that's supposed to have a working cert.
  const sslExpected =
    row.status === DomainStatus.LIVE || row.status === DomainStatus.SSL_ACTIVE;

  let cnameOk = false;
  let txtOk = false;
  let sslOk = !sslExpected;
  let errored = false;

  try {
    const [c, t] = await Promise.all([
      probeCname(row.cnameHost, row.cnameValue),
      probeTxt(row.txtHost, row.txtValue),
    ]);
    cnameOk = c;
    txtOk = t;
    if (sslExpected && cnameOk) {
      // Don't bother SSL-probing a domain whose DNS has already drifted.
      sslOk = await probeSsl(row.domain);
    }
  } catch {
    errored = true;
  }

  const latencyMs = Date.now() - started;
  const { outcome, error } = classify({
    cnameOk,
    txtOk,
    sslOk,
    sslExpected,
    errored,
  });

  try {
    await prisma.domainHealthSample.create({
      data: {
        domainId: row.id,
        tenantId: row.tenantId,
        partnerTenantId: row.partnerTenantId,
        outcome,
        cnameOk,
        txtOk,
        sslOk,
        latencyMs,
        error: error?.slice(0, 280) ?? null,
      },
    });
  } catch (err) {
    console.error(`[domain-health] failed to write sample ${row.id}:`, err);
  }

  // Mirror the outcome onto the Domain row so the existing partner UI
  // (which reads Domain.lastError / sslStatus) reflects the drift without
  // waiting for an operator to click "Verify".
  try {
    const nextSsl: DomainSslStatus | undefined = sslExpected
      ? sslOk
        ? DomainSslStatus.ACTIVE
        : DomainSslStatus.FAILED
      : undefined;
    await prisma.domain.update({
      where: { id: row.id },
      data: {
        lastCheckedAt: new Date(),
        ...(nextSsl ? { sslStatus: nextSsl } : {}),
        lastError: error,
      },
    });
  } catch (err) {
    console.error(`[domain-health] failed to update domain ${row.id}:`, err);
  }

  return { outcome, cnameOk, txtOk, sslOk, latencyMs, error };
}

/**
 * Decide whether to escalate based on rolling history. Pure function —
 * exported for unit tests. Returns the severity to escalate at, or null
 * to skip escalation.
 *
 * Rules:
 *   - SSL_FAILED, current        → HIGH (cert outage is customer-visible)
 *   - DNS_DRIFT or UNREACHABLE, ≥3 consecutive non-OK including now → HIGH
 *   - DNS_DRIFT or UNREACHABLE, current but <3 streak                → null
 *   - OK                                                              → null
 */
export function decideEscalation(args: {
  current: DomainHealthOutcome;
  recent: DomainHealthOutcome[]; // newest-first, current row included
}): PlatformActionSeverity | null {
  if (args.current === DomainHealthOutcome.OK) return null;
  if (args.current === DomainHealthOutcome.SSL_FAILED) {
    return PlatformActionSeverity.HIGH;
  }
  // Count the leading streak of non-OK samples.
  let streak = 0;
  for (const o of args.recent) {
    if (o === DomainHealthOutcome.OK) break;
    streak += 1;
    if (streak >= CONSECUTIVE_FAILS_TO_ESCALATE) break;
  }
  return streak >= CONSECUTIVE_FAILS_TO_ESCALATE
    ? PlatformActionSeverity.HIGH
    : null;
}

async function escalate(args: {
  domain: DomainRow;
  outcome: DomainHealthOutcome;
  severity: PlatformActionSeverity;
}): Promise<void> {
  const code = PlatformActionCode.DOMAIN_HEALTH_DEGRADED;
  const dedupeKey = `${code}:${args.domain.id}:${dayKey()}`;
  const title = `Domain drift: ${args.domain.domain}`;
  const body =
    args.outcome === DomainHealthOutcome.SSL_FAILED
      ? `SSL certificate for ${args.domain.domain} is invalid or expired.`
      : args.outcome === DomainHealthOutcome.DNS_DRIFT
        ? `DNS records for ${args.domain.domain} no longer resolve correctly.`
        : `Health probe for ${args.domain.domain} is failing repeatedly.`;
  const context: Prisma.InputJsonValue = {
    domainId: args.domain.id,
    tenantId: args.domain.tenantId,
    partnerTenantId: args.domain.partnerTenantId,
    outcome: args.outcome,
  };
  try {
    await prisma.platformActionItem.upsert({
      where: { dedupeKey },
      create: {
        code,
        severity: args.severity,
        title,
        body,
        targetTenantId: args.domain.tenantId,
        context,
        dedupeKey,
      },
      update: {
        severity: args.severity,
        title,
        body,
        targetTenantId: args.domain.tenantId,
        context,
        // Re-open if a previously-resolved row drifts again the next day.
        status: PlatformActionStatus.OPEN,
        resolvedAt: null,
        resolvedByUserId: null,
        snoozedUntil: null,
      },
    });
  } catch (err) {
    console.error(`[domain-health] failed to escalate ${args.domain.id}:`, err);
  }
}

/** Scan one batch — exported for `force run` tests. */
export async function scanDomainHealth(): Promise<{ scanned: number; escalated: number }> {
  const domains = await prisma.domain.findMany({
    where: { status: { in: HEALTHY_STATES } },
    select: {
      id: true,
      tenantId: true,
      partnerTenantId: true,
      domain: true,
      cnameHost: true,
      cnameValue: true,
      txtHost: true,
      txtValue: true,
      status: true,
    },
    take: BATCH_SIZE,
    orderBy: { updatedAt: "asc" },
  });

  let scanned = 0;
  let escalated = 0;

  for (const domain of domains) {
    try {
      const result = await sampleDomainHealth(domain);
      scanned += 1;

      const history = await prisma.domainHealthSample.findMany({
        where: { domainId: domain.id },
        orderBy: { observedAt: "desc" },
        select: { outcome: true },
        take: CONSECUTIVE_FAILS_TO_ESCALATE,
      });
      const severity = decideEscalation({
        current: result.outcome,
        recent: history.map((h) => h.outcome),
      });
      if (severity) {
        await escalate({ domain, outcome: result.outcome, severity });
        escalated += 1;
      }
    } catch (err) {
      console.error(`[domain-health] scan errored for ${domain.id}:`, err);
    }
  }

  // Prune old samples so the table doesn't grow unbounded.
  try {
    const cutoff = new Date(Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000);
    await prisma.domainHealthSample.deleteMany({
      where: { observedAt: { lt: cutoff } },
    });
  } catch (err) {
    console.error("[domain-health] sample prune failed:", err);
  }

  return { scanned, escalated };
}

export function startDomainHealthWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void scanDomainHealth().catch((err) => {
      console.error("[domain-health] scan failed:", err);
    });
  }, SCAN_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  // First scan kicks off shortly after boot, not blocking startup.
  void scanDomainHealth().catch((err) => {
    console.error("[domain-health] initial scan failed:", err);
  });
}

export function stopDomainHealthWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ----------------------------------------------------------------------------
// Read API helpers.
// ----------------------------------------------------------------------------

export interface DomainHealthRow {
  domainId: string;
  domain: string;
  status: DomainStatus;
  partnerTenantId: string | null;
  tenantId: string;
  lastOutcome: DomainHealthOutcome | null;
  lastObservedAt: Date | null;
  failingStreak: number;
  recent: Array<{ outcome: DomainHealthOutcome; observedAt: Date; error: string | null }>;
}

/**
 * Snapshot of every domain owned by a partner — its current status, the
 * last sample's outcome, and a small recent-history slice for the UI.
 */
export async function listPartnerDomainHealth(args: {
  partnerTenantId: string;
  limit?: number;
}): Promise<DomainHealthRow[]> {
  const domains = await prisma.domain.findMany({
    where: { partnerTenantId: args.partnerTenantId },
    select: {
      id: true,
      domain: true,
      status: true,
      tenantId: true,
      partnerTenantId: true,
      healthSamples: {
        orderBy: { observedAt: "desc" },
        take: 10,
        select: { outcome: true, observedAt: true, error: true },
      },
    },
    take: args.limit ?? 200,
    orderBy: { createdAt: "desc" },
  });

  return domains.map((d) => {
    const recent = d.healthSamples;
    let streak = 0;
    for (const s of recent) {
      if (s.outcome === DomainHealthOutcome.OK) break;
      streak += 1;
    }
    return {
      domainId: d.id,
      domain: d.domain,
      status: d.status,
      partnerTenantId: d.partnerTenantId,
      tenantId: d.tenantId,
      lastOutcome: recent[0]?.outcome ?? null,
      lastObservedAt: recent[0]?.observedAt ?? null,
      failingStreak: streak,
      recent,
    };
  });
}
