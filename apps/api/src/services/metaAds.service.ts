import { Worker } from "bullmq";
import { createHash } from "node:crypto";
import {
  prisma,
  MetaAdsConnection,
  MetaAdsLeadForm,
  MetaAdsAudience,
  MetaAudienceStatus,
  LeadStatus,
  LifecycleStage,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { decryptTokenIfNeeded, encryptToken } from "../lib/tokenCrypto";
import {
  getMetaLeadSyncQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type MetaLeadSyncJobData,
} from "../lib/queue";
import { specToWhere, type SegmentFilterSpec } from "./segment.service";

// ----------------------------------------------------------------------------
// Meta Marketing API client (PRD §3.3.6, Phase 4 slice 1).
//
// One connection per tenant. Operators paste a long-lived user access token
// + ad account id today (slice 1); slice 2 will wire the proper OAuth flow
// via Meta Business Login and System Users. We store the token encrypted
// using the same envelope helper that protects the WABA token.
//
// All HTTP calls go through callMeta() so we centralize: graph version,
// timeout, auth-header injection, 400/401/403 error parsing, retry caps.
// ----------------------------------------------------------------------------

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = 15_000;

function stripActPrefix(id: string): string {
  return id.startsWith("act_") ? id.slice(4) : id;
}

interface CallOpts {
  method?: "GET" | "POST" | "DELETE";
  path: string; // starts with "/", e.g. "/me", "/act_123/campaigns"
  accessToken: string;
  query?: Record<string, string | number | undefined>;
  // Body for POST. Kept simple — slice 1 is mostly reads.
  body?: Record<string, unknown>;
}

async function callMeta<T>(opts: CallOpts): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${opts.path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("access_token", opts.accessToken);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        504,
        `Meta Graph API timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Meta Graph API request failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON response shouldn't happen for the Graph API but bail
      // out cleanly if it does.
      throw new ApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        502,
        `Meta Graph API returned non-JSON: ${text.slice(0, 200)}`,
      );
    }
  }

  if (!response.ok) {
    const graphError =
      (parsed as { error?: { message?: string; code?: number } } | null)?.error ?? null;
    const message =
      graphError?.message ?? `Meta Graph API error (HTTP ${response.status})`;
    // 401/403 means the token is invalid — surface as 401 so the UI can
    // prompt re-connect.
    const status =
      response.status === 401 || response.status === 403 ? 401 : 502;
    throw new ApiError(
      status === 401 ? ErrorCodes.UNAUTHORIZED : ErrorCodes.INTERNAL_SERVER_ERROR,
      status,
      message,
    );
  }
  return (parsed ?? {}) as T;
}

// ----------------------------------------------------------------------------
// Connection lifecycle
// ----------------------------------------------------------------------------

interface MetaAdAccountSummary {
  id: string; // "act_<numeric>"
  account_id: string; // numeric only
  name?: string;
  currency?: string;
  timezone_name?: string;
  business?: { id: string; name?: string };
}

/**
 * Validate the access token + ad account by hitting Meta's own endpoint.
 * Returns the canonical account metadata; throws ApiError on auth failure
 * or if the account isn't visible from the token.
 */
export async function validateMetaAdsToken(args: {
  accessToken: string;
  adAccountId: string;
}): Promise<MetaAdAccountSummary> {
  const cleanId = stripActPrefix(args.adAccountId);
  return callMeta<MetaAdAccountSummary>({
    path: `/act_${cleanId}`,
    accessToken: args.accessToken,
    query: {
      fields: "id,account_id,name,currency,timezone_name,business{id,name}",
    },
  });
}

/**
 * Upsert the tenant's connection. Encrypts the access token before write.
 */
export async function saveMetaAdsConnection(args: {
  tenantId: string;
  accessToken: string;
  adAccountId: string;
}): Promise<MetaAdsConnection> {
  const summary = await validateMetaAdsToken({
    accessToken: args.accessToken,
    adAccountId: args.adAccountId,
  });
  const encrypted = encryptToken(args.accessToken);
  const cleanId = stripActPrefix(args.adAccountId);

  return prisma.metaAdsConnection.upsert({
    where: { tenantId: args.tenantId },
    create: {
      tenantId: args.tenantId,
      accessToken: encrypted,
      adAccountId: cleanId,
      adAccountName: summary.name ?? null,
      businessName: summary.business?.name ?? null,
      currency: summary.currency ?? null,
      timeZoneName: summary.timezone_name ?? null,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    },
    update: {
      accessToken: encrypted,
      adAccountId: cleanId,
      adAccountName: summary.name ?? null,
      businessName: summary.business?.name ?? null,
      currency: summary.currency ?? null,
      timeZoneName: summary.timezone_name ?? null,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    },
  });
}

export async function getMetaAdsConnection(
  tenantId: string,
): Promise<MetaAdsConnection | null> {
  return prisma.metaAdsConnection.findUnique({ where: { tenantId } });
}

export async function deleteMetaAdsConnection(tenantId: string): Promise<void> {
  await prisma.metaAdsConnection.deleteMany({ where: { tenantId } });
}

/**
 * Returns the decrypted access token. Throws if no connection exists or
 * the envelope is corrupt.
 */
async function getDecryptedToken(tenantId: string): Promise<{
  token: string;
  adAccountId: string;
}> {
  const conn = await prisma.metaAdsConnection.findUnique({
    where: { tenantId },
  });
  if (!conn) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "No Meta Ads connection. Connect an ad account first.",
    );
  }
  const token = decryptTokenIfNeeded(conn.accessToken);
  if (!token) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      "Meta access token failed to decrypt.",
    );
  }
  return { token, adAccountId: conn.adAccountId };
}

// ----------------------------------------------------------------------------
// Reads — campaigns + insights
// ----------------------------------------------------------------------------

export interface MetaCampaign {
  id: string;
  name: string;
  status: string; // ACTIVE / PAUSED / DELETED / ARCHIVED
  effective_status: string;
  objective?: string;
  daily_budget?: string; // micros (string per Marketing API)
  lifetime_budget?: string; // micros
  created_time?: string;
  updated_time?: string;
}

interface CampaignListResponse {
  data: MetaCampaign[];
  paging?: { cursors?: { before?: string; after?: string } };
}

export async function listCampaigns(args: {
  tenantId: string;
  limit?: number;
}): Promise<MetaCampaign[]> {
  const { token, adAccountId } = await getDecryptedToken(args.tenantId);
  const fields =
    "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time";
  const result = await callMeta<CampaignListResponse>({
    path: `/act_${adAccountId}/campaigns`,
    accessToken: token,
    query: {
      fields,
      limit: args.limit ?? 50,
    },
  });
  // Stamp success on the connection so the UI shows when we last reached Meta.
  await prisma.metaAdsConnection.update({
    where: { tenantId: args.tenantId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
  return result.data ?? [];
}

export interface MetaCampaignInsights {
  campaign_id: string;
  date_start?: string;
  date_stop?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string; // percentage as string
  cpc?: string; // currency micros
  spend?: string; // currency micros
  reach?: string;
  frequency?: string;
  unique_clicks?: string;
}

export async function getCampaignInsights(args: {
  tenantId: string;
  campaignId: string;
  datePreset?:
    | "today"
    | "yesterday"
    | "last_7d"
    | "last_14d"
    | "last_28d"
    | "last_30d"
    | "this_month"
    | "last_month";
}): Promise<MetaCampaignInsights | null> {
  const { token } = await getDecryptedToken(args.tenantId);
  const fields =
    "impressions,clicks,ctr,cpc,spend,reach,frequency,unique_clicks,date_start,date_stop";
  const result = await callMeta<{ data: MetaCampaignInsights[] }>({
    path: `/${args.campaignId}/insights`,
    accessToken: token,
    query: {
      fields,
      date_preset: args.datePreset ?? "last_7d",
    },
  });
  const row = result.data?.[0];
  if (!row) return null;
  return { ...row, campaign_id: args.campaignId };
}

/**
 * Bulk-fetch insights for the campaigns we just listed so the UI doesn't
 * have to round-trip the server N times. Insights API returns one row per
 * campaign for the given preset.
 */
export async function getAccountInsightsByCampaign(args: {
  tenantId: string;
  datePreset?: "today" | "yesterday" | "last_7d" | "last_28d" | "this_month";
}): Promise<Record<string, MetaCampaignInsights>> {
  const { token, adAccountId } = await getDecryptedToken(args.tenantId);
  const fields =
    "campaign_id,impressions,clicks,ctr,cpc,spend,reach,frequency,unique_clicks,date_start,date_stop";
  const result = await callMeta<{ data: MetaCampaignInsights[] }>({
    path: `/act_${adAccountId}/insights`,
    accessToken: token,
    query: {
      fields,
      level: "campaign",
      date_preset: args.datePreset ?? "last_7d",
    },
  });
  const map: Record<string, MetaCampaignInsights> = {};
  for (const row of result.data ?? []) {
    if (row.campaign_id) {
      map[row.campaign_id] = row;
    }
  }
  return map;
}

// ----------------------------------------------------------------------------
// Lead Ads → CRM auto-sync (PRD §3.3.6 slice 2).
//
// Flow:
//   1. discoverLeadForms() lists every leadgen_form in the connected ad
//      account so operators can pick which to subscribe to. We pull form
//      id + name + owning page so the UI can disambiguate identically-
//      named forms across multiple FB pages.
//   2. subscribeLeadForm() upserts a MetaAdsLeadForm row.
//   3. The scan worker hits every active form's /<form_id>/leads endpoint
//      every few minutes, filtering on time_created > lastFetchedAt to
//      avoid re-importing the same entries.
//   4. importLead() maps the form's field_data to Contact fields and
//      creates a Contact + Lead in NexaFlow.
//
// Failure handling is per-form: one broken form (expired permission,
// deleted form) must not stop other forms in the same tenant. We persist
// `lastFetchError` so operators can see why an individual form stopped
// importing.
// ----------------------------------------------------------------------------

export interface MetaLeadForm {
  id: string;
  name?: string;
  status?: string;
  page?: { id: string; name?: string };
  created_time?: string;
}

interface PagedListResponse<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

/**
 * Discover every leadgen_form attached to the ad account's pages. Meta
 * returns forms scoped to whichever pages the access token can read; we
 * pass-through whatever it returns.
 */
export async function discoverLeadForms(
  tenantId: string,
): Promise<MetaLeadForm[]> {
  const { token, adAccountId } = await getDecryptedToken(tenantId);

  // Marketing API doesn't expose a single "all forms in this ad account"
  // endpoint — leadgen_forms live on Pages. So we first enumerate the
  // ad account's owned pages and then fan out one /<page>/leadgen_forms
  // call per page. Bounded to the first 25 pages to keep the latency
  // reasonable; most tenants have <5.
  type PageRow = { id: string; name?: string };
  const pagesResp = await callMeta<PagedListResponse<PageRow>>({
    path: `/act_${adAccountId}/promote_pages`,
    accessToken: token,
    query: { fields: "id,name", limit: 25 },
  });
  const pages = pagesResp.data ?? [];

  const collected: MetaLeadForm[] = [];
  for (const page of pages) {
    try {
      const formsResp = await callMeta<PagedListResponse<MetaLeadForm>>({
        path: `/${page.id}/leadgen_forms`,
        accessToken: token,
        query: { fields: "id,name,status,created_time", limit: 50 },
      });
      for (const f of formsResp.data ?? []) {
        collected.push({
          ...f,
          page: { id: page.id, name: page.name },
        });
      }
    } catch (err) {
      // Skip pages the token can't read — common for shared agency setups
      // where the page-token didn't get the leadgen permission.
      console.warn(
        `[meta-ads] discover skipping page ${page.id}:`,
        (err as Error).message,
      );
    }
  }
  return collected;
}

export interface SubscribeLeadFormInput {
  tenantId: string;
  formId: string;
  formName?: string;
  pageId?: string;
  pageName?: string;
  importTag?: string;
}

export async function subscribeLeadForm(
  input: SubscribeLeadFormInput,
): Promise<MetaAdsLeadForm> {
  // Sanity check — operator must already have a connection before they
  // can subscribe to a form.
  const conn = await getMetaAdsConnection(input.tenantId);
  if (!conn) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Connect a Meta Ads account before subscribing to lead forms.",
    );
  }
  return prisma.metaAdsLeadForm.upsert({
    where: {
      tenantId_formId: {
        tenantId: input.tenantId,
        formId: input.formId,
      },
    },
    create: {
      tenantId: input.tenantId,
      formId: input.formId,
      formName: input.formName ?? null,
      pageId: input.pageId ?? null,
      pageName: input.pageName ?? null,
      importTag: input.importTag?.trim() || null,
      isActive: true,
    },
    update: {
      formName: input.formName ?? null,
      pageId: input.pageId ?? null,
      pageName: input.pageName ?? null,
      importTag: input.importTag?.trim() || null,
      isActive: true,
      lastFetchError: null,
    },
  });
}

export async function listSubscribedLeadForms(
  tenantId: string,
): Promise<MetaAdsLeadForm[]> {
  return prisma.metaAdsLeadForm.findMany({
    where: { tenantId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
}

export async function unsubscribeLeadForm(args: {
  tenantId: string;
  id: string;
}): Promise<void> {
  await prisma.metaAdsLeadForm.deleteMany({
    where: { id: args.id, tenantId: args.tenantId },
  });
}

// ----------------------------------------------------------------------------
// Lead → Contact mapping
// ----------------------------------------------------------------------------

interface MetaFieldDatum {
  name: string;
  values: string[];
}

interface MetaLead {
  id: string;
  created_time: string;
  field_data: MetaFieldDatum[];
}

/**
 * Best-effort mapper from Meta's free-form `name` field labels to our
 * Contact columns. Meta's default fields use predictable names
 * (full_name, phone_number, email, ...) but operators can rename them at
 * form-build time, so we match on common patterns rather than exact equals.
 */
function extractContactFields(fields: MetaFieldDatum[]): {
  name: string | null;
  phoneNumber: string | null;
  email: string | null;
  raw: Record<string, string>;
} {
  const raw: Record<string, string> = {};
  for (const f of fields) {
    const value = (f.values?.[0] ?? "").trim();
    if (value) raw[f.name] = value;
  }
  const lowerKeys = Object.keys(raw).reduce<Record<string, string>>(
    (acc, k) => {
      acc[k.toLowerCase()] = raw[k];
      return acc;
    },
    {},
  );

  const findFirst = (...patterns: string[]): string | null => {
    for (const key of Object.keys(lowerKeys)) {
      if (patterns.some((p) => key.includes(p))) return lowerKeys[key];
    }
    return null;
  };

  const phoneNumber = findFirst("phone", "mobile", "whatsapp");
  const email = findFirst("email");
  const fullName =
    findFirst("full_name", "full name", "name") ??
    [findFirst("first_name", "first name"), findFirst("last_name", "last name")]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    name: fullName || null,
    phoneNumber: phoneNumber || null,
    email: email || null,
    raw,
  };
}

function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{7,15}$/.test(digits) ? digits : null;
  }
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : null;
}

async function importLead(args: {
  tenantId: string;
  form: MetaAdsLeadForm;
  metaLead: MetaLead;
}): Promise<"created" | "merged" | "skipped"> {
  const extracted = extractContactFields(args.metaLead.field_data);
  const normalizedPhone = extracted.phoneNumber
    ? normalizePhone(extracted.phoneNumber)
    : null;
  // Without a phone we can't message the lead via WhatsApp later, so skip
  // and let the operator see the form's importedCount stay flat. Slice 3
  // can offer an email-only fallback if there's demand.
  if (!normalizedPhone) return "skipped";

  const importTag = args.form.importTag?.trim();
  const tagsToAdd = importTag ? [importTag] : [];

  // Upsert contact. If a contact with this phone exists in the tenant, we
  // merge tags + refresh name/email rather than create a duplicate.
  const existing = await prisma.contact.findUnique({
    where: {
      tenantId_phoneNumber: {
        tenantId: args.tenantId,
        phoneNumber: normalizedPhone,
      },
    },
    select: { id: true, tags: true, name: true, email: true },
  });

  let contactId: string;
  let outcome: "created" | "merged";
  if (existing) {
    const mergedTags = Array.from(
      new Set([...(existing.tags ?? []), ...tagsToAdd]),
    );
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        tags: mergedTags,
        name: existing.name || extracted.name || existing.name,
        email: existing.email || extracted.email,
      },
    });
    contactId = existing.id;
    outcome = "merged";
  } else {
    const created = await prisma.contact.create({
      data: {
        tenantId: args.tenantId,
        phoneNumber: normalizedPhone,
        name: extracted.name ?? "Meta Lead",
        email: extracted.email ?? null,
        tags: tagsToAdd,
        lifecycleStage: LifecycleStage.LEAD,
      },
      select: { id: true },
    });
    contactId = created.id;
    outcome = "created";
  }

  // Always create a Lead row pointing at this contact so the pipeline
  // surfaces the new entry. Use the Meta lead id in the title so operators
  // can correlate with the Meta UI.
  await prisma.lead.create({
    data: {
      tenantId: args.tenantId,
      contactId,
      title: `Meta Lead Ad — ${args.form.formName ?? args.form.formId}`,
      description: `Source: Meta Lead Ad form ${args.form.formId} (Meta lead id ${args.metaLead.id})`,
      status: LeadStatus.NEW,
    },
  });

  return outcome;
}

// ----------------------------------------------------------------------------
// Polling worker
// ----------------------------------------------------------------------------

interface SyncResult {
  fetched: number;
  imported: number;
  merged: number;
  skipped: number;
}

async function syncOneForm(form: MetaAdsLeadForm): Promise<SyncResult> {
  const { token } = await getDecryptedToken(form.tenantId);

  // Meta's filtering operator wants a unix-second timestamp.
  const since = form.lastFetchedAt
    ? Math.floor(form.lastFetchedAt.getTime() / 1000)
    : 0;

  const result = await callMeta<PagedListResponse<MetaLead>>({
    path: `/${form.formId}/leads`,
    accessToken: token,
    query: {
      fields: "id,created_time,field_data",
      limit: 50,
      ...(since > 0 && {
        filtering: JSON.stringify([
          { field: "time_created", operator: "GREATER_THAN", value: since },
        ]),
      }),
    },
  });

  const leads = result.data ?? [];
  let imported = 0;
  let merged = 0;
  let skipped = 0;
  for (const m of leads) {
    try {
      const outcome = await importLead({
        tenantId: form.tenantId,
        form,
        metaLead: m,
      });
      if (outcome === "created") imported += 1;
      else if (outcome === "merged") merged += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        `[meta-leadsync] form=${form.formId} lead=${m.id} import failed:`,
        (err as Error).message,
      );
    }
  }

  await prisma.metaAdsLeadForm.update({
    where: { id: form.id },
    data: {
      lastFetchedAt: new Date(),
      lastFetchError: null,
      importedCount: { increment: imported + merged },
    },
  });

  return { fetched: leads.length, imported, merged, skipped };
}

async function scanAllLeadForms(): Promise<{
  forms: number;
  imported: number;
  merged: number;
  skipped: number;
  errored: number;
}> {
  const forms = await prisma.metaAdsLeadForm.findMany({
    where: { isActive: true },
    take: 200,
  });
  let imported = 0;
  let merged = 0;
  let skipped = 0;
  let errored = 0;
  for (const form of forms) {
    try {
      const result = await syncOneForm(form);
      imported += result.imported;
      merged += result.merged;
      skipped += result.skipped;
    } catch (err) {
      errored += 1;
      const message = (err as Error).message ?? "unknown";
      await prisma.metaAdsLeadForm
        .update({
          where: { id: form.id },
          data: { lastFetchError: message },
        })
        .catch(() => undefined);
      console.warn(
        `[meta-leadsync] form=${form.formId} skipped:`,
        message,
      );
    }
  }
  return { forms: forms.length, imported, merged, skipped, errored };
}

const SCAN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SCAN_JOB_NAME = "scan";

let leadSyncWorker: Worker<MetaLeadSyncJobData> | null = null;

export async function startMetaLeadSyncWorker(): Promise<void> {
  if (leadSyncWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[meta-leadsync] database unavailable; worker not started.",
    );
    return;
  }
  const q = getMetaLeadSyncQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[meta-leadsync] could not register scan scheduler:",
      (err as Error).message,
    );
    return;
  }
  leadSyncWorker = new Worker<MetaLeadSyncJobData>(
    QueueNames.META_LEAD_SYNC,
    async (job) => {
      if (job.name !== SCAN_JOB_NAME) return { skipped: true };
      return scanAllLeadForms();
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  leadSyncWorker.on("failed", (job, err) => {
    console.error(
      `[meta-leadsync] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });
  trackWorker(leadSyncWorker);
}

