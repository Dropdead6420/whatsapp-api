import {
  PrismaClient,
  PlanName,
  ProductAccessSource,
  ProductCategory,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

const PLANS: Array<{
  name: PlanName;
  displayName: string;
  description: string;
  priceInPaisa: number;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}> = [
  {
    name: "STARTER",
    displayName: "Free Forever",
    description:
      "Free forever workspace for testing NexaFlow with basic CRM, inbox, landing page, and trial AI credits.",
    priceInPaisa: 0,
    messageQuota: 1_000_000,
    contactLimit: 100,
    agentLimit: 1,
    aiCreditsPerMonth: 50,
    campaignLimit: 1,
    chatbotEnabled: false,
    adsIntegrationEnabled: false,
    creativeStudioEnabled: false,
    apiAccessEnabled: false,
  },
  {
    name: "GROWTH",
    displayName: "Basic",
    description:
      "Basic launch plan for small businesses starting WhatsApp CRM, campaigns, opt-in management, and simple AI content.",
    priceInPaisa: 149_900,
    messageQuota: 1_000_000,
    contactLimit: 1_000,
    agentLimit: 2,
    aiCreditsPerMonth: 200,
    campaignLimit: 20,
    chatbotEnabled: true,
    adsIntegrationEnabled: false,
    creativeStudioEnabled: true,
    apiAccessEnabled: false,
  },
  {
    name: "PRO",
    displayName: "Standard",
    description:
      "Standard growth plan for teams that need advanced CRM, scheduling, chatbot flows, integrations, and more AI usage.",
    priceInPaisa: 399_900,
    messageQuota: 1_000_000,
    contactLimit: 10_000,
    agentLimit: 5,
    aiCreditsPerMonth: 1_000,
    campaignLimit: 100,
    chatbotEnabled: true,
    adsIntegrationEnabled: false,
    creativeStudioEnabled: true,
    apiAccessEnabled: false,
  },
  {
    name: "ENTERPRISE",
    displayName: "Premium",
    description:
      "Premium automation plan with AI agents, ads assistants, developer connectors, priority support, and higher limits.",
    priceInPaisa: 899_900,
    messageQuota: 1_000_000,
    contactLimit: 50_000,
    agentLimit: 15,
    aiCreditsPerMonth: 3_500,
    campaignLimit: 500,
    chatbotEnabled: true,
    adsIntegrationEnabled: true,
    creativeStudioEnabled: true,
    apiAccessEnabled: true,
  },
  {
    name: "CUSTOM",
    displayName: "Enterprise",
    description:
      "Enterprise and large partner plan with custom users, WhatsApp numbers, rates, onboarding, SLA, and white-label options.",
    priceInPaisa: 2_499_900,
    messageQuota: 1_000_000,
    contactLimit: 250_000,
    agentLimit: 100,
    aiCreditsPerMonth: 10_000,
    campaignLimit: 2_000,
    chatbotEnabled: true,
    adsIntegrationEnabled: true,
    creativeStudioEnabled: true,
    apiAccessEnabled: true,
  },
];

const PRODUCT_CATALOG: Array<{
  key: string;
  name: string;
  category: ProductCategory;
  description: string;
  routeHref: string;
  featureKey?: string;
  icon: string;
  sortOrder: number;
  addOns?: Array<{
    key: string;
    name: string;
    description: string;
    priceInPaisa: number;
    billingCycle?: string;
  }>;
}> = [
  {
    key: "inbox",
    name: "Inbox",
    category: ProductCategory.CORE,
    description: "Team WhatsApp inbox, routing, notes, labels, and SLA workflow.",
    routeHref: "/dashboard/inbox",
    icon: "inbox",
    sortOrder: 10,
  },
  {
    key: "contacts",
    name: "Contacts",
    category: ProductCategory.CORE,
    description: "Customer CRM, tags, imports, opt-out state, and segmentation base.",
    routeHref: "/dashboard/contacts",
    icon: "users",
    sortOrder: 20,
  },
  {
    key: "campaigns",
    name: "Campaigns",
    category: ProductCategory.MARKETING,
    description: "WhatsApp broadcast campaigns with scheduling, compliance, and analytics.",
    routeHref: "/dashboard/campaigns",
    featureKey: "campaigns",
    icon: "megaphone",
    sortOrder: 30,
  },
  {
    key: "templates",
    name: "Templates",
    category: ProductCategory.MARKETING,
    description: "Meta template library, approval tracking, translation, and AI drafting.",
    routeHref: "/dashboard/templates",
    icon: "file-text",
    sortOrder: 40,
  },
  {
    key: "ai_studio",
    name: "AI Studio",
    category: ProductCategory.AI,
    description: "AI copy generation, campaign variants, scoring, and creative assistance.",
    routeHref: "/ai-studio",
    featureKey: "aiStudio",
    icon: "sparkles",
    sortOrder: 50,
    addOns: [
      {
        key: "extra_ai_credits",
        name: "Extra AI credits",
        description: "Additional monthly AI generation credits for high-volume teams.",
        priceInPaisa: 99_900,
      },
    ],
  },
  {
    key: "ai_agents",
    name: "AI Agents",
    category: ProductCategory.AI,
    description: "Configurable AI agents with knowledge grounding, test runs, and auto-reply.",
    routeHref: "/dashboard/ai-agents",
    featureKey: "aiAgents",
    icon: "bot",
    sortOrder: 60,
  },
  {
    key: "workflow_builder",
    name: "Workflow Builder",
    category: ProductCategory.AUTOMATION,
    description: "Visual workflow builder, runtime, scheduler, and audited flow runs.",
    routeHref: "/dashboard/workflow-builder",
    featureKey: "flows",
    icon: "workflow",
    sortOrder: 70,
  },
  {
    key: "chatbot_builder",
    name: "Chatbot Builder",
    category: ProductCategory.AUTOMATION,
    description: "No-code WhatsApp chatbot flows with triggers and node-level configuration.",
    routeHref: "/dashboard/chatbot-builder",
    featureKey: "flows",
    icon: "message-square",
    sortOrder: 80,
  },
  {
    key: "wallet",
    name: "Wallet / Recharge",
    category: ProductCategory.BILLING,
    description: "Customer wallets, recharge, usage ledgers, and billing safety controls.",
    routeHref: "/dashboard/wallet",
    icon: "wallet",
    sortOrder: 90,
  },
  {
    key: "analytics",
    name: "Analytics",
    category: ProductCategory.CORE,
    description: "Campaign, inbox, revenue, wallet, and customer health reporting.",
    routeHref: "/dashboard/analytics",
    icon: "bar-chart",
    sortOrder: 100,
  },
  {
    key: "developer_hub",
    name: "Developer Hub",
    category: ProductCategory.DEVELOPER,
    description: "API keys, public API docs, webhooks, sandbox, and developer logs.",
    routeHref: "/developer",
    featureKey: "developerPortal",
    icon: "code",
    sortOrder: 110,
    addOns: [
      {
        key: "developer_api",
        name: "Developer API access",
        description: "Higher API rate limits and advanced webhook tooling.",
        priceInPaisa: 149_900,
      },
    ],
  },
  {
    key: "compliance",
    name: "Compliance Firewall",
    category: ProductCategory.COMPLIANCE,
    description: "AI-assisted WhatsApp policy checks, overrides, and audit trail.",
    routeHref: "/compliance",
    featureKey: "complianceFirewall",
    icon: "shield",
    sortOrder: 120,
  },
  {
    key: "appointments",
    name: "Appointments",
    category: ProductCategory.CORE,
    description: "Service catalog, customer booking links, reminders, and confirmations.",
    routeHref: "/appointments",
    featureKey: "appointments",
    icon: "calendar",
    sortOrder: 130,
  },
  {
    key: "ads",
    name: "Ads",
    category: ProductCategory.MARKETING,
    description: "Meta and Google Ads connections, lead sync, audiences, and reports.",
    routeHref: "/meta-ads",
    featureKey: "adsIntegration",
    icon: "target",
    sortOrder: 140,
    addOns: [
      {
        key: "ads_assistant",
        name: "Ads AI assistant",
        description: "AI campaign copy, targeting prompts, and budget recommendations.",
        priceInPaisa: 249_900,
      },
    ],
  },
  {
    key: "retention",
    name: "Retention Engine",
    category: ProductCategory.AI,
    description: "AI contact health scoring, win-back suggestions, and autopilot actions.",
    routeHref: "/retention",
    featureKey: "retentionEngine",
    icon: "refresh",
    sortOrder: 150,
  },
  {
    key: "webhooks",
    name: "Webhooks",
    category: ProductCategory.INTEGRATION,
    description: "Signed outbound webhooks with retries, delivery logs, and event registry.",
    routeHref: "/webhooks",
    featureKey: "webhooks",
    icon: "plug",
    sortOrder: 160,
  },
  {
    key: "knowledge_base",
    name: "Knowledge Base",
    category: ProductCategory.AI,
    description: "Tenant knowledge entries, categories, tags, embeddings, and retrieval.",
    routeHref: "/knowledge-base",
    featureKey: "knowledgeBase",
    icon: "book-open",
    sortOrder: 170,
  },
  {
    key: "support",
    name: "Support",
    category: ProductCategory.SUPPORT,
    description: "Support tickets, escalation workflow, and help center operations.",
    routeHref: "/dashboard/support",
    icon: "life-buoy",
    sortOrder: 180,
  },
];

const LAUNCH_CURRENCIES: Array<{
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  displayOrder: number;
}> = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", minorUnit: 2, displayOrder: 10 },
  { code: "USD", name: "US Dollar", symbol: "$", minorUnit: 2, displayOrder: 20 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnit: 2, displayOrder: 30 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", minorUnit: 2, displayOrder: 40 },
  { code: "GBP", name: "British Pound", symbol: "£", minorUnit: 2, displayOrder: 50 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnit: 2, displayOrder: 60 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnit: 2, displayOrder: 70 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", minorUnit: 2, displayOrder: 80 },
];

const LAUNCH_LANGUAGES: Array<{
  code: string;
  name: string;
  nativeName: string;
  direction: "LTR" | "RTL";
  displayOrder: number;
}> = [
  { code: "en", name: "English", nativeName: "English", direction: "LTR", displayOrder: 10 },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", direction: "LTR", displayOrder: 20 },
  { code: "ur", name: "Urdu", nativeName: "اردو", direction: "RTL", displayOrder: 30 },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", direction: "LTR", displayOrder: 40 },
  { code: "ar", name: "Arabic", nativeName: "العربية", direction: "RTL", displayOrder: 50 },
  { code: "fr", name: "French", nativeName: "Français", direction: "LTR", displayOrder: 60 },
  { code: "es", name: "Spanish", nativeName: "Español", direction: "LTR", displayOrder: 70 },
  { code: "de", name: "German", nativeName: "Deutsch", direction: "LTR", displayOrder: 80 },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", direction: "LTR", displayOrder: 90 },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", direction: "LTR", displayOrder: 100 },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", direction: "LTR", displayOrder: 110 },
  { code: "mr", name: "Marathi", nativeName: "मराठी", direction: "LTR", displayOrder: 120 },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", direction: "LTR", displayOrder: 130 },
];

async function seedCurrencies() {
  for (const currency of LAUNCH_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {
        name: currency.name,
        symbol: currency.symbol,
        minorUnit: currency.minorUnit,
        isActive: true,
        isLaunchCurrency: true,
        displayOrder: currency.displayOrder,
      },
      create: {
        ...currency,
        isActive: true,
        isLaunchCurrency: true,
      },
    });
  }
  console.log(`✓ Seeded ${LAUNCH_CURRENCIES.length} currencies`);
}

