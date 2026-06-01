import { Router, Response, NextFunction } from "express";
import { prismaRead } from "@nexaflow/db";
import { RequestWithAuth } from "../middleware/auth";

const router = Router();

function planFeatures(plan: {
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}): string[] {
  const items = [
    `${plan.messageQuota.toLocaleString("en-IN")} WhatsApp messages / month`,
    `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
    `${plan.agentLimit.toLocaleString("en-IN")} team ${
      plan.agentLimit === 1 ? "seat" : "seats"
    }`,
    `${plan.campaignLimit.toLocaleString("en-IN")} campaigns / month`,
    `${plan.aiCreditsPerMonth.toLocaleString("en-IN")} AI credits / month`,
  ];
  if (plan.chatbotEnabled) items.push("Chatbot and workflow automation");
  if (plan.creativeStudioEnabled) items.push("AI creative studio");
  if (plan.adsIntegrationEnabled) items.push("Ads integrations");
  if (plan.apiAccessEnabled) items.push("API and developer access");
  return items;
}

function defaultDescription(name: string): string {
  switch (name) {
    case "STARTER":
      return "For one business starting with WhatsApp CRM and simple campaigns.";
    case "GROWTH":
      return "For teams adding AI agents, workflows, and stronger governance.";
    case "PRO":
      return "For larger teams scaling campaigns, API access, and advanced automation.";
    case "ENTERPRISE":
      return "For high-volume brands needing custom onboarding and controls.";
    case "CUSTOM":
      return "For agencies and white-label operators managing many clients.";
    default:
      return "Managed from the SuperAdmin plan catalog.";
  }
}

// GET /api/v1/pricing/plans
// Public plan catalog for the marketing site. SuperAdmin edits the same Plan
// rows from /billing, so changes reflect on the homepage/pricing pages.
router.get(
  "/plans",
  async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const plans = await prismaRead.plan.findMany({
        orderBy: [{ priceInPaisa: "asc" }, { name: "asc" }],
      });

      res.json({
        success: true,
        data: plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          displayName: plan.displayName,
          description: plan.description ?? defaultDescription(plan.name),
          priceInPaisa: plan.priceInPaisa,
          billingCycle: plan.billingCycle,
          messageQuota: plan.messageQuota,
          contactLimit: plan.contactLimit,
          agentLimit: plan.agentLimit,
          aiCreditsPerMonth: plan.aiCreditsPerMonth,
          campaignLimit: plan.campaignLimit,
          chatbotEnabled: plan.chatbotEnabled,
          adsIntegrationEnabled: plan.adsIntegrationEnabled,
          creativeStudioEnabled: plan.creativeStudioEnabled,
          apiAccessEnabled: plan.apiAccessEnabled,
          features: planFeatures(plan),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
