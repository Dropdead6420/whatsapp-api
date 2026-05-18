import { prisma, WhatsAppProviderKey } from "@nexaflow/db";
import type {
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";
import { metaProvider } from "./providers/meta";

// Factory + back-compat thin wrappers (T-005 steps 1 + 2).
//
// Step 2 (this commit) consults the `ProviderRoute` table when a
// tenantId is in scope: the call site passes `{ tenantId, phoneNumberId? }`
// and the factory picks the matching adapter. No row → Meta fallback.
// Callers without tenant context (legacy paths, internal probes) still
// get Meta directly.
//
// The ProviderRoute table is the single source of truth for routing.
// No call site outside this module looks at provider keys.

const ADAPTERS: Partial<Record<WhatsAppProviderKey, WhatsAppProvider>> = {
  [WhatsAppProviderKey.META]: metaProvider,
  // Future: gupshup, dialog360, twilio, haptik adapters land here.
};

export interface ProviderSelector {
  tenantId?: string;
  /** WABA phone number id; lets a tenant pin different numbers to
   *  different providers (e.g. a primary BSP + a fallback). */
  phoneNumberId?: string;
}

/**
 * Resolve which provider handles a send. Lookup order:
 *
 *   1. Active route matching (tenantId, phoneNumberId) exactly.
 *   2. Active route for the tenant with NULL phoneNumberId (default).
 *   3. Meta Cloud (built-in fallback).
 *
 * Unknown providerKey entries (e.g. a future provider that isn't
 * implemented in this build) also fall back to Meta with a warning;
 * the operator sees the misconfiguration without losing traffic.
 */
export async function getWhatsAppProvider(
  selector?: ProviderSelector,
): Promise<WhatsAppProvider> {
  const tenantId = selector?.tenantId;
  if (!tenantId) return metaProvider;

  try {
    const row =
      (selector?.phoneNumberId
        ? await prisma.providerRoute.findFirst({
            where: {
              tenantId,
              phoneNumberId: selector.phoneNumberId,
              isActive: true,
            },
          })
        : null) ??
      (await prisma.providerRoute.findFirst({
        where: { tenantId, phoneNumberId: null, isActive: true },
      }));

    if (!row) return metaProvider;
    const adapter = ADAPTERS[row.providerKey];
    if (!adapter) {
      console.warn(
        `[whatsapp:factory] provider ${row.providerKey} routed for tenant ${tenantId} but no adapter is registered; falling back to Meta.`,
      );
      return metaProvider;
    }
    return adapter;
  } catch (err) {
    // DB hiccup — fall back rather than fail the send.
    console.warn(
      "[whatsapp:factory] ProviderRoute lookup failed; falling back to Meta:",
      (err as Error).message,
    );
    return metaProvider;
  }
}

/** Synchronous accessor for tests / internal paths that already know they
 *  want Meta. New code should prefer the async `getWhatsAppProvider`. */
export function getDefaultProvider(): WhatsAppProvider {
  return metaProvider;
}

/** Back-compat: forwards through the factory. Callers can now pass
 *  `tenantId` (and optionally `phoneNumberId`) to opt into routing. */
export async function sendWhatsAppText(
  args: SendTextArgs & ProviderSelector,
): Promise<string> {
  const provider = await getWhatsAppProvider({
    tenantId: args.tenantId,
    phoneNumberId: args.phoneNumberId,
  });
  const result: SendResult = await provider.sendText({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    body: args.body,
  });
  return result.providerMessageId;
}

/** Back-compat: forwards through the factory. */
export async function sendWhatsAppTemplate(
  args: SendTemplateArgs & ProviderSelector,
): Promise<string> {
  const provider = await getWhatsAppProvider({
    tenantId: args.tenantId,
    phoneNumberId: args.phoneNumberId,
  });
  const result: SendResult = await provider.sendTemplate({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    templateName: args.templateName,
    languageCode: args.languageCode,
    bodyParams: args.bodyParams,
  });
  return result.providerMessageId;
}

export type { WhatsAppProvider, SendTextArgs, SendTemplateArgs, SendResult };