export function stopMetaLeadSyncWorker(): void {
  if (!leadSyncWorker) return;
  void leadSyncWorker.close();
  leadSyncWorker = null;
}

// ----------------------------------------------------------------------------
// Custom audience export (PRD §3.3.6 retargeting).
//
// Flow:
//   1. Operator picks a contact filter (tags / opt-out / score / etc.) and
//      a friendly name. We POST /act_<id>/customaudiences with
//      customer_file_source=USER_PROVIDED_ONLY to register the audience.
//   2. We resolve the filter to a contact list, hash each phone number
//      using SHA-256(lowercase E.164 digits-only), and POST /<aud_id>/users
//      in batches with schema=["PHONE"].
//   3. Meta does the match server-side over the next 24-72h. We don't have
//      visibility into how many matched — we record uploadedCount so the
//      operator sees how many rows we sent.
//
// Refresh is the same flow without the create step: we re-resolve the
// filter (in case the contact pool grew) and upload again. Meta dedupes
// on its side so re-uploading is safe.
// ----------------------------------------------------------------------------

function parseFilterSpec(json: unknown): SegmentFilterSpec {
  if (typeof json === "string") {
    try {
      return JSON.parse(json) as SegmentFilterSpec;
    } catch {
      return {};
    }
  }
  return (json ?? {}) as SegmentFilterSpec;
}

