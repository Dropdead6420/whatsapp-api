import jwt from "jsonwebtoken";
import { prisma, DevicePlatform } from "@nexaflow/db";

// ----------------------------------------------------------------------------
// FCM HTTP v1 push notifications.
//
// We talk to FCM directly rather than depend on firebase-admin — same trick
// the Google Ads service uses for OAuth (jsonwebtoken is already a dep, the
// dep tree stays slim). Two pieces of state to manage:
//
//   1. Service account: pulled from FIREBASE_SERVICE_ACCOUNT_JSON env var.
//      We expect the standard Firebase service-account JSON shape with
//      `project_id`, `client_email`, and `private_key`.
//   2. Access token: minted by signing a JWT with the service account's
//      RSA-256 key, then exchanging at https://oauth2.googleapis.com/token
//      for a 1-hour bearer token. Cached in-process so we don't sign a JWT
//      per send.
//
// The service degrades gracefully when no service account is configured:
// every send is a no-op and we log once on boot, so the rest of the app
// runs fine in dev without Firebase set up.
// ----------------------------------------------------------------------------

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // ms epoch
}

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 1 min early

let cachedToken: CachedToken | null = null;
let serviceAccount: ServiceAccount | null | undefined; // undefined = unread

function readServiceAccount(): ServiceAccount | null {
  if (serviceAccount !== undefined) return serviceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      "[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled.",
    );
    serviceAccount = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.warn(
        "[push] FIREBASE_SERVICE_ACCOUNT_JSON missing required fields — push disabled.",
      );
      serviceAccount = null;
      return null;
    }
    // Some deployment systems escape the newlines in the private key when
    // moving JSON through env vars. Restore them so jsonwebtoken can read
    // the PEM.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    serviceAccount = parsed;
    return serviceAccount;
  } catch (err) {
    console.warn(
      "[push] FIREBASE_SERVICE_ACCOUNT_JSON failed to parse:",
      (err as Error).message,
    );
    serviceAccount = null;
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const sa = readServiceAccount();
  if (!sa) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: "RS256" },
  );

  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn(
      `[push] OAuth exchange failed (HTTP ${resp.status}): ${text.slice(0, 200)}`,
    );
    return null;
  }
  const parsed = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!parsed.access_token) {
    console.warn("[push] OAuth response missing access_token");
    return null;
  }
  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3500) * 1000,
  };
  return cachedToken.accessToken;
}

// ----------------------------------------------------------------------------
// Send primitives
// ----------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /**
   * Data-only fields delivered to the mobile app's message handler. Used
   * to deep-link the tap (e.g. { type: "message", conversationId: "..." }).
   * All values must be strings — FCM rejects non-string data fields.
   */
  data?: Record<string, string>;
}

interface SendResult {
  delivered: number;
  failed: number;
  prunedTokens: number;
}

async function sendOne(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  payload: PushPayload,
): Promise<"sent" | "invalid-token" | "error"> {
  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: { priority: "high" },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        },
      }),
    },
  );
  if (resp.ok) return "sent";
  // FCM returns UNREGISTERED (404) or INVALID_ARGUMENT (400) when the token
  // belongs to a device that's been uninstalled or wiped. We prune those.
  if (resp.status === 404 || resp.status === 400) {
    const text = await resp.text().catch(() => "");
    if (
      text.includes("UNREGISTERED") ||
      text.includes("invalid registration token") ||
      text.includes("INVALID_ARGUMENT")
    ) {
      return "invalid-token";
    }
  }
  const text = await resp.text().catch(() => "");
  console.warn(`[push] send failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  return "error";
}

async function fanout(
  tokens: Array<{ id: string; fcmToken: string }>,
  payload: PushPayload,
): Promise<SendResult> {
  const accessToken = await getAccessToken();
  const sa = readServiceAccount();
  if (!accessToken || !sa) {
    return { delivered: 0, failed: 0, prunedTokens: 0 };
  }
  let delivered = 0;
  let failed = 0;
  const invalidIds: string[] = [];
  for (const t of tokens) {
    const result = await sendOne(accessToken, sa.project_id, t.fcmToken, payload);
    if (result === "sent") delivered += 1;
    else if (result === "invalid-token") invalidIds.push(t.id);
    else failed += 1;
  }
  if (invalidIds.length > 0) {
    // Prune stale tokens so we don't keep wasting RPCs on uninstalled apps.
    await prisma.userDevice
      .deleteMany({ where: { id: { in: invalidIds } } })
      .catch(() => undefined);
  }
  return { delivered, failed, prunedTokens: invalidIds.length };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const devices = await prisma.userDevice.findMany({
    where: { userId },
    select: { id: true, fcmToken: true },
  });
  return fanout(devices, payload);
}

/**
 * Fan-out push to every user in a tenant. Use cases:
 *   - Inbound WhatsApp message (every agent on the tenant gets pinged)
 *   - New lead created
 *   - Wallet low-balance alert
 */
export async function sendToTenant(
  tenantId: string,
  payload: PushPayload,
): Promise<SendResult> {
  const devices = await prisma.userDevice.findMany({
    where: { tenantId },
    select: { id: true, fcmToken: true },
  });
  return fanout(devices, payload);
}

// ----------------------------------------------------------------------------
// Device registration
// ----------------------------------------------------------------------------

export async function registerDevice(args: {
  userId: string;
  tenantId: string | null;
  fcmToken: string;
  platform?: DevicePlatform;
  label?: string;
}) {
  const trimmed = args.fcmToken.trim();
  if (!trimmed) {
    throw new Error("fcmToken required");
  }
  return prisma.userDevice.upsert({
    where: { fcmToken: trimmed },
    create: {
      userId: args.userId,
      tenantId: args.tenantId,
      fcmToken: trimmed,
      platform: args.platform ?? DevicePlatform.ANDROID,
      label: args.label ?? null,
      lastSeenAt: new Date(),
    },
    update: {
      // If a token migrates to a new user (rare — app reinstall + new
      // login), update userId so we don't fan out push to the wrong user.
      userId: args.userId,
      tenantId: args.tenantId,
      platform: args.platform ?? DevicePlatform.ANDROID,
      label: args.label ?? null,
      lastSeenAt: new Date(),
    },
  });
}

export async function unregisterDevice(args: {
  userId: string;
  fcmToken: string;
}): Promise<void> {
  await prisma.userDevice.deleteMany({
    where: { userId: args.userId, fcmToken: args.fcmToken.trim() },
  });
}

export async function listUserDevices(userId: string) {
  return prisma.userDevice.findMany({
    where: { userId },
    select: {
      id: true,
      platform: true,
      label: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: { lastSeenAt: "desc" },
  });
}
