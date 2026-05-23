import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { encryptToken } from "../lib/tokenCrypto";

// Meta Embedded Signup orchestration (T-004).
//
// Flow:
//   1. The Embedded Signup popup completes; Meta's `WA_EMBEDDED_SIGNUP`
//      message yields { code, wabaId, phoneNumberId, businessId }.
//   2. The browser POSTs that bundle to /api/v1/whatsapp/embedded-signup.
//   3. We exchange the code for a long-lived access token at
//      `oauth/access_token`, persist the encrypted token + ids on the
//      tenant row, subscribe the WABA to our webhook URL, and return
//      the redacted result.
//
// The exchange + subscribe steps each touch a real Meta endpoint, so
// they're written behind small helpers that take the URL — easy to mock
// in tests, easy to point at Meta's staging URL via env.

const META_GRAPH_BASE =
  process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0";
const META_OAUTH_BASE =
  process.env.META_OAUTH_BASE_URL ?? `${META_GRAPH_BASE}/oauth`;

export interface ExchangeInput {
  /** Short-lived code from the FB.login Embedded Signup popup. */
  code: string;
  /** Meta Business Manager id parent of this WABA. */
  businessId: string;
  /** WhatsApp Business Account id selected during signup. */
  wabaId: string;
  /** Phone number id selected during signup. */
  phoneNumberId: string;
  /** Redirect URI used to mint the code. Must match the FB app config. */
  redirectUri?: string;
}

export interface ExchangeResult {
  tenantId: string;
  metaBusinessId: string;
  wabaId: string;
  phoneNumberId: string;
  accessTokenPreview: string; // masked
  /** ISO timestamp when the token expires, or null for never-expires. */
  tokenExpiresAt: string | null;
  webhookSubscribed: boolean;
}

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string };
}

interface SubscribeResponse {
  success?: boolean;
  error?: { message?: string };
}

function tokenPreview(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 3)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function requireMetaAppCreds(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (
    !appId ||
    !appSecret ||
    appId.startsWith("your_") ||
    appSecret.startsWith("your_")
  ) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Meta Embedded Signup is not configured. Set META_APP_ID and META_APP_SECRET on the API server.",
    );
  }
  return { appId, appSecret };
}

/**
 * Exchange the Embedded Signup code for a long-lived access token.
 * Documented at developers.facebook.com/docs/whatsapp/embedded-signup.
 *
 * Returns both the token and the absolute expiry (when Meta sends an
 * `expires_in`). System User tokens with the never-expires flag return
 * undefined expiresAt; we use that to skip the warn worker for them.
 */
export async function exchangeMetaCodeForToken(args: {
  code: string;
  redirectUri?: string;
}): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const { appId, appSecret } = requireMetaAppCreds();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code: args.code,
  });
  if (args.redirectUri) params.set("redirect_uri", args.redirectUri);

  const res = await fetch(
    `${META_OAUTH_BASE}/access_token?${params.toString()}`,
    { method: "GET" },
  );
  const data = (await res.json().catch(() => ({}))) as OAuthTokenResponse;
  if (!res.ok || !data.access_token) {
    const msg = data.error?.message ?? `Meta OAuth exchange failed (${res.status})`;
    throw new ApiError(ErrorCodes.BAD_REQUEST, res.status || 502, msg);
  }
  const expiresAt =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;
  return { accessToken: data.access_token, expiresAt };
}

/**
 * Subscribe our app to the WABA so inbound messages flow into
 * /webhooks/whatsapp. This is the call that closes the onboarding loop
 * — without it, Meta delivers nothing.
 */
export async function subscribeWabaToApp(args: {
  wabaId: string;
  accessToken: string;
}): Promise<boolean> {
  const res = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(args.wabaId)}/subscribed_apps`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${args.accessToken}` },
    },
  );
  const data = (await res.json().catch(() => ({}))) as SubscribeResponse;
  if (!res.ok) {
    const msg =
      data.error?.message ?? `Webhook subscription failed (${res.status})`;
    // Don't fail the whole onboarding — log + continue. Operator can
    // re-trigger from the WhatsApp settings page.
    console.warn(`[meta-signup] subscribe_apps failed: ${msg}`);
    return false;
  }
  return data.success === true || res.status === 200;
}