async function seedLanguages() {
  for (const language of LAUNCH_LANGUAGES) {
    await prisma.language.upsert({
      where: { code: language.code },
      update: {
        name: language.name,
        nativeName: language.nativeName,
        direction: language.direction,
        isActive: true,
        isLaunchLanguage: true,
        displayOrder: language.displayOrder,
      },
      create: {
        ...language,
        isActive: true,
        isLaunchLanguage: true,
      },
    });
  }
  console.log(`✓ Seeded ${LAUNCH_LANGUAGES.length} languages`);
}

async function seedPlans() {
  for (const plan of PLANS) {
    const existing = await prisma.plan.findFirst({ where: { name: plan.name } });
    if (existing) {
      await prisma.plan.update({
        where: { id: existing.id },
        data: { ...plan, billingCycle: "monthly" },
      });
    } else {
      await prisma.plan.create({ data: { ...plan, billingCycle: "monthly" } });
    }
  }
  console.log(`✓ Seeded ${PLANS.length} plans`);
}

async function seedProducts() {
  for (const product of PRODUCT_CATALOG) {
    const { addOns, ...data } = product;
    const saved = await prisma.product.upsert({
      where: { key: product.key },
      update: {
        ...data,
        isGlobalEnabled: true,
        metadata: {
          seededFrom: "NexaFlow Complete Feature Implementation PDF",
          publicTerminology: "Customer",
          internalTerminology: "Tenant",
        },
      },
      create: {
        ...data,
        isGlobalEnabled: true,
        metadata: {
          seededFrom: "NexaFlow Complete Feature Implementation PDF",
          publicTerminology: "Customer",
          internalTerminology: "Tenant",
        },
      },
    });

    for (const addOn of addOns ?? []) {
      await prisma.productAddOn.upsert({
        where: {
          productId_key: {
            productId: saved.id,
            key: addOn.key,
          },
        },
        update: {
          name: addOn.name,
          description: addOn.description,
          priceInPaisa: addOn.priceInPaisa,
          billingCycle: addOn.billingCycle ?? "monthly",
          isActive: true,
          metadata: { seeded: true },
        },
        create: {
          productId: saved.id,
          key: addOn.key,
          name: addOn.name,
          description: addOn.description,
          priceInPaisa: addOn.priceInPaisa,
          billingCycle: addOn.billingCycle ?? "monthly",
          isActive: true,
          metadata: { seeded: true },
        },
      });
    }
  }
  console.log(`✓ Seeded ${PRODUCT_CATALOG.length} marketplace products`);
}

