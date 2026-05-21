import {
  AnalyticsReportFrequency,
  AnalyticsReportType,
  LeadStatus,
  prisma,
  prismaRead,
} from "@nexaflow/db";
import { Worker } from "bullmq";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  getAnalyticsReportQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type AnalyticsReportJobData,
} from "../lib/queue";
import { sendEmail } from "./email.service";

type Scalar = string | number | boolean | null;

export interface ReportSnapshot {
  generatedAt: string;
  type: AnalyticsReportType;
  range: {
    from: string;
    to: string;
    rangeDays: number;
  };
  summary: Record<string, Scalar>;
  rows: Array<Record<string, Scalar>>;
}

interface ReportFilters {
  rangeDays: number;
}

interface AnalyticsReportRecord {
  id: string;
  tenantId: string;
  name: string;
  type: AnalyticsReportType;
  frequency: AnalyticsReportFrequency;
  recipients: string[];
  filters: string | null;
  nextRunAt: Date | null;
}

function parseFilters(raw: string | null | undefined): ReportFilters {
  if (!raw) return { rangeDays: 30 };
  try {
    const parsed = JSON.parse(raw) as { rangeDays?: unknown };
    const rangeDays =
      typeof parsed.rangeDays === "number" && Number.isFinite(parsed.rangeDays)
        ? Math.floor(parsed.rangeDays)
        : 30;
    return { rangeDays: Math.max(1, Math.min(365, rangeDays)) };
  } catch {
    return { rangeDays: 30 };
  }
}

function rangeFromFilters(filters: ReportFilters): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - filters.rangeDays + 1);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function computeNextReportRun(
  frequency: AnalyticsReportFrequency,
  from: Date = new Date(),
): Date | null {
  if (frequency === AnalyticsReportFrequency.NONE) return null;
  const next = new Date(from);
  if (frequency === AnalyticsReportFrequency.DAILY) {
    next.setDate(next.getDate() + 1);
  } else if (frequency === AnalyticsReportFrequency.WEEKLY) {
    next.setDate(next.getDate() + 7);
  } else if (frequency === AnalyticsReportFrequency.MONTHLY) {
    next.setMonth(next.getMonth() + 1);
  }
  next.setHours(8, 0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setTime(from.getTime() + 60 * 60 * 1000);
  }
  return next;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function aggregateCount(row: {
  _count?: true | { _all?: number | null } | null;
}): number {
  return typeof row._count === "object" && row._count
    ? row._count._all ?? 0
    : 0;
}

async function buildCampaignPerformanceReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Pick<ReportSnapshot, "summary" | "rows">> {
  const campaigns = await prismaRead.campaign.findMany({
    where: { tenantId, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: "desc" },
    select: {
      name: true,
      status: true,
      totalContacts: true,
      sentCount: true,
      deliveredCount: true,
      readCount: true,
      clickCount: true,
      conversionCount: true,
      createdAt: true,
    },
    take: 1000,
  });

  const totals = campaigns.reduce(
    (acc, campaign) => ({
      totalContacts: acc.totalContacts + campaign.totalContacts,
      sent: acc.sent + campaign.sentCount,
      delivered: acc.delivered + campaign.deliveredCount,
      read: acc.read + campaign.readCount,
      clicks: acc.clicks + campaign.clickCount,
      conversions: acc.conversions + campaign.conversionCount,
    }),
    { totalContacts: 0, sent: 0, delivered: 0, read: 0, clicks: 0, conversions: 0 },
  );

  return {
    summary: {
      campaigns: campaigns.length,
      sent: totals.sent,
      delivered: totals.delivered,
      read: totals.read,
      deliveryRate: pct(totals.delivered, totals.sent),
      readRate: pct(totals.read, totals.delivered),
      conversionRate: pct(totals.conversions, totals.sent),
    },
    rows: campaigns.map((campaign) => ({
      name: campaign.name,
      status: campaign.status,
      totalContacts: campaign.totalContacts,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      read: campaign.readCount,
      clicks: campaign.clickCount,
      conversions: campaign.conversionCount,
      deliveryRate: pct(campaign.deliveredCount, campaign.sentCount),
      readRate: pct(campaign.readCount, campaign.deliveredCount),
      createdAt: campaign.createdAt.toISOString(),
    })),
  };
}

async function buildLeadFunnelReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Pick<ReportSnapshot, "summary" | "rows">> {
  const [groups, wonValue, openValue] = await prismaRead.$transaction([
    prismaRead.lead.groupBy({
      by: ["status"],
      where: { tenantId, createdAt: { gte: from, lte: to } },
      orderBy: { status: "asc" },
      _count: { _all: true },
      _sum: { value: true },
      _avg: { probability: true },
    }),
    prismaRead.lead.aggregate({
      where: {
        tenantId,
        status: LeadStatus.CLOSED_WON,
        closedWonAt: { gte: from, lte: to },
      },
      _sum: { value: true },
    }),
    prismaRead.lead.aggregate({
      where: {
        tenantId,
        status: {
          in: [
            LeadStatus.NEW,
            LeadStatus.QUALIFIED,
            LeadStatus.NEGOTIATION,
            LeadStatus.PROPOSAL_SENT,
            LeadStatus.NEGOTIATION_FAILED,
          ],
        },
      },
      _sum: { value: true },
    }),
  ]);

  const byStatus = new Map(groups.map((group) => [group.status, group]));
  const rows = Object.values(LeadStatus).map((status) => {
    const row = byStatus.get(status);
    return {
      status,
      count: row ? aggregateCount(row) : 0,
      value: row?._sum?.value ?? 0,
      avgProbability: Math.round(((row?._avg?.probability ?? 0) as number) * 1000) / 10,
    };
  });
  const totalLeads = rows.reduce((sum, row) => sum + Number(row.count), 0);
  const won = Number(rows.find((row) => row.status === LeadStatus.CLOSED_WON)?.count ?? 0);

  return {
    summary: {
      leads: totalLeads,
      closedWon: won,
      winRate: pct(won, totalLeads),
      wonValue: wonValue._sum.value ?? 0,
      openPipelineValue: openValue._sum.value ?? 0,
    },
    rows,
  };
}

async function buildContactGrowthReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Pick<ReportSnapshot, "summary" | "rows">> {
  const [contacts, lifecycleGroups, optedOut] = await prismaRead.$transaction([
    prismaRead.contact.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    }),
    prismaRead.contact.groupBy({
      by: ["lifecycleStage"],
      where: { tenantId },
      orderBy: { lifecycleStage: "asc" },
      _count: { _all: true },
    }),
    prismaRead.contact.count({ where: { tenantId, optedOut: true } }),
  ]);

  const byDay = new Map<string, number>();
  for (const contact of contacts) {
    const day = contact.createdAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  let cumulative = 0;
  const rows = Array.from(byDay.entries()).map(([date, created]) => {
    cumulative += created;
    return { date, created, cumulative };
  });
  const totalByLifecycle = lifecycleGroups.reduce(
    (acc, group) => acc + aggregateCount(group),
    0,
  );

  return {
    summary: {
      newContacts: contacts.length,
      totalContacts: totalByLifecycle,
      optedOut,
      optOutRate: pct(optedOut, totalByLifecycle),
    },
    rows:
      rows.length > 0
        ? rows
        : [{ date: from.toISOString().slice(0, 10), created: 0, cumulative: 0 }],
  };
}

