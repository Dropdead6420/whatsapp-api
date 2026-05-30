import { Response, NextFunction } from "express";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { RequestWithAuth } from "../middleware/auth";

/**
 * Per-tenant feature flags.
 *
 * Tenant.featuresEnabled is a JSON string with a shape like:
 *   { "aiStudio": true, "autopilot": false, "flows": true, "webhooks": true }
 *
 * Any feature NOT present in the JSON defaults to ENABLED — so existing
 * tenants keep working without us having to backfill the column.
 *
 * SuperAdmin can toggle features per tenant from the tenant detail page.
 */

export type FeatureKey =
  | "aiStudio"        // AI copy generator (/api/v1/ai/copy)
  | "smartSegment"    // AI smart segmentation (/api/v1/ai/segment)
  | "leadScoring"     // AI lead scoring (/api/v1/ai/score-contact)
  | "followUpRecommendations" // AI follow-up recommendations on leads
  | "knowledgeBase"  // Tenant AI knowledge base + retrieval
  | "aiAgents"       // AI Agent Builder (T-052) — configurable agents that auto-handle conversations
  | "replySuggest"    // AI reply suggestions (/api/v1/ai/reply-suggestions)
  | "sentiment"       // AI sentiment (/api/v1/ai/sentiment)
  | "autopilot"       // Campaign autopilot (/api/v1/ai/autopilot/*)
  | "flows"           // Visual flow builder + runtime
  | "webhooks"        // Outbound webhook subscriptions
  | "appointments"    // Appointment booking
  | "campaigns"       // Broadcast campaigns
  | "complianceFirewall" // Compliance Firewall checks + review UI
  | "retentionEngine" // AI contact retention / win-back engine (/api/v1/retention)
  | "demoToPaid"     // Demo-to-paid recommendation engine for partners
  | "developerPortal" // API keys, webhooks, docs, sandbox
  | "adsIntegration"; // Meta/Google ads (future)

export const ALL_FEATURES: FeatureKey[] = [
  "aiStudio",
  "smartSegment",
  "leadScoring",
  "followUpRecommendations",
  "knowledgeBase",
  "aiAgents",
  "replySuggest",
  "sentiment",
  "autopilot",
  "flows",
  "webhooks",
  "appointments",
  "campaigns",
  "complianceFirewall",
  "retentionEngine",
  "demoToPaid",
  "developerPortal",
  "adsIntegration",
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  aiStudio: "AI Copy Studio",
  smartSegment: "AI Smart Segmentation",
  leadScoring: "AI Lead Scoring",
  followUpRecommendations: "AI Follow-up Recommendations",
  knowledgeBase: "AI Knowledge Base",
  aiAgents: "AI Agent Builder",
  replySuggest: "AI Reply Suggestions",
  sentiment: "AI Sentiment Analysis",
  autopilot: "Campaign Autopilot",
  flows: "Visual Flow Builder",
  webhooks: "Outbound Webhooks",
  appointments: "Appointment Booking",
  campaigns: "Broadcast Campaigns",
  complianceFirewall: "Compliance Firewall",
  retentionEngine: "AI Retention Engine",
  demoToPaid: "Demo-to-Paid Engine",
  developerPortal: "Developer/API Portal",
  adsIntegration: "Ads Integration",
};

function parseFeatures(raw: string | null): Partial<Record<FeatureKey, boolean>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Partial<Record<FeatureKey, boolean>> = {};
    for (const key of ALL_FEATURES) {
      const v = parsed[key];
      if (typeof v === "boolean") result[key] = v;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolve all features for a tenant. Missing keys default to true.
 */
export async function getTenantFeatures(
  tenantId: string,
): Promise<Record<FeatureKey, boolean>> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { featuresEnabled: true },
  });
  const partial = parseFeatures(tenant?.featuresEnabled ?? null);
  const result = {} as Record<FeatureKey, boolean>;
  for (const key of ALL_FEATURES) {
    result[key] = partial[key] !== false; // default true
  }
  return result;
}

export async function setTenantFeatures(
  tenantId: string,
  updates: Partial<Record<FeatureKey, boolean>>,
): Promise<Record<FeatureKey, boolean>> {
  const current = await getTenantFeatures(tenantId);
  const merged = { ...current, ...updates };
  // Only store the keys that differ from default-true to keep JSON small.
  const stored: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of ALL_FEATURES) {
    if (merged[key] === false) stored[key] = false;
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { featuresEnabled: JSON.stringify(stored) },
  });
  return merged;
}

/**
 * Middleware factory: ensures a feature is enabled for the request's tenant.
 * Throws 403 with a clear message when disabled.
 */
export function requireFeature(feature: FeatureKey) {
  return async (
    req: RequestWithAuth,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.tenantId) {
      return next(
        new ApiError(
          ErrorCodes.MULTI_TENANT_VIOLATION,
          400,
          "Tenant scope required.",
        ),
      );
    }
    try {
      const flags = await getTenantFeatures(req.tenantId);
      if (!flags[feature]) {
        return next(
          new ApiError(
            ErrorCodes.FORBIDDEN,
            403,
            `Feature "${FEATURE_LABELS[feature]}" is disabled for this tenant.`,
          ),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
