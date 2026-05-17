import { ApiError, ErrorCodes } from "@nexaflow/shared";

const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

interface SendTextArgs {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}

interface SendTemplateArgs {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; code: number; type?: string };
}

async function postToMeta(
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<MetaSendResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as MetaSendResponse;
  if (!res.ok) {
    const msg = data.error?.message ?? `Meta API error ${res.status}`;
    throw new ApiError(ErrorCodes.BAD_REQUEST, res.status, msg);
  }
  return data;
}

export async function sendWhatsAppText(args: SendTextArgs): Promise<string> {
  const url = `${META_GRAPH_BASE}/${args.phoneNumberId}/messages`;
  const res = await postToMeta(url, args.accessToken, {
    messaging_product: "whatsapp",
    to: args.to,
    type: "text",
    text: { body: args.body, preview_url: false },
  });
  const id = res.messages?.[0]?.id;
  if (!id) throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 502, "No message id returned");
  return id;
}

export async function sendWhatsAppTemplate(args: SendTemplateArgs): Promise<string> {
  const url = `${META_GRAPH_BASE}/${args.phoneNumberId}/messages`;
  const res = await postToMeta(url, args.accessToken, {
    messaging_product: "whatsapp",
    to: args.to,
    type: "template",
    template: {
      name: args.templateName,
      language: { code: args.languageCode ?? "en_US" },
      ...(args.bodyParams && args.bodyParams.length
        ? {
            components: [
              {
                type: "body",
                parameters: args.bodyParams.map((p) => ({ type: "text", text: p })),
              },
            ],
          }
        : {}),
    },
  });
  const id = res.messages?.[0]?.id;
  if (!id) throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 502, "No message id returned");
  return id;
}

export function verifyMetaWebhookSubscription(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
): string | null {
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expected) return null;
  if (mode === "subscribe" && token === expected && challenge) {
    return challenge;
  }
  return null;
}
