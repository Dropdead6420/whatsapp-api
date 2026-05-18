import type {
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";
import { metaProvider } from "./providers/meta";

// Factory + back-compat thin wrappers (T-005 step 1).
//
// All existing call sites continue importing `sendWhatsAppText` /
// `sendWhatsAppTemplate` / `verifyMetaWebhookSubscription` from
// `services/whatsapp.service.ts`. That module now re-exports these
// wrappers, which forward to the provider returned by
// `getWhatsAppProvider()`. The provider factory currently always
// returns the Meta adapter — the `ProviderRoute` lookup is step 2.

export function getWhatsAppProvider(): WhatsAppProvider {
  return metaProvider;
}

/** Back-compat: returns the provider's message id as a plain string,
 *  matching the legacy `sendWhatsAppText` signature. */
export async function sendWhatsAppText(args: SendTextArgs): Promise<string> {
  const result: SendResult = await getWhatsAppProvider().sendText(args);
  return result.providerMessageId;
}

/** Back-compat: returns the provider's message id as a plain string. */
export async function sendWhatsAppTemplate(
  args: SendTemplateArgs,
): Promise<string> {
  const result: SendResult = await getWhatsAppProvider().sendTemplate(args);
  return result.providerMessageId;
}

export type { WhatsAppProvider, SendTextArgs, SendTemplateArgs, SendResult };