async function seedPartnerProductAccess() {
  const [partners, products] = await Promise.all([
    prisma.tenant.findMany({
      where: {
        type: TenantType.WHITE_LABEL,
        status: { not: TenantStatus.DELETED },
      },
      select: { id: true },
    }),
    prisma.product.findMany({ select: { id: true } }),
  ]);

  for (const partner of partners) {
    for (const product of products) {
      await prisma.partnerProductAccess.upsert({
        where: {
          partnerTenantId_productId: {
            partnerTenantId: partner.id,
            productId: product.id,
          },
        },
        update: {},
        create: {
          partnerTenantId: partner.id,
          productId: product.id,
          enabled: true,
          source: ProductAccessSource.SUPER_ADMIN,
          limits: {
            seeded: true,
            note: "Default launch entitlement for existing partners",
          },
        },
      });
    }
  }

  console.log(
    `✓ Seeded ${partners.length * products.length} partner product entitlements`,
  );
}

async function seedSuperAdmin() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@nexaflow.local").toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe!123";

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`✓ Super admin already exists: ${email}`);
    return;
  }

  const platform = await prisma.tenant.upsert({
    where: { domain: "platform.nexaflow.local" },
    update: {},
    create: {
      name: "NexaFlow Platform",
      type: TenantType.DIRECT,
      status: TenantStatus.ACTIVE,
      domain: "platform.nexaflow.local",
    },
  });

  await prisma.user.create({
    data: {
      email,
      name: "Platform Admin",
      password: await bcryptjs.hash(password, 12),
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: new Date(),
      tenantId: platform.id,
    },
  });

  console.log(`✓ Super admin created: ${email} / ${password}`);
  console.log(`  (Override via SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD env vars)`);
}