/**
 * Hash a phone number per Meta's Customer File Schema:
 *   - strip everything except digits (drop the leading +)
 *   - SHA-256 hex, lowercased
 * Meta expects E.164 without the plus, so a raw "9876543210" is also valid;
 * if the input has a country code that's preserved.
 */
function hashPhoneForMeta(phoneNumber: string): string | null {
  const digits = phoneNumber.replace(/\D/g, "");
  if (!digits) return null;
  return createHash("sha256").update(digits).digest("hex").toLowerCase();
}

/**
 * Resolve a SegmentFilterSpec into a deduped list of E.164 phone hashes
 * suitable for /users payload. We always exclude opted-out contacts
 * regardless of the spec — exporting an opted-out customer to a Meta
 * audience would be a compliance violation.
 */
async function resolveContactHashes(
  tenantId: string,
  spec: SegmentFilterSpec,
): Promise<{ totalContacts: number; hashes: string[] }> {
  const where = specToWhere(tenantId, spec) as Record<string, unknown>;
  where.optedOut = false; // hard-enforce, even if spec said otherwise.
  const contacts = await prisma.contact.findMany({
    where,
    select: { phoneNumber: true },
    take: 50_000, // safety cap — typical audience sizes are well under this.
  });
  const seen = new Set<string>();
  const hashes: string[] = [];
  for (const c of contacts) {
    const h = hashPhoneForMeta(c.phoneNumber);
    if (h && !seen.has(h)) {
      seen.add(h);
      hashes.push(h);
    }
  }
  return { totalContacts: contacts.length, hashes };
}

