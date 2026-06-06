import { prisma, CallDirection, CallStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// Calling — call-log service (Complete Planning PDF §2.21, Phase 11).
// Tenant-scoped call records with optional recording / transcript / AI
// summary. Pure helpers (duration formatting, summary drafting, safe view)
// are unit-tested; live placement + transcription via a telephony provider
// land in later slices.
// =====================================================================

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

/** Format a duration in seconds as m:ss or h:mm:ss. */
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface SummaryInput {
  direction: CallDirection;
  status: CallStatus;
  durationSeconds: number;
  party?: string; // contact label or the other number
  transcript?: string | null;
}

/** Deterministic one-line call summary (AI enhancement is a follow-up). */
export function buildCallSummary(input: SummaryInput): string {
  const who = input.party?.trim() || "unknown number";
  const dir = input.direction === CallDirection.INBOUND ? "Inbound call from" : "Outbound call to";
  const dur = formatCallDuration(input.durationSeconds);
  const status = input.status.toLowerCase().replace(/_/g, " ");
  const base = `${dir} ${who} — ${dur}, ${status}.`;
  const t = input.transcript?.trim();
  if (!t) return base;
  const firstLine = t.split(/\n|\.\s/)[0].trim().slice(0, 200);
  return `${base} ${firstLine}${firstLine.endsWith(".") ? "" : "."}`;
}

interface CallRow {
  id: string;
  tenantId: string;
  contactId: string | null;
  direction: CallDirection;
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  durationSeconds: number;
  recordingUrl: string | null;
  transcript: string | null;
  aiSummary: string | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeCallLog(row: CallRow) {
  return {
    id: row.id,
    contactId: row.contactId,
    direction: row.direction,
    status: row.status,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    durationSeconds: row.durationSeconds,
    durationLabel: formatCallDuration(row.durationSeconds),
    recordingUrl: row.recordingUrl,
    transcript: row.transcript,
    aiSummary: row.aiSummary,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export interface ListCallsFilter {
  contactId?: string;
  direction?: CallDirection;
}

export async function listCalls(tenantId: string, filter: ListCallsFilter = {}) {
  const rows = await prisma.callLog.findMany({
    where: {
      tenantId,
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.direction ? { direction: filter.direction } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toSafeCallLog);
}

export interface LogCallInput {
  direction: CallDirection;
  status?: CallStatus;
  fromNumber: string;
  toNumber: string;
  contactId?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcript?: string;
  startedAt?: string | Date;
  createdByUserId?: string;
}

export async function logCall(tenantId: string, input: LogCallInput) {
  if (!input.fromNumber.trim() || !input.toNumber.trim()) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "from and to numbers are required.");
  }
  const status = input.status ?? CallStatus.COMPLETED;
  const durationSeconds = Math.max(0, Math.trunc(input.durationSeconds ?? 0));
  const party = input.direction === CallDirection.INBOUND ? input.fromNumber : input.toNumber;
  const aiSummary = input.transcript
    ? buildCallSummary({ direction: input.direction, status, durationSeconds, party, transcript: input.transcript })
    : null;

  const row = await prisma.callLog.create({
    data: {
      tenantId,
      direction: input.direction,
      status,
      fromNumber: input.fromNumber.trim(),
      toNumber: input.toNumber.trim(),
      contactId: input.contactId ?? null,
      durationSeconds,
      recordingUrl: input.recordingUrl ?? null,
      transcript: input.transcript ?? null,
      aiSummary,
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeCallLog(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.callLog.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Call log not found.");
  return row;
}

export async function getCall(tenantId: string, id: string) {
  return toSafeCallLog(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateCallInput {
  status?: CallStatus;
  transcript?: string | null;
  aiSummary?: string | null;
  recordingUrl?: string | null;
}

export async function updateCall(tenantId: string, id: string, input: UpdateCallInput) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.callLog.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
      ...(input.aiSummary !== undefined ? { aiSummary: input.aiSummary } : {}),
      ...(input.recordingUrl !== undefined ? { recordingUrl: input.recordingUrl } : {}),
    },
  });
  return toSafeCallLog(row);
}

/** Regenerate the deterministic AI summary from the stored call + transcript. */
export async function regenerateSummary(tenantId: string, id: string) {
  const row = await findOwnedOrThrow(tenantId, id);
  const party = row.direction === CallDirection.INBOUND ? row.fromNumber : row.toNumber;
  const aiSummary = buildCallSummary({
    direction: row.direction,
    status: row.status,
    durationSeconds: row.durationSeconds,
    party,
    transcript: row.transcript,
  });
  const updated = await prisma.callLog.update({ where: { id }, data: { aiSummary } });
  return toSafeCallLog(updated);
}

export async function deleteCall(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.callLog.delete({ where: { id } });
}
