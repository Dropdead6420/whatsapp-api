// WhatsApp provider abstraction (T-005, ADR-007).
//
// Every BSP — Meta Cloud, Gupshup, 360dialog, Twilio, Haptik — speaks a
// different API shape for the same logical operations. This interface
// pins the contract so the rest of the codebase (campaign worker,
// appointment worker, conversation reply, flow MESSAGE node, etc.) never
// has to know which provider is in use.
//
// The factory in `./index.ts` is the only place that picks a provider;
// no call site outside that file imports a provider module directly.

export interface SendTextArgs {
  /** Sender's WABA phone number id (Meta) or equivalent route id. */
  phoneNumberId: string;
  /** Provider-issued access token (already decrypted at the call site). */
  accessToken: string;
  /** Recipient phone (E.164, no leading "+"). */
  to: string;
  /** Plain text body, ≤ 4096 chars per WhatsApp limits. */
  body: string;
}

export interface SendTemplateArgs {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
}

/**
 * Stable, provider-agnostic shape returned by every send. Today only the
 * provider's own message id matters; quoted shape leaves room for future
 * fields (e.g. status hints) without changing call sites.
 */
export interface SendResult {
  /** The id we use as `Message.metaMessageId` — kept named for back-compat. */
  providerMessageId: string;
}

/** Future surface area (template management, profile sync, ratings).
 *  Documented here so provider authors implement a consistent shape; not
 *  required for the Meta-only baseline since those flows still live in
 *  `whatsappConfig.service.ts`. */
export interface ProviderCapabilities {
  /** Friendly key for routing decisions + audit logs. */
  readonly key: "meta" | "gupshup" | "360dialog" | "twilio" | "haptik";
  /** True when the provider supports media uploads natively. */
  readonly supportsMedia: boolean;
}

/**
 * Per-call context the factory passes to an adapter. Today it only
 * carries the decrypted `ProviderRoute.config` blob; future fields
 * (e.g. tenant brand, audit metadata) extend the same object so the
 * interface stays stable.
 */
export interface SendContext {
  /** Decrypted, JSON-parsed `ProviderRoute.config`. NULL when the
   *  caller is using env-only configuration (the Meta adapter never
   *  needs this; Gupshup / 360dialog / Twilio prefer it). */
  config?: Record<string, unknown> | null;
}

export interface WhatsAppProvider extends ProviderCapabilities {
  sendText(args: SendTextArgs, ctx?: SendContext): Promise<SendResult>;
  sendTemplate(args: SendTemplateArgs, ctx?: SendContext): Promise<SendResult>;
}
