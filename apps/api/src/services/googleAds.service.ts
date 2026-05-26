import { prisma, GoogleAdsConnection } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { decryptTokenIfNeeded, encryptToken } from "../lib/tokenCrypto";

// ----------------------------------------------------------------------------
// Google Ads API client (PRD §3.3.7, Phase 4 slice 1).
//
// Shape mirrors metaAds.service.ts: one connection per tenant; reads are
// driven by GAQL queries against googleads.googleapis.com. Three pieces of
// auth glue:
//
//   1. Developer token — issued by Google to the SaaS owner (NexaFlow), not
//      the end-customer. Lives in env vars; same value for every tenant.
//   2. OAuth client — also NexaFlow's, in env vars. Used to exchange the
//      tenant's refresh token for a short-lived access token on each call.
//   3. Refresh token — per-tenant, encrypted at rest with the WABA crypto
//      envelope. Operators paste it in slice 1; slice 2 will run the
//      proper consent flow.
//
// We don't cache access tokens between requests yet — Google returns a
// fresh one in ~150ms and the alternative is wiring a Redis-backed cache
// per tenant. Worth doing in slice 2 once usage justifies it.
// ----------------------------------------------------------------------------

const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v15";
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 15_000;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      `Google Ads is not configured: ${name} env var is missing.`,
    );
  }
  return value;
}

function stripCustomerIdDashes(value: string): string {
  return value.replace(/-/g, "").trim();
}

// ----------------------------------------------------------------------------
// OAuth + raw HTTP
// ----------------------------------------------------------------------------

async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const clientId = readEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_ADS_CLIENT_SECRET");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    // Serialize the form body to a string — Node's `fetch` type bindings
    // in this project's TS version don't accept URLSearchParams directly.
    const formBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();
    response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
      signal: ctl.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        504,
        "Google OAuth token endpoint timed out.",
      );
    }
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Google OAuth request failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Google OAuth returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok) {
    const errMsg =
      (parsed as { error_description?: string; error?: string } | null)
        ?.error_description ??
      (parsed as { error?: string } | null)?.error ??
      `Google OAuth error (HTTP ${response.status})`;
    // 400 / 401 typically mean the refresh token is revoked or invalid.
    const status =
      response.status === 400 || response.status === 401 ? 401 : 502;
    throw new ApiError(
      status === 401 ? ErrorCodes.UNAUTHORIZED : ErrorCodes.INTERNAL_SERVER_ERROR,
      status,
      errMsg,
    );
  }
  const accessToken = (parsed as { access_token?: string } | null)?.access_token;
  if (!accessToken) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "Google OAuth response missing access_token.",
    );
  }
  return accessToken;
}

interface GoogleAdsCallArgs {
  accessToken: string;
  customerId: string; // dashes already stripped
  loginCustomerId?: string | null;
  path: string; // "/customers/<id>/googleAds:search" etc
  body?: Record<string, unknown>;
  method?: "POST" | "GET";
}