async function buildAiUsageReport(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Pick<ReportSnapshot, "summary" | "rows">> {
  const rows = await prismaRead.aiUsage.groupBy({
    by: ["feature", "model"],
    where: { tenantId, createdAt: { gte: from, lte: to } },
    _sum: { inputTokens: true, outputTokens: true, costInCents: true },
    _count: { _all: true },
    orderBy: [{ feature: "asc" }, { model: "asc" }],
  });

  const normalized = rows.map((row) => ({
    feature: row.feature,
    model: row.model,
    calls: row._count._all,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    costInCents: row._sum.costInCents ?? 0,
  }));

  return {
    summary: {
      calls: normalized.reduce((sum, row) => sum + row.calls, 0),
      inputTokens: normalized.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: normalized.reduce((sum, row) => sum + row.outputTokens, 0),
      costInCents: normalized.reduce((sum, row) => sum + row.costInCents, 0),
    },
    rows: normalized,
  };
}

export async function buildAnalyticsReportSnapshot(input: {
  tenantId: string;
  type: AnalyticsReportType;
  filters?: string | null;
}): Promise<ReportSnapshot> {
  const filters = parseFilters(input.filters);
  const { from, to } = rangeFromFilters(filters);
  let data: Pick<ReportSnapshot, "summary" | "rows">;

  if (input.type === AnalyticsReportType.CAMPAIGN_PERFORMANCE) {
    data = await buildCampaignPerformanceReport(input.tenantId, from, to);
  } else if (input.type === AnalyticsReportType.LEAD_FUNNEL) {
    data = await buildLeadFunnelReport(input.tenantId, from, to);
  } else if (input.type === AnalyticsReportType.CONTACT_GROWTH) {
    data = await buildContactGrowthReport(input.tenantId, from, to);
  } else if (input.type === AnalyticsReportType.AI_USAGE) {
    data = await buildAiUsageReport(input.tenantId, from, to);
  } else {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Unsupported report type.");
  }

  return {
    generatedAt: new Date().toISOString(),
    type: input.type,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      rangeDays: filters.rangeDays,
    },
    ...data,
  };
}

