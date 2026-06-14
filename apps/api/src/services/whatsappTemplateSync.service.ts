import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, TemplateStatus } from "@nexaflow/shared";
import {
  getQueueConnection,
  getTemplateStatusSyncQueue,
  QueueNames,
  trackWorker,
  type TemplateStatusSyncJobData,
} from "../lib/queue";
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";
import { mapMetaTemplate } from "./whatsappTemplate.service";

// ===========================================================================
// Template status sync.
//
// The webhook (message_template_status_update) is the primary path for keeping
// local template statuses in step with Meta. This module provides the pull
// counterpart: a reusable per-tenant sync (used by the manual "Sync Templates"
// button) plus a scheduled fallback sweep that re-pulls statuses for any
// tenant still waiting on review — so a missed/never-delivered webhook can't
// leave a template stuck in SUBMITTED forever.
// ===========================================================================

const META_GRAPH_BASE =
  process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0";
const SWEEP_INTERVAL_MS = Number(
  process.env.TEMPLATE_STATUS_SYNC_INTERVAL_MS ?? `${12 * 60 * 60 * 1000}`,
); // every 12h by default
const SWEEP_JOB_NAME = "sweep";

export interface TemplateSyncResult {
  synced: number;
  created: number;
  updated: number;
}

/**
 * Pull the tenant's message templates from Meta and upsert them locally
 * (by name + language). Throws ApiError when the WABA isn't connected or Meta
 * rejects the call. Shared by the manual sync route and the scheduled sweep.
 */
export async function syncTemplatesFromMeta(tenantId: string): Promise<TemplateSyncResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { wabaId: true, wabaAccessToken: true },
  });
  if (!tenant?.wabaId || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Connect your WhatsApp Business account (WABA ID + access token) before syncing templates.",
    );
  }
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "WhatsApp access token failed to decrypt.");
  }

  const fields = "name,language,category,status,components";
  const url = `${META_GRAPH_BASE}/${tenant.wabaId}/message_templates?limit=200&fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: unknown[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      502,
      payload.error?.message ?? `Meta Graph API returned HTTP ${response.status}.`,
    );
  }

  const metaTemplates = Array.isArray(payload.data) ? payload.data : [];
  let created = 0;
  let updated = 0;
  for (const mt of metaTemplates) {
    const m = mapMetaTemplate(mt);
    if (!m.name || !m.bodyText) continue;
    const fieldsToWrite = {
      category: m.category,
      templateType: m.templateType,
      language: m.language,
      headerType: m.headerType,
      headerText: m.headerText,
      headerMediaUrl: m.headerMediaUrl,
      bodyText: m.bodyText,
      footerText: m.footerText,
      buttons: m.buttons.length ? (m.buttons as unknown as object) : undefined,
      status: m.status as TemplateStatus,
    };
    const existing = await prisma.whatsAppTemplate.findFirst({
      where: { tenantId, name: m.name, language: m.language },
    });
    if (existing) {
      await prisma.whatsAppTemplate.update({ where: { id: existing.id }, data: fieldsToWrite });
      updated += 1;
    } else {
      await prisma.whatsAppTemplate.create({
        data: { tenantId, name: m.name, variants: [], ...fieldsToWrite },
      });
      created += 1;
    }
  }
  return { synced: metaTemplates.length, created, updated };
}

export interface SweepResult {
  tenants: number;
  synced: number;
}

/**
 * Re-pull statuses for every tenant that still has a template awaiting review
 * (status SUBMITTED) and has a connected WABA. Best-effort: a failure for one
 * tenant is logged and skipped so the rest still sync.
 */
export async function sweepPendingTemplateStatuses(): Promise<SweepResult> {
  const pending = await prisma.whatsAppTemplate.findMany({
    where: { status: TemplateStatus.SUBMITTED },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 500,
  });
  const tenantIds = pending.map((p) => p.tenantId);
  if (tenantIds.length === 0) return { tenants: 0, synced: 0 };

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds }, wabaId: { not: null }, wabaAccessToken: { not: null } },
    select: { id: true },
  });

  let synced = 0;
  for (const t of tenants) {
    try {
      const r = await syncTemplatesFromMeta(t.id);
      synced += r.created + r.updated;
    } catch (err) {
      console.warn(`[template-status-sync] tenant ${t.id} failed:`, (err as Error).message);
    }
  }
  return { tenants: tenants.length, synced };
}

let templateStatusSyncWorker: Worker<TemplateStatusSyncJobData> | null = null;

export async function startTemplateStatusSyncWorker(): Promise<void> {
  if (templateStatusSyncWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn("[template-status-sync] database unavailable; worker not started.");
    return;
  }

  const q = getTemplateStatusSyncQueue();
  try {
    await q.removeJobScheduler(SWEEP_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SWEEP_JOB_NAME,
      { every: SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
    );
  } catch (err) {
    console.warn(
      "[template-status-sync] could not register sweep scheduler:",
      (err as Error).message,
    );
    return;
  }

  templateStatusSyncWorker = new Worker<TemplateStatusSyncJobData>(
    QueueNames.TEMPLATE_STATUS_SYNC,
    async () => {
      const result = await sweepPendingTemplateStatuses();
      if (result.tenants) {
        console.log(
          `[template-status-sync] sweep complete — tenants=${result.tenants} synced=${result.synced}`,
        );
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  templateStatusSyncWorker.on("failed", (job, err) => {
    console.error(`[template-status-sync] job ${job?.id} failed:`, err?.message);
  });
  templateStatusSyncWorker.on("error", (err) => {
    console.error("[template-status-sync] worker error:", err.message);
  });

  trackWorker(templateStatusSyncWorker);
}

export function stopTemplateStatusSyncWorker(): void {
  if (templateStatusSyncWorker) {
    void templateStatusSyncWorker.close();
    templateStatusSyncWorker = null;
  }
}
