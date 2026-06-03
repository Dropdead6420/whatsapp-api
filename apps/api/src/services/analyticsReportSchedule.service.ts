import { Worker } from "bullmq";
import {
  AnalyticsReportFormat,
  AnalyticsReportFrequency,
  AnalyticsReportScope,
  AnalyticsReportStatus,
  prisma,
  type AnalyticsReportSchedule,
} from "@nexaflow/db";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import {
  analyticsSummaryToCsvRows,
  csvRowsToString,
} from "./analyticsExport.service";
import { analyticsSummaryToPdf } from "./analyticsPdf.service";
import { getPlatformSummary, getTenantSummary } from "./analyticsSummary.service";
import { sendEmail } from "./email.service";
import {
  getAnalyticsReportQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type AnalyticsReportJobData,
} from "../lib/queue";

const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const SCAN_JOB_NAME = "scan";
const MAX_DUE_PER_SCAN = 25;
const RUN_AT_HOUR_UTC = 9;

let analyticsReportWorker: Worker<AnalyticsReportJobData> | null = null;

interface ReportContext {
  userRole?: UserRole;
  tenantId?: string | null;
}

interface ResolvedContext {
  scope: AnalyticsReportScope;
  tenantId: string | null;
  scheduleKey: string;
}

export interface SaveReportScheduleInput extends ReportContext {
  recipientEmail: string;
  frequency: AnalyticsReportFrequency;
  format: AnalyticsReportFormat;
  enabled: boolean;
  userId?: string | null;
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

function atReportHour(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(RUN_AT_HOUR_UTC, 0, 0, 0);
  return next;
}

export function computeNextAnalyticsReportRunAt(
  frequency: AnalyticsReportFrequency,
  from = new Date(),
): Date {
  const base = atReportHour(from);

  if (frequency === AnalyticsReportFrequency.DAILY) {
    if (base.getTime() <= from.getTime()) base.setUTCDate(base.getUTCDate() + 1);
    return base;
  }

  if (frequency === AnalyticsReportFrequency.WEEKLY) {
    const day = base.getUTCDay();
    const daysUntilMonday = (8 - day) % 7;
    base.setUTCDate(base.getUTCDate() + daysUntilMonday);
    if (base.getTime() <= from.getTime()) base.setUTCDate(base.getUTCDate() + 7);
    return base;
  }

  const monthly = atReportHour(
    new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)),
  );
  if (monthly.getTime() <= from.getTime()) {
    monthly.setUTCMonth(monthly.getUTCMonth() + 1, 1);
  }
  return monthly;
}

export function analyticsReportScheduleKey(
  scope: AnalyticsReportScope,
  tenantId: string | null,
): string {
  return scope === AnalyticsReportScope.PLATFORM
    ? "platform"
    : `tenant:${tenantId}`;
}

function resolveContext(input: ReportContext): ResolvedContext {
  if (input.userRole === UserRole.SUPER_ADMIN) {
    return {
      scope: AnalyticsReportScope.PLATFORM,
      tenantId: null,
      scheduleKey: analyticsReportScheduleKey(AnalyticsReportScope.PLATFORM, null),
    };
  }

  if (!input.tenantId) {
    throw new ApiError(
      ErrorCodes.MULTI_TENANT_VIOLATION,
      400,
      "Tenant context required for scheduled analytics reports.",
    );
  }

  return {
    scope: AnalyticsReportScope.TENANT,
    tenantId: input.tenantId,
    scheduleKey: analyticsReportScheduleKey(
      AnalyticsReportScope.TENANT,
      input.tenantId,
    ),
  };
}

function filenameFor(schedule: AnalyticsReportSchedule, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const scope =
    schedule.scope === AnalyticsReportScope.PLATFORM ? "platform" : "workspace";
  return `nexaflow-analytics-${scope}-${stamp}.${extension}`;
}

async function buildAttachment(schedule: AnalyticsReportSchedule): Promise<{
  filename: string;
  content: Buffer | string;
  contentType: string;
}> {
  const summary =
    schedule.scope === AnalyticsReportScope.PLATFORM
      ? await getPlatformSummary()
      : await getTenantSummary(schedule.tenantId!);
  const record = summary as unknown as Record<string, unknown>;

  if (schedule.format === AnalyticsReportFormat.CSV) {
    return {
      filename: filenameFor(schedule, "csv"),
      content: csvRowsToString(analyticsSummaryToCsvRows(record)),
      contentType: "text/csv; charset=utf-8",
    };
  }

  return {
    filename: filenameFor(schedule, "pdf"),
    content: analyticsSummaryToPdf(record),
    contentType: "application/pdf",
  };
}

