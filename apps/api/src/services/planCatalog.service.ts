export interface PlanCatalogRecord {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}

export interface PublicPlan extends PlanCatalogRecord {
  description: string;
  features: string[];
}

export function defaultPlanDescription(name: string): string {
  switch (name) {
    case "STARTER":
      return "Free forever workspace for testing NexaFlow with basic CRM, inbox, landing page, and trial AI credits.";
    case "GROWTH":
      return "Basic launch plan for small businesses starting WhatsApp CRM, campaigns, opt-in management, and simple AI content.";
    case "PRO":
      return "Standard growth plan for teams that need advanced CRM, scheduling, chatbot flows, integrations, and more AI usage.";
    case "ENTERPRISE":
      return "Premium automation plan with AI agents, ads assistants, developer connectors, priority support, and higher limits.";
    case "CUSTOM":
      return "Enterprise and large partner plan with custom users, WhatsApp numbers, rates, onboarding, SLA, and white-label options.";
    default:
      return "Managed from the SuperAdmin plan catalog.";
  }
}

export function planFeatures(plan: PlanCatalogRecord): string[] {
  switch (plan.name) {
    case "STARTER":
      return [
        `${plan.agentLimit.toLocaleString("en-IN")} user`,
        `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
        "Pay-as-you-go WhatsApp usage via wallet",
        "Basic CRM and shared inbox",
        "1 landing page on a NexaFlow subdomain",
        "Basic chatbot template and campaign tool",
        "Limited AI trial credits",
        "NexaFlow branding",
      ];
    case "GROWTH":
      return [
        `${plan.agentLimit.toLocaleString("en-IN")} users`,
        "1 WhatsApp number",
        `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
        "CRM pipeline, inbox, campaigns, templates",
        "Opt-in management and basic analytics",
        "3 landing pages and 1 AI single-page website",
        "Basic chatbot builder",
        "25 AI replies, 10 captions, 5 images / month",
        "Customer self-recharge wallet",
      ];
    case "PRO":
      return [
        `${plan.agentLimit.toLocaleString("en-IN")} users`,
        "2 WhatsApp numbers",
        `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
        "Advanced CRM and team assignment inbox",
        "Campaign scheduling and template manager",
        "No-code chatbot builder and basic workflows",
        "10 landing pages with custom domain",
        "200 AI replies, 30 content generations, 20 GMB posts, 20 images / month",
        "Shopify/WooCommerce basic and Google Sheets integration",
      ];
    case "ENTERPRISE":
      return [
        `${plan.agentLimit.toLocaleString("en-IN")} users`,
        "5 WhatsApp numbers",
        `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
        "Advanced CRM, inbox, chatbot, workflow, and landing builders",
        "25 landing pages with custom domain",
        "AI agents and AI website edit option",
        "1,000 AI replies, 100 content generations, 50 images / month",
        "GMB Growth, AI review replies, Meta Ads and Google Ads assistants",
        "API/webhook connector, Developer Hub basic, and priority support",
      ];
    case "CUSTOM":
      return [
        "Large or custom user limits",
        "Multiple WhatsApp numbers and custom provider rates",
        "Partner/customer credit line options",
        "Advanced AI automation and custom workflows",
        "Full API access and white-label options",
        "Custom domains, SMTP/email sender, and security controls",
        "Onboarding, SLA, and optional dedicated account manager",
      ];
    default:
      return [
        "Pay-as-you-go WhatsApp usage via wallet",
        `${plan.contactLimit.toLocaleString("en-IN")} contacts`,
        `${plan.agentLimit.toLocaleString("en-IN")} team ${
          plan.agentLimit === 1 ? "seat" : "seats"
        }`,
        `${plan.campaignLimit.toLocaleString("en-IN")} campaigns / month`,
        `${plan.aiCreditsPerMonth.toLocaleString("en-IN")} AI credits / month`,
      ];
  }
}

export function publicPlan(plan: PlanCatalogRecord | null): PublicPlan | null {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    description: plan.description ?? defaultPlanDescription(plan.name),
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
  };
}
