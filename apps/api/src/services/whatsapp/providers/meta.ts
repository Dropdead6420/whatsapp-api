import { ApiError, ErrorCodes } from "@nexaflow/shared";
import type {
  SendContext,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "../types";

// Meta adapter doesn't consume ctx.config — credentials still live on the
// Tenant row (wabaAccessToken etc.). The arg is accepted for interface
// uniformity with the other BSP adapters.

// Meta Cloud API adapter — verbatim port of the previous
// services/whatsapp.service.ts behavior, behind the WhatsAppProvider
// interface. No changes to the wire format; this is a pure refactor so
// existing tenants and recorded `Message.metaMessageId`s stay valid.

const META_GRAPH_BASE =
  process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0";

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

function unwrapMessageId(res: MetaSendResponse): string {
  const id = res.messages?.[0]?.id;
  if (!id) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "No message id returned",
    );
  }
  return id;
}

export const metaProvider: WhatsAppProvider = {
  key: "meta",
  supportsMedia: true,

  async sendText(args: SendTextArgs, _ctx?: SendContext): Promise<SendResult> {
    const url = `${META_GRAPH_BASE}/${args.phoneNumberId}/messages`;
    const res = await postToMeta(url, args.accessToken, {
      messaging_product: "whatsapp",
      to: args.to,
      type: "text",
      text: { body: args.body, preview_url: false },
    });
    return { providerMessageId: unwrapMessageId(res) };
  },

  async sendTemplate(
    args: SendTemplateArgs,
    _ctx?: SendContext,
  ): Promise<SendResult> {
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
                  parameters: args.bodyParams.map((p) => ({
                    type: "text",
                    text: p,
                  })),
                },
              ],
            }
          : {}),
      },
    });
    return { providerMessageId: unwrapMessageId(res) };
  },
};
