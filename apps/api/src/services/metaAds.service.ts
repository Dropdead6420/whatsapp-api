import { prisma, MetaAdsConnection } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { decryptTokenIfNeeded, encryptToken } from "../lib/tokenCrypto";

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