async function createMetaAudienceRow(args: {
  tenantId: string;
  name: string;
  description?: string;
  spec: SegmentFilterSpec;
}): Promise<MetaAdsAudience> {
  return prisma.metaAdsAudience.create({
    data: {
      tenantId: args.tenantId,
      name: args.name,
      description: args.description ?? null,
      filterSpec: args.spec as unknown as object,
      status: MetaAudienceStatus.CREATING,
    },
  });
}

/**
 * Create the audience on Meta's side AND upload the contact hashes. Run
 * synchronously so the route returns a fully-uploaded audience; for very
 * large segments we'd want to queue this, but the 50k cap keeps the
 * runtime predictable in the seconds, not minutes.
 */
export async function exportMetaAudience(args: {
  tenantId: string;
  name: string;
  description?: string;
  spec: SegmentFilterSpec;
}): Promise<MetaAdsAudience> {
  const { token, adAccountId } = await getDecryptedToken(args.tenantId);
  const row = await createMetaAudienceRow({
    tenantId: args.tenantId,
    name: args.name.trim(),
    description: args.description?.trim(),
    spec: args.spec,
  });

  try {
    // 1. Create the audience on Meta.
    type CreateAudienceResp = { id: string };
    const created = await callMeta<CreateAudienceResp>({
      method: "POST",
      path: `/act_${adAccountId}/customaudiences`,
      accessToken: token,
      query: {
        name: row.name,
        description: row.description ?? "",
        subtype: "CUSTOM",
        customer_file_source: "USER_PROVIDED_ONLY",
      },
    });

    // 2. Resolve the contact list + upload in batches of 10k.
    const { totalContacts, hashes } = await resolveContactHashes(
      args.tenantId,
      args.spec,
    );
    let uploaded = 0;
    for (let i = 0; i < hashes.length; i += 10_000) {
      const batch = hashes.slice(i, i + 10_000);
      await callMeta<unknown>({
        method: "POST",
        path: `/${created.id}/users`,
        accessToken: token,
        query: {
          payload: JSON.stringify({
            schema: ["PHONE"],
            data: batch.map((h) => [h]),
          }),
        },
      });
      uploaded += batch.length;
    }

    return prisma.metaAdsAudience.update({
      where: { id: row.id },
      data: {
        metaAudienceId: created.id,
        status: MetaAudienceStatus.READY,
        contactCount: totalContacts,
        uploadedCount: uploaded,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
  } catch (err) {
    const message = (err as Error).message ?? "Audience export failed.";
    await prisma.metaAdsAudience.update({
      where: { id: row.id },
      data: { status: MetaAudienceStatus.FAILED, lastSyncError: message },
    });
    throw err;
  }
}

/**
 * Re-resolve the audience's filter spec and re-upload the contact list.
 * Meta dedupes on its side, so this is safe to call repeatedly.
 */
export async function refreshMetaAudience(args: {
  tenantId: string;
  audienceRowId: string;
}): Promise<MetaAdsAudience> {
  const row = await prisma.metaAdsAudience.findFirst({
    where: { id: args.audienceRowId, tenantId: args.tenantId },
  });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Audience not found.");
  }
  if (!row.metaAudienceId) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Audience was never created on Meta; delete and recreate it.",
    );
  }

  const { token } = await getDecryptedToken(args.tenantId);
  await prisma.metaAdsAudience.update({
    where: { id: row.id },
    data: { status: MetaAudienceStatus.REFRESHING, lastSyncError: null },
  });

  try {
    const spec = parseFilterSpec(row.filterSpec);
    const { totalContacts, hashes } = await resolveContactHashes(
      args.tenantId,
      spec,
    );
    let uploaded = 0;
    for (let i = 0; i < hashes.length; i += 10_000) {
      const batch = hashes.slice(i, i + 10_000);
      await callMeta<unknown>({
        method: "POST",
        path: `/${row.metaAudienceId}/users`,
        accessToken: token,
        query: {
          payload: JSON.stringify({
            schema: ["PHONE"],
            data: batch.map((h) => [h]),
          }),
        },
      });
      uploaded += batch.length;
    }
    return prisma.metaAdsAudience.update({
      where: { id: row.id },
      data: {
        status: MetaAudienceStatus.READY,
        contactCount: totalContacts,
        uploadedCount: uploaded,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
  } catch (err) {
    const message = (err as Error).message ?? "Audience refresh failed.";
    await prisma.metaAdsAudience.update({
      where: { id: row.id },
      data: { status: MetaAudienceStatus.FAILED, lastSyncError: message },
    });
    throw err;
  }
}

export async function listMetaAudiences(
  tenantId: string,
): Promise<MetaAdsAudience[]> {
  return prisma.metaAdsAudience.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Delete the audience locally. Meta keeps its own copy (deleting a custom
 * audience there is destructive and operators usually want to keep the
 * audience for retargeting in Ads Manager) — slice 3 can add a "delete
 * on Meta side too" toggle.
 */
export async function deleteMetaAudienceLocal(args: {
  tenantId: string;
  audienceRowId: string;
}): Promise<void> {
  await prisma.metaAdsAudience.deleteMany({
    where: { id: args.audienceRowId, tenantId: args.tenantId },
  });
}

/**
 * Preview helper used by the UI before creating an audience — returns how
 * many contacts would land in the audience for a given spec.
 */
export async function previewAudienceSize(args: {
  tenantId: string;
  spec: SegmentFilterSpec;
}): Promise<{ contactCount: number; hashableCount: number }> {
  const { totalContacts, hashes } = await resolveContactHashes(
    args.tenantId,
    args.spec,
  );
  return { contactCount: totalContacts, hashableCount: hashes.length };
}

export { type SegmentFilterSpec as MetaAudienceFilterSpec };
