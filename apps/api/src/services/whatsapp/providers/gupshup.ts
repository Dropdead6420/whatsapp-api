import { ApiError, ErrorCodes } from "@nexaflow/shared";
import type {
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "../types";

// Gupshup BSP adapter — T-005c, first non-Meta provider.
//
// API surface differs from Meta:
//   - Endpoint: https://api.gupshup.io/wa/api/v1/msg
//   - Auth: `apikey` header (not Bearer)
//   - Body: application/x-www-form-urlencoded (not JSON)
//   - Sender identity comes from the configured `source` phone, not Meta's
//     phoneNumberId. We keep the SendTextArgs.phoneNumberId in the
//     interface — Gupshup ignores it; the `source` is read from
//     GUPSHUP_SOURCE env (or ProviderRoute.config in a future iteration).
//
// Credentials today come from env:
//   - GUPSHUP_API_KEY  — required
//   - GUPSHUP_APP_NAME — required (the Gupshup app id / src.name)
//   - GUPSHUP_SOURCE   — required (the WABA-registered phone, E.164 no +)
//
// Per-tenant config from ProviderRoute.config lands in T-005d; env-only
// is enough to validate the wire format and prove the interface
// boundary holds.

const GUPSHUP_API_BASE =
  process.env.GUPSHUP_API_BASE_URL ?? "https://api.gupshup.io/wa/api/v1";

interface GupshupCreds {
  apiKey: string;
  appName: string;
  source: string;
}

function readEnvCreds(): GupshupCreds {
  const apiKey = process.env.GUPSHUP_API_KEY;
  const appName = process.env.GUPSHUP_APP_NAME;
  const source = process.env.GUPSHUP_SOURCE;
  if (!apiKey || !appName || !source) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Gupshup adapter is not configured. Set GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_SOURCE (per-tenant route config lands in T-005d).",
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

  async sendText(args: SendTextArgs): Promise<SendResult> {
    const creds = readEnvCreds();
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

  async sendTemplate(args: SendTemplateArgs): Promise<SendResult> {
    const creds = readEnvCreds();
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
