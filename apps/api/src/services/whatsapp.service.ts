// Back-compat shim. The send logic moved behind the provider abstraction
// in `./whatsapp/` (T-005 step 1, ADR-017). Existing call sites import
// `sendWhatsAppText` / `sendWhatsAppTemplate` from here; new code should
// import from `./whatsapp` directly and use `getWhatsAppProvider()`.

export {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  getWhatsAppProvider,
  type WhatsAppProvider,
} from "./whatsapp";

// Webhook subscription verification is provider-agnostic policy, not a
// send-path operation, so it stays here.
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