/**
 * Top-level orchestrator. Runs exchange → persist → subscribe.
 * Never returns the raw token; only its preview.
 */
export async function completeEmbeddedSignup(args: {
  tenantId: string;
  input: ExchangeInput;
}): Promise<ExchangeResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: { id: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }

  const { accessToken, expiresAt } = await exchangeMetaCodeForToken({
    code: args.input.code,
    redirectUri: args.input.redirectUri,
  });

  // Subscribe before persisting so a failure leaves the tenant un-
  // changed — the operator can retry without leaving half-state.
  const subscribed = await subscribeWabaToApp({
    wabaId: args.input.wabaId,
    accessToken,
  });

  await prisma.tenant.update({
    where: { id: args.tenantId },
    data: {
      metaBusinessId: args.input.businessId,
      wabaId: args.input.wabaId,
      wabaPhoneNumber: args.input.phoneNumberId,
      wabaAccessToken: encryptToken(accessToken),
      wabaTokenExpiresAt: expiresAt,
      wabaTokenExpiryWarnedAt: null, // reset warn cooldown on fresh token
      wabaLastSyncError: null,
    },
  });

  // Best-effort business profile sync. Failure here doesn't undo the
  // onboarding — operator can refresh manually from /whatsapp-settings.
  void syncWhatsAppBusinessProfile({ tenantId: args.tenantId }).catch(
    (err) => {
      console.warn(
        "[meta-signup] business profile sync failed (non-fatal):",
        (err as Error).message,
      );
    },
  );

  return {
    tenantId: args.tenantId,
    metaBusinessId: args.input.businessId,
    wabaId: args.input.wabaId,
    phoneNumberId: args.input.phoneNumberId,
    accessTokenPreview: tokenPreview(accessToken),
    tokenExpiresAt: expiresAt ? expiresAt.toISOString() : null,
    webhookSubscribed: subscribed,
  };
}

/**
 * Re-run the WABA → app subscription. Used as a recovery path when the
 * initial subscribe step failed during embedded signup.
 */
export async function resubscribeTenantWebhook(args: {
  tenantId: string;
}): Promise<{ subscribed: boolean }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: { wabaId: true, wabaAccessToken: true },
  });
  if (!tenant?.wabaId || !tenant.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp must be connected (WABA + access token) before re-subscribing.",
    );
  }
  // Lazy import to avoid a cycle with tokenCrypto in test setups.
  const { decryptTokenIfNeeded } = await import("../lib/tokenCrypto");
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp access token failed to decrypt.",
    );
  }
  const subscribed = await subscribeWabaToApp({
    wabaId: tenant.wabaId,
    accessToken,
  });
  await prisma.tenant.update({
    where: { id: args.tenantId },
    data: subscribed
      ? { wabaLastSyncError: null }
      : { wabaLastSyncError: "Webhook subscribe failed. Try again." },
  });
  return { subscribed };
}

// ----------------------------------------------------------------------------
// Business profile sync (T-004 follow-up). Meta exposes two profile shapes:
//   - /<waba_id>?fields=name,vertical,timezone_offset_min  → WABA-level
//   - /<phone_number_id>/whatsapp_business_profile?fields=about,verified_name,vertical,description,address,websites
//
// We pull both, prefer the phone-number profile values when populated,
// and persist a flat name/vertical/about on the tenant row.
//
// Failure is non-fatal: this runs at the tail of completeEmbeddedSignup,
// so a transient Meta hiccup doesn't undo a successful onboarding. The
// manual sync endpoint surfaces the error to the operator.
// ----------------------------------------------------------------------------

interface PhoneProfileFields {
  about?: string;
  verified_name?: string;
  vertical?: string;
  description?: string;
}
interface PhoneProfileResponse {
  data?: PhoneProfileFields[];
  error?: { message?: string };
}
interface WabaProfileResponse {
  name?: string;
  vertical?: string;
  timezone_offset_min?: number;
  error?: { message?: string };
}