const FLOW_TEMPLATES: Array<{
  slug: string;
  name: string;
  industry: string;
  description: string;
  definition: object;
}> = [
  {
    slug: "salon-booking",
    name: "Salon booking assistant",
    industry: "salon",
    description: "Greets customers, captures booking intent, tags price inquiries.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "greet" },
        {
          id: "greet",
          type: "MESSAGE",
          config: {
            text: "Hi! I can help you book at our salon. Reply BOOK for slots or PRICES for our menu.",
          },
          next: "wait",
        },
        { id: "wait", type: "WAIT_FOR_REPLY", config: {}, next: "classify" },
        {
          id: "classify",
          type: "AI_CLASSIFY_INTENT",
          config: { labels: ["book", "prices", "general"] },
          branches: { book: "book_tag", prices: "price_tag", default: "end" },
        },
        { id: "book_tag", type: "ADD_TAG", config: { tag: "booking_intent" }, next: "end" },
        { id: "price_tag", type: "ADD_TAG", config: { tag: "price_inquiry" }, next: "end" },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
  {
    slug: "clinic-reminders",
    name: "Clinic appointment reminders",
    industry: "clinic",
    description: "Triggered when an appointment is booked; sends confirmation template.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "confirm" },
        {
          id: "confirm",
          type: "MESSAGE",
          config: {
            text: "Your appointment is confirmed for {{scheduledAt}}. Reply RESCHEDULE if you need to change.",
          },
          next: "end",
        },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
  {
    slug: "ecommerce-order-tracking",
    name: "E-commerce order tracking",
    industry: "ecommerce",
    description: "Keyword flow for order status inquiries.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "ask" },
        {
          id: "ask",
          type: "MESSAGE",
          config: { text: "Please share your order ID (e.g. ORD-12345) and we'll update you." },
          next: "extract",
        },
        { id: "extract", type: "AI_EXTRACT_DATA", config: { fields: ["orderId"] }, next: "tag" },
        { id: "tag", type: "ADD_TAG", config: { tag: "order_inquiry" }, next: "end" },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
  {
    slug: "real-estate-lead",
    name: "Real estate lead qualification",
    industry: "real_estate",
    description: "Qualifies budget and creates a lead from conversation.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "intro" },
        {
          id: "intro",
          type: "MESSAGE",
          config: { text: "Thanks for your interest! What's your budget range and preferred location?" },
          next: "wait",
        },
        { id: "wait", type: "WAIT_FOR_REPLY", config: {}, next: "lead" },
        {
          id: "lead",
          type: "CREATE_LEAD",
          config: { title: "Property inquiry — {{triggerText}}" },
          next: "end",
        },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
  {
    slug: "coaching-inquiry",
    name: "Coaching inquiry follow-up",
    industry: "coaching",
    description: "Tags coaching leads and suggests AI reply.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "tag" },
        { id: "tag", type: "ADD_TAG", config: { tag: "coaching_lead" }, next: "ai" },
        { id: "ai", type: "AI_RESPONSE", config: { autoSend: false }, next: "end" },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
  {
    slug: "payment-follow-up",
    name: "Payment follow-up",
    industry: "payments",
    description: "Polite payment reminder with compliance check.",
    definition: {
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "check" },
        {
          id: "check",
          type: "AI_COMPLIANCE_CHECK",
          config: { text: "Reminder: your invoice is due. Reply PAID once completed." },
          next: "send",
        },
        {
          id: "send",
          type: "MESSAGE",
          config: { text: "Reminder: your invoice is due. Reply PAID once completed." },
          next: "end",
        },
        { id: "end", type: "END", config: {} },
      ],
    },
  },
];

async function seedFlowTemplates() {
  for (const tpl of FLOW_TEMPLATES) {
    await prisma.flowTemplate.upsert({
      where: { slug: tpl.slug },
      update: {
        name: tpl.name,
        industry: tpl.industry,
        description: tpl.description,
        definition: JSON.stringify(tpl.definition),
        isPublic: true,
      },
      create: {
        slug: tpl.slug,
        name: tpl.name,
        industry: tpl.industry,
        description: tpl.description,
        definition: JSON.stringify(tpl.definition),
        isPublic: true,
      },
    });
  }
  console.log(`✓ Seeded ${FLOW_TEMPLATES.length} flow marketplace templates`);
}

async function main() {
  await seedCurrencies();
  await seedLanguages();
  await seedPlans();
  await seedProducts();
  await seedPartnerProductAccess();
  await seedSuperAdmin();
  await seedFlowTemplates();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
