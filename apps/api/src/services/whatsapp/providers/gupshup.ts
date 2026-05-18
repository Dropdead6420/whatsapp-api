import { ApiError, ErrorCodes } from "@nexaflow/shared";
import type {
  SendContext,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "../types";

// Gupshup BSP adapter — T-005c.
//
// API surface differs from Meta:
//   - Endpoint: https://api.gupshup.io/wa/api/v1/msg
//   - Auth: `apikey` header (not Bearer)
//   - Body: application/x-www-form-urlencoded (not JSON)
//   - Sender identity comes from the configured `source` phone, not Meta's
//     phoneNumberId. The interface still carries phoneNumberId — Gupshup
//     just ignores it.
//
// Credentials are resolved in this order (T-005d):
//   1. ctx.config (decrypted `ProviderRoute.config`, per-tenant)
//   2. GUPSHUP_API_KEY / GUPSHUP_APP_NAME / GUPSHUP_SOURCE env (bootstrap
//      for the dev path and for tenants without a config row yet)

const GUPSHUP_API_BASE =
  process.env.GUPSHUP_API_BASE_URL ?? "https://api.gupshup.io/wa/api/v1";

interface GupshupCreds {
  apiKey: string;
  appName: string;
  source: string;
}

function readCredsFromContext(ctx?: SendContext): GupshupCreds | null {
  const cfg = ctx?.config;
  if (!cfg) return null;
  const apiKey =
    typeof cfg.apiKey === "string" && cfg.apiKey.trim() ? cfg.apiKey : null;
  const appName =
    typeof cfg.appName === "string" && cfg.appName.trim() ? cfg.appName : null;
  const source =
    typeof cfg.source === "string" && cfg.source.trim() ? cfg.source : null;
  if (!apiKey || !appName || !source) return null;
  return { apiKey, appName, source };
}

function readCreds(ctx?: SendContext): GupshupCreds {
  const fromCtx = readCredsFromContext(ctx);
  if (fromCtx) return fromCtx;

  const apiKey = process.env.GUPSHUP_API_KEY;
  const appName = process.env.GUPSHUP_APP_NAME;
  const source = process.env.GUPSHUP_SOURCE;
  if (!apiKey || !appName || !source) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Gupshup adapter is not configured. Set ProviderRoute.config with {apiKey, appName, source} for the tenant, or GUPSHUP_API_KEY / GUPSHUP_APP_NAME / GUPSHUP_SOURCE env vars.",
    );
  }
  return { apiKey, appName, source };
}

interface GupshupSendResponse {
  status?: string;
  messageId?: string;
  message?: string;
}

async function postToGupshup(
  path: string,
  apiKey: string,
  body: URLSearchParams,
): Promise<GupshupSendResponse> {
  // Serialize URLSearchParams to a string explicitly — some Node type
  // shims complain about passing URLSearchParams directly to fetch's
  // BodyInit, and the wire payload is the same either way.
  const res = await fetch(`${GUPSHUP_API_BASE}${path}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as GupshupSendResponse;
  if (!res.ok || data.status === "error") {
    const msg = data.message ?? `Gupshup API error ${res.status}`;
    throw new ApiError(ErrorCodes.BAD_REQUEST, res.status || 502, msg);
  }
  return data;
}

function unwrapMessageId(res: GupshupSendResponse): string {
  if (!res.messageId) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "Gupshup returned success without a messageId.",
    );
  }
  return res.messageId;
}

export const gupshupProvider: WhatsAppProvider = {
  key: "gupshup",
  supportsMedia: true,

  async sendText(args: SendTextArgs, ctx?: SendContext): Promise<SendResult> {
    const creds = readCreds(ctx);
    const body = new URLSearchParams({
      channel: "whatsapp",
      source: creds.source,
      destination: args.to,
      message: JSON.stringify({ type: "text", text: args.body }),
      "src.name": creds.appName,
    });
    const res = await postToGupshup("/msg", creds.apiKey, body);
    return { providerMessageId: unwrapMessageId(res) };
  },

  async sendTemplate(
    args: SendTemplateArgs,
    ctx?: SendContext,
  ): Promise<SendResult> {
    const creds = readCreds(ctx);
    const body = new URLSearchParams({
      channel: "whatsapp",
      source: creds.source,
      destination: args.to,
      "src.name": creds.appName,
      // Gupshup expects the template payload as a single JSON field
      // alongside the channel routing fields.
      template: JSON.stringify({
        id: args.templateName,
        params: args.bodyParams ?? [],
      }),
    });
    const res = await postToGupshup("/template/msg", creds.apiKey, body);
    return { providerMessageId: unwrapMessageId(res) };
  },
};