async function callGoogleAds<T>(args: GoogleAdsCallArgs): Promise<T> {
  const devToken = readEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    "developer-token": devToken,
    "Content-Type": "application/json",
  };
  if (args.loginCustomerId) {
    headers["login-customer-id"] = args.loginCustomerId;
  }
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_ADS_API_BASE}${args.path}`, {
      method: args.method ?? "POST",
      headers,
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: ctl.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        504,
        `Google Ads API timed out after ${REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      `Google Ads API request failed: ${(err as Error).message}`,
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
      throw new ApiError(
        ErrorCodes.INTERNAL_SERVER_ERROR,
        502,
        `Google Ads API returned non-JSON: ${text.slice(0, 200)}`,
      );
    }
  }
  if (!response.ok) {
    // Google Ads returns nested error envelope: {error: {message, status, details}}
    const errEnv = (parsed as { error?: { message?: string; status?: string } } | null)
      ?.error;
    const message =
      errEnv?.message ?? `Google Ads API error (HTTP ${response.status})`;
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

interface CustomerMetadata {
  customerName: string | null;
  currency: string | null;
  timeZoneName: string | null;
}

/**
 * Resolve account-level metadata for the connected customer id. Used on
 * connect to verify the refresh token + the customer id are valid and to
 * cache display fields for the UI.
 */
async function fetchCustomerMetadata(args: {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string | null;
}): Promise<CustomerMetadata> {
  const result = await callGoogleAds<{
    results?: Array<{
      customer?: {
        descriptiveName?: string;
        currencyCode?: string;
        timeZone?: string;
      };
    }>;
  }>({
    accessToken: args.accessToken,
    customerId: args.customerId,
    loginCustomerId: args.loginCustomerId,
    path: `/customers/${args.customerId}/googleAds:search`,
    body: {
      query:
        "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
    },
  });
  const row = result.results?.[0]?.customer;
  return {
    customerName: row?.descriptiveName ?? null,
    currency: row?.currencyCode ?? null,
    timeZoneName: row?.timeZone ?? null,
  };
}

/**
 * Validate + persist (upsert) a Google Ads connection. We verify the refresh
 * token by exchanging it for an access token AND pulling customer metadata
 * before the row is written, so a broken paste fails the request rather
 * than landing as a half-configured connection.
 */
export async function saveGoogleAdsConnection(args: {
  tenantId: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
}): Promise<GoogleAdsConnection> {
  const customerId = stripCustomerIdDashes(args.customerId);
  const loginCustomerId = args.loginCustomerId
    ? stripCustomerIdDashes(args.loginCustomerId)
    : null;
  if (!/^\d{10}$/.test(customerId)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "customerId must be a 10-digit Google Ads customer id (dashes ok).",
    );
  }
  if (loginCustomerId && !/^\d{10}$/.test(loginCustomerId)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "loginCustomerId must be a 10-digit Google Ads customer id (dashes ok).",
    );
  }

  const accessToken = await exchangeRefreshToken(args.refreshToken);
  const meta = await fetchCustomerMetadata({
    accessToken,
    customerId,
    loginCustomerId,
  });

  const encrypted = encryptToken(args.refreshToken);
  return prisma.googleAdsConnection.upsert({
    where: { tenantId: args.tenantId },
    create: {
      tenantId: args.tenantId,
      refreshToken: encrypted,
      customerId,
      loginCustomerId,
      customerName: meta.customerName,
      currency: meta.currency,
      timeZoneName: meta.timeZoneName,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    },
    update: {
      refreshToken: encrypted,
      customerId,
      loginCustomerId,
      customerName: meta.customerName,
      currency: meta.currency,
      timeZoneName: meta.timeZoneName,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    },
  });
}

export async function getGoogleAdsConnection(
  tenantId: string,
): Promise<GoogleAdsConnection | null> {
  return prisma.googleAdsConnection.findUnique({ where: { tenantId } });
}

export async function deleteGoogleAdsConnection(
  tenantId: string,
): Promise<void> {
  await prisma.googleAdsConnection.deleteMany({ where: { tenantId } });
}

async function getDecryptedRefresh(tenantId: string): Promise<{
  refreshToken: string;
  customerId: string;
  loginCustomerId: string | null;
}> {
  const conn = await prisma.googleAdsConnection.findUnique({
    where: { tenantId },
  });
  if (!conn) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "No Google Ads connection. Connect a customer account first.",
    );
  }
  const refreshToken = decryptTokenIfNeeded(conn.refreshToken);
  if (!refreshToken) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      "Google Ads refresh token failed to decrypt.",
    );
  }
  return {
    refreshToken,
    customerId: conn.customerId,
    loginCustomerId: conn.loginCustomerId,
  };
}

// ----------------------------------------------------------------------------
// Reads — campaigns + per-campaign metrics
// ----------------------------------------------------------------------------