function csvEscape(value: Scalar): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function analyticsReportToCsv(snapshot: ReportSnapshot): string {
  const lines = [
    ["reportType", snapshot.type],
    ["generatedAt", snapshot.generatedAt],
    ["from", snapshot.range.from],
    ["to", snapshot.range.to],
    ["rangeDays", snapshot.range.rangeDays],
    [],
    ["summaryKey", "summaryValue"],
    ...Object.entries(snapshot.summary),
    [],
  ].map((row) => row.map((value) => csvEscape(value as Scalar)).join(","));

  const headers = Array.from(
    snapshot.rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  if (headers.length > 0) {
    lines.push(headers.map((header) => csvEscape(header)).join(","));
    for (const row of snapshot.rows) {
      lines.push(headers.map((header) => csvEscape(row[header])).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

function summarizeForEmail(report: AnalyticsReportRecord, snapshot: ReportSnapshot): string {
  const summaryLines = Object.entries(snapshot.summary)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  return [
    `${report.name}`,
    `Type: ${report.type}`,
    `Range: ${snapshot.range.from.slice(0, 10)} to ${snapshot.range.to.slice(0, 10)}`,
    "",
    "Summary:",
    summaryLines || "- No data",
    "",
    "Open NexaFlow to export the detailed CSV from Reports.",
  ].join("\n");
}

export async function runAnalyticsReport(input: {
  reportId: string;
  tenantId: string;
  deliver?: boolean;
}): Promise<ReportSnapshot> {
  const report = await prisma.analyticsReport.findFirst({
    where: { id: input.reportId, tenantId: input.tenantId },
  });
  if (!report) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report not found.");
  }

  const snapshot = await buildAnalyticsReportSnapshot({
    tenantId: report.tenantId,
    type: report.type,
    filters: report.filters,
  });

  const nextRunAt = computeNextReportRun(report.frequency);
  await prisma.analyticsReport.update({
    where: { id: report.id },
    data: {
      lastRunAt: new Date(),
      nextRunAt,
      lastDeliveryStatus: input.deliver ? "PENDING" : "GENERATED",
      lastDeliveryError: null,
    },
  });

  if (input.deliver) {
    await deliverAnalyticsReport(report.id);
  }

  return snapshot;
}

export async function deliverAnalyticsReport(reportId: string): Promise<void> {
  const report = await prisma.analyticsReport.findUnique({ where: { id: reportId } });
  if (!report) return;

  const snapshot = await buildAnalyticsReportSnapshot({
    tenantId: report.tenantId,
    type: report.type,
    filters: report.filters,
  });
  const nextRunAt = computeNextReportRun(report.frequency);

  try {
    if (report.recipients.length === 0) {
      await prisma.analyticsReport.update({
        where: { id: report.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt,
          lastDeliveryStatus: "SKIPPED_NO_RECIPIENTS",
          lastDeliveryError: null,
        },
      });
      return;
    }

    const text = summarizeForEmail(report, snapshot);
    await Promise.all(
      report.recipients.map((recipient) =>
        sendEmail({
          to: recipient,
          subject: `NexaFlow report: ${report.name}`,
          text,
        }),
      ),
    );

    await prisma.analyticsReport.update({
      where: { id: report.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        lastDeliveryStatus: "SENT",
        lastDeliveryError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report delivery failed.";
    await prisma.analyticsReport.update({
      where: { id: report.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        lastDeliveryStatus: "FAILED",
        lastDeliveryError: message.slice(0, 500),
      },
    });
    throw err;
  }
}

export async function processDueAnalyticsReports(): Promise<void> {
  const reports = await prisma.analyticsReport.findMany({
    where: {
      frequency: { not: AnalyticsReportFrequency.NONE },
      nextRunAt: { lte: new Date() },
    },
    orderBy: { nextRunAt: "asc" },
    take: 25,
  });

  for (const report of reports) {
    await deliverAnalyticsReport(report.id);
  }
}

const SCAN_INTERVAL_MS = 60_000;
const SCAN_JOB_NAME = "scan";
let analyticsReportWorker: Worker<AnalyticsReportJobData> | null = null;

export async function startAnalyticsReportWorker(): Promise<void> {
  if (analyticsReportWorker) return;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.warn(
      "[analytics-report] database unavailable, worker not started:",
      (err as Error).message,
    );
    return;
  }

  const queue = getAnalyticsReportQueue();
  try {
    await queue.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await queue.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[analytics-report] could not register scan scheduler (Redis unavailable?)",
      (err as Error).message,
    );
    return;
  }

  analyticsReportWorker = new Worker<AnalyticsReportJobData>(
    QueueNames.ANALYTICS_REPORT_DELIVERY,
    async (job) => {
      if ("reportId" in job.data) {
        await deliverAnalyticsReport(job.data.reportId);
        return;
      }
      await processDueAnalyticsReports();
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  analyticsReportWorker.on("failed", (job, err) => {
    console.error(`[analytics-report] job ${job?.id} failed:`, err?.message);
  });
  analyticsReportWorker.on("error", (err) => {
    console.error("[analytics-report] worker error:", err.message);
  });

  trackWorker(analyticsReportWorker);
  console.log("[analytics-report] worker started");
}

export function stopAnalyticsReportWorker(): void {
  if (analyticsReportWorker) {
    void analyticsReportWorker.close();
    analyticsReportWorker = null;
  }
}