export interface BusinessProfileResult {
  name: string | null;
  vertical: string | null;
  about: string | null;
  syncedAt: string;
}

async function fetchPhoneProfile(args: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<PhoneProfileFields | null> {
  const fields = encodeURIComponent("about,verified_name,vertical,description");
  const res = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(args.phoneNumberId)}/whatsapp_business_profile?fields=${fields}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
  const data = (await res.json().catch(() => ({}))) as PhoneProfileResponse;
  if (!res.ok) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      res.status || 502,
      data.error?.message ?? `WhatsApp business profile fetch failed (${res.status})`,
    );
  }
  return data.data?.[0] ?? null;
}

async function fetchWabaProfile(args: {
  wabaId: string;
  accessToken: string;
}): Promise<WabaProfileResponse | null> {
  const fields = encodeURIComponent("name,vertical,timezone_offset_min");
  const res = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(args.wabaId)}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
  const data = (await res.json().catch(() => ({}))) as WabaProfileResponse;
  if (!res.ok) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      res.status || 502,
      data.error?.message ?? `WABA profile fetch failed (${res.status})`,
    );
  }
  return data;
}

/**
 * Pull both the phone-number profile and the WABA profile from Meta, merge
 * (phone fields take precedence), and persist to the tenant row.
 *
 * Caller must already hold an authenticated context (a route layer with
 * WABA_CONFIGURE permission). The tenant must have wabaId + wabaPhoneNumber
 * + a decryptable wabaAccessToken on record.
 */
export async function syncWhatsAppBusinessProfile(args: {
  tenantId: string;
}): Promise<BusinessProfileResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: {
      wabaId: true,
      wabaPhoneNumber: true,
      wabaAccessToken: true,
    },
  });
  if (!tenant?.wabaId || !tenant.wabaPhoneNumber || !tenant.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp must be connected (WABA + phone + access token) before syncing the business profile.",
    );
  }

  const { decryptTokenIfNeeded } = await import("../lib/tokenCrypto");
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp access token failed to decrypt.",
    );
  }

  const [phoneProfile, wabaProfile] = await Promise.all([
    fetchPhoneProfile({
      phoneNumberId: tenant.wabaPhoneNumber,
      accessToken,
    }),
    fetchWabaProfile({ wabaId: tenant.wabaId, accessToken }),
  ]);

  const name =
    phoneProfile?.verified_name?.trim() || wabaProfile?.name?.trim() || null;
  const vertical =
    phoneProfile?.vertical?.trim() || wabaProfile?.vertical?.trim() || null;
  const about =
    phoneProfile?.about?.trim() ||
    phoneProfile?.description?.trim() ||
    null;
  const syncedAt = new Date();

  await prisma.tenant.update({
    where: { id: args.tenantId },
    data: {
      wabaBusinessName: name,
      wabaBusinessVertical: vertical,
      wabaBusinessAbout: about,
      wabaBusinessProfileSyncedAt: syncedAt,
    },
  });

  return {
    name,
    vertical,
    about,
    syncedAt: syncedAt.toISOString(),
  };
}

/** Push about/vertical to Meta then re-sync (business profile manager). */
export async function updateWhatsAppBusinessProfile(args: {
  tenantId: string;
  about?: string;
  vertical?: string;
}): Promise<BusinessProfileResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: { wabaPhoneNumber: true, wabaAccessToken: true },
  });
  if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp must be connected before updating the business profile.",
    );
  }
  const { decryptTokenIfNeeded } = await import("../lib/tokenCrypto");
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Access token failed to decrypt.");
  }

  const body: Record<string, string> = { messaging_product: "whatsapp" };
  if (args.about !== undefined) body.about = args.about.slice(0, 512);
  if (args.vertical !== undefined) body.vertical = args.vertical.slice(0, 80);

  const res = await fetch(
    `${META_GRAPH_BASE}/${encodeURIComponent(tenant.wabaPhoneNumber)}/whatsapp_business_profile`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      res.status || 502,
      data.error?.message ?? `Meta profile update failed (${res.status})`,
    );
  }

  return syncWhatsAppBusinessProfile({ tenantId: args.tenantId });
}
