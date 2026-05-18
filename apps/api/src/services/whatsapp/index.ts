import { prisma, WhatsAppProviderKey } from "@nexaflow/db";
import type {
  SendContext,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";
import { metaProvider } from "./providers/meta";
import { gupshupProvider } from "./providers/gupshup";
import { decryptTokenIfNeeded } from "../../lib/tokenCrypto";

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
  [WhatsAppProviderKey.GUPSHUP]: gupshupProvider,
  // Future: dialog360, twilio, haptik adapters land here.
};

export interface ProviderSelector {
  tenantId?: string;
  /** WABA phone number id; lets a tenant pin different numbers to
   *  different providers (e.g. a primary BSP + a fallback). */
  phoneNumberId?: string;
}

/**
 * Wrap an adapter so its sends carry the route's decrypted config
 * without the caller having to pass it. Keeps the returned object
 * shape-compatible with WhatsAppProvider so existing call sites
 * (sendWhatsAppText / sendWhatsAppTemplate wrappers) don't change.
 */
function bindContext(
  adapter: WhatsAppProvider,
  config: SendContext["config"],
): WhatsAppProvider {
  if (!config) return adapter;
  const ctx: SendContext = { config };
  return {
    key: adapter.key,
    supportsMedia: adapter.supportsMedia,
    sendText: (args) => adapter.sendText(args, ctx),
    sendTemplate: (args) => adapter.sendTemplate(args, ctx),
  };
}

/** Decrypt + JSON-parse ProviderRoute.config. Returns null on any
 *  failure (decrypt error, malformed JSON) — the adapter then falls
 *  back to its env-based credentials path. */
function parseRouteConfig(raw: string | null | undefined): SendContext["config"] {
  if (!raw) return null;
  try {
    const decrypted = decryptTokenIfNeeded(raw);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve which provider handles a send. Lookup order:
 *
 *   1. Active route matching (tenantId, phoneNumberId) exactly.
 *   2. Active route for the tenant with NULL phoneNumberId (default).
 *   3. Meta Cloud (built-in fallback).
 *
 * When a route row carries a `config` blob, it's decrypted + bound
 * into the returned provider so the adapter receives it via `ctx`
 * on every send. Decrypt / parse failures degrade silently to the
 * adapter's env-based credentials path.
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
    return bindContext(adapter, parseRouteConfig(row.config));
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