export interface GoogleAdsCampaignRow {
  id: string;
  name: string;
  status: string;
  advertisingChannelType?: string;
  startDate?: string;
  endDate?: string;
  metrics: {
    impressions: number;
    clicks: number;
    ctr: number;
    averageCpcMicros: number;
    costMicros: number;
    conversions: number;
  };
}

type DatePreset =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_14_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH";

function escapeGaql(value: string): string {
  // Only used for fixed enum-like tokens; reject anything not [A-Z_].
  if (!/^[A-Z_]+$/.test(value)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Invalid GAQL token: ${value}`,
    );
  }
  return value;
}

/**
 * Pull campaign rows with metrics for the requested date range. One GAQL
 * query per call — Google joins campaign + metrics + segments server-side
 * so we don't need a separate insights endpoint like Meta.
 */
export async function listCampaignsWithMetrics(args: {
  tenantId: string;
  datePreset?: DatePreset;
}): Promise<GoogleAdsCampaignRow[]> {
  const { refreshToken, customerId, loginCustomerId } = await getDecryptedRefresh(
    args.tenantId,
  );
  const accessToken = await exchangeRefreshToken(refreshToken);
  const datePreset = escapeGaql(args.datePreset ?? "LAST_7_DAYS");

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING ${datePreset}
    ORDER BY metrics.impressions DESC
    LIMIT 200
  `;

  const result = await callGoogleAds<{
    results?: Array<{
      campaign?: {
        id?: string;
        name?: string;
        status?: string;
        advertisingChannelType?: string;
        startDate?: string;
        endDate?: string;
      };
      metrics?: {
        impressions?: string;
        clicks?: string;
        ctr?: number;
        averageCpc?: string;
        costMicros?: string;
        conversions?: number;
      };
    }>;
  }>({
    accessToken,
    customerId,
    loginCustomerId,
    path: `/customers/${customerId}/googleAds:search`,
    body: { query },
  });

  // Google can return multiple rows per campaign when segmented. The query
  // above doesn't segment, but be defensive: aggregate by campaign.id.
  const byId = new Map<string, GoogleAdsCampaignRow>();
  for (const row of result.results ?? []) {
    const cId = row.campaign?.id;
    if (!cId) continue;
    const existing = byId.get(cId);
    const m = row.metrics ?? {};
    const impressions = Number(m.impressions ?? 0);
    const clicks = Number(m.clicks ?? 0);
    const costMicros = Number(m.costMicros ?? 0);
    const averageCpcMicros = Number(m.averageCpc ?? 0);
    const conversions = Number(m.conversions ?? 0);
    const ctr = Number(m.ctr ?? 0);
    if (existing) {
      existing.metrics.impressions += impressions;
      existing.metrics.clicks += clicks;
      existing.metrics.costMicros += costMicros;
      existing.metrics.conversions += conversions;
      // ctr / averageCpc don't sum cleanly across segments — keep the
      // first seen value (or recompute below).
    } else {
      byId.set(cId, {
        id: cId,
        name: row.campaign?.name ?? "(unnamed)",
        status: row.campaign?.status ?? "UNKNOWN",
        advertisingChannelType: row.campaign?.advertisingChannelType,
        startDate: row.campaign?.startDate,
        endDate: row.campaign?.endDate,
        metrics: {
          impressions,
          clicks,
          ctr,
          averageCpcMicros,
          costMicros,
          conversions,
        },
      });
    }
  }

  // Recompute ctr after aggregation in case multiple rows were merged.
  for (const row of byId.values()) {
    row.metrics.ctr =
      row.metrics.impressions > 0
        ? row.metrics.clicks / row.metrics.impressions
        : row.metrics.ctr;
  }

  await prisma.googleAdsConnection.update({
    where: { tenantId: args.tenantId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });

  return Array.from(byId.values());
}
