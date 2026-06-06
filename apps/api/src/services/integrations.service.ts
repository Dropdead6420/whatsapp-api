import { prisma, IntegrationProvider, IntegrationStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// Integrations Hub service (Complete Planning PDF §2.22, Phase 11).
// A connector catalog + per-tenant connections. Non-secret config is
// stored on the Integration row; credentials are referenced by secretId
// in the encrypted Secret Vault. Per-connector data sync lands later.
// =====================================================================

export type ConnectorAuth = "apikey" | "oauth" | "webhook";
export type ConnectorCategory =
  | "ecommerce"
  | "productivity"
  | "automation"
  | "payments"
  | "custom";

export interface Connector {
  provider: IntegrationProvider;
  name: string;
  category: ConnectorCategory;
  authType: ConnectorAuth;
  description: string;
}

/** Static catalog of available integrations (pure). */
export const CONNECTOR_CATALOG: Connector[] = [
  { provider: IntegrationProvider.SHOPIFY, name: "Shopify", category: "ecommerce", authType: "apikey", description: "Sync orders and customers from your Shopify store." },
  { provider: IntegrationProvider.WOOCOMMERCE, name: "WooCommerce", category: "ecommerce", authType: "apikey", description: "Sync orders and customers from WooCommerce." },
  { provider: IntegrationProvider.GOOGLE_SHEETS, name: "Google Sheets", category: "productivity", authType: "oauth", description: "Export leads and contacts to a spreadsheet." },
  { provider: IntegrationProvider.GOOGLE_CALENDAR, name: "Google Calendar", category: "productivity", authType: "oauth", description: "Sync appointments to a calendar." },
  { provider: IntegrationProvider.ZAPIER, name: "Zapier", category: "automation", authType: "webhook", description: "Trigger Zaps from NexaFlow events." },
  { provider: IntegrationProvider.MAKE, name: "Make", category: "automation", authType: "webhook", description: "Trigger Make scenarios from events." },
  { provider: IntegrationProvider.N8N, name: "n8n", category: "automation", authType: "webhook", description: "Trigger n8n workflows from events." },
  { provider: IntegrationProvider.PAYPAL, name: "PayPal", category: "payments", authType: "apikey", description: "Accept payments via PayPal." },
  { provider: IntegrationProvider.PAYU, name: "PayU", category: "payments", authType: "apikey", description: "Accept payments via PayU." },
  { provider: IntegrationProvider.CUSTOM_WEBHOOK, name: "Custom Webhook", category: "custom", authType: "webhook", description: "Send events to any HTTPS endpoint." },
];

export function getConnectorCatalog(): Connector[] {
  return CONNECTOR_CATALOG;
}

export function getConnector(provider: IntegrationProvider): Connector | undefined {
  return CONNECTOR_CATALOG.find((c) => c.provider === provider);
}

interface IntegrationRow {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  label: string;
  config: unknown;
  secretId: string | null;
  externalAccountLabel: string | null;
  status: IntegrationStatus;
  lastSyncedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe view — never exposes the secret itself, only whether one is linked. */
export function toSafeIntegration(row: IntegrationRow) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    config: row.config ?? null,
    hasCredential: Boolean(row.secretId),
    externalAccountLabel: row.externalAccountLabel,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export async function listIntegrations(tenantId: string, status?: IntegrationStatus) {
  const rows = await prisma.integration.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toSafeIntegration);
}

/** Verify a secretId (if given) belongs to the same tenant's vault. */
async function assertSecretOwned(tenantId: string, secretId?: string | null) {
  if (!secretId) return;
  const secret = await prisma.secretVaultEntry.findFirst({
    where: { id: secretId, tenantId },
    select: { id: true },
  });
  if (!secret) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Referenced secret was not found in your vault.",
    );
  }
}

export interface ConnectInput {
  provider: IntegrationProvider;
  label?: string;
  config?: unknown;
  secretId?: string | null;
  externalAccountLabel?: string;
  createdByUserId?: string;
}

export async function connectIntegration(tenantId: string, input: ConnectInput) {
  const connector = getConnector(input.provider);
  if (!connector) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Unknown integration provider.");
  }
  await assertSecretOwned(tenantId, input.secretId);

  const row = await prisma.integration.create({
    data: {
      tenantId,
      provider: input.provider,
      label: input.label?.trim() || connector.name,
      config: (input.config ?? undefined) as object | undefined,
      secretId: input.secretId ?? null,
      externalAccountLabel: input.externalAccountLabel?.trim() || null,
      status: IntegrationStatus.CONNECTED,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeIntegration(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.integration.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Integration not found.");
  return row;
}

export async function getIntegration(tenantId: string, id: string) {
  return toSafeIntegration(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateIntegrationInput {
  label?: string;
  config?: unknown;
  secretId?: string | null;
  externalAccountLabel?: string | null;
  status?: IntegrationStatus;
}

export async function updateIntegration(
  tenantId: string,
  id: string,
  input: UpdateIntegrationInput,
) {
  await findOwnedOrThrow(tenantId, id);
  if (input.secretId !== undefined) await assertSecretOwned(tenantId, input.secretId);
  const row = await prisma.integration.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.config !== undefined ? { config: (input.config ?? undefined) as object | undefined } : {}),
      ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
      ...(input.externalAccountLabel !== undefined
        ? { externalAccountLabel: input.externalAccountLabel }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return toSafeIntegration(row);
}

export async function disconnectIntegration(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  await prisma.integration.delete({ where: { id } });
}