export async function getReportScheduleForContext(input: ReportContext) {
  const context = resolveContext(input);
  return prisma.analyticsReportSchedule.findUnique({
    where: { scheduleKey: context.scheduleKey },
  });
}

export async function saveReportScheduleForContext(
  input: SaveReportScheduleInput,
) {
  const context = resolveContext(input);
  const nextRunAt = computeNextAnalyticsReportRunAt(input.frequency);

  return prisma.analyticsReportSchedule.upsert({
    where: { scheduleKey: context.scheduleKey },
    create: {
      scheduleKey: context.scheduleKey,
      scope: context.scope,
      tenantId: context.tenantId,
      recipientEmail: input.recipientEmail,
      frequency: input.frequency,
      format: input.format,
      enabled: input.enabled,
      nextRunAt,
      createdByUserId: input.userId ?? null,
      updatedByUserId: input.userId ?? null,
    },
    update: {
      recipientEmail: input.recipientEmail,
      frequency: input.frequency,
      format: input.format,
      enabled: input.enabled,
      nextRunAt,
      updatedByUserId: input.userId ?? null,
    },
  });
}

async function sendReportSchedule(schedule: AnalyticsReportSchedule) {
  const now = new Date();
  try {
    const attachment = await buildAttachment(schedule);
    const scopeLabel =
      schedule.scope === AnalyticsReportScope.PLATFORM ? "platform" : "workspace";
    await sendEmail({
      tenantId: schedule.tenantId ?? undefined,
      to: schedule.recipientEmail,
      subject: `NexaFlow ${scopeLabel} analytics report`,
      text: `Your scheduled NexaFlow ${scopeLabel} analytics report is attached.\n\nFrequency: ${schedule.frequency}\nFormat: ${schedule.format}`,
      attachments: [attachment],
    });

    return prisma.analyticsReportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastSentAt: now,
        lastStatus: AnalyticsReportStatus.SENT,
        lastError: null,
        nextRunAt: computeNextAnalyticsReportRunAt(schedule.frequency, now),
      },
    });
  } catch (error) {
    await prisma.analyticsReportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastStatus: AnalyticsReportStatus.FAILED,
        lastError: truncateError(error),
        nextRunAt: computeNextAnalyticsReportRunAt(schedule.frequency, now),
      },
    });
    throw error;
  }
}

async function sendScheduleById(
  scheduleId: string,
  opts: { onlyIfDue?: boolean } = {},
) {
  if (opts.onlyIfDue) {
    const claimedUntil = new Date(Date.now() + SCAN_INTERVAL_MS);
    const claim = await prisma.analyticsReportSchedule.updateMany({
      where: {
        id: scheduleId,
        enabled: true,
        nextRunAt: { lte: new Date() },
      },
      data: { nextRunAt: claimedUntil },
    });
    if (claim.count === 0) return { skipped: true };
  }

  const schedule = await prisma.analyticsReportSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Report schedule not found.");
  }
  if (!schedule.enabled && opts.onlyIfDue) return { skipped: true };
  const updated = await sendReportSchedule(schedule);
  return { skipped: false, schedule: updated };
}

export async function runReportScheduleNow(input: ReportContext) {
  const schedule = await getReportScheduleForContext(input);
  if (!schedule) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Create a report schedule before sending it now.",
    );
  }
  return sendReportSchedule(schedule);
}

export async function scanDueAnalyticsReportSchedules(limit = MAX_DUE_PER_SCAN) {
  const due = await prisma.analyticsReportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const schedule of due) {
    try {
      const result = await sendScheduleById(schedule.id, { onlyIfDue: true });
      if (result.skipped) {
        skipped += 1;
      } else {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[analytics-reports] schedule ${schedule.id} failed:`,
        truncateError(error),
      );
    }
  }

  return { scanned: due.length, sent, failed, skipped };
}

export async function startAnalyticsReportWorker(): Promise<void> {
  if (analyticsReportWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[analytics-reports] database unavailable; worker not started.");
    return;
  }

  const q = getAnalyticsReportQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[analytics-reports] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }

  analyticsReportWorker = new Worker<AnalyticsReportJobData>(
    QueueNames.ANALYTICS_REPORTS,
    async (job) => {
      if (job.data.kind === "send") {
        return sendScheduleById(job.data.scheduleId);
      }
      return scanDueAnalyticsReportSchedules();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  analyticsReportWorker.on("failed", (job, err) => {
    console.error(
      `[analytics-reports] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });
  analyticsReportWorker.on("error", (err) => {
    console.error("[analytics-reports] worker error:", err.message);
  });

  trackWorker(analyticsReportWorker);
}

export function stopAnalyticsReportWorker(): void {
  if (!analyticsReportWorker) return;
  void analyticsReportWorker.close();
  analyticsReportWorker = null;
}
