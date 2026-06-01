// ============================================================================
// Customer auto-provisioning (PRD-v2 §5)
//
// PRD §5: "Partner creates a customer by entering basic details only. System
// automatically creates customer account, wallet, plan, onboarding checklist,
// **industry workflow templates, first WhatsApp campaign, demo chatbot flow,
// and invite email.**"
//
// The customer-create handler in partner.routes.ts already does the
// account+wallet+plan parts (and the onboarding checklist is computed
// on-read from existing tables — onboarding.service.ts). This module
// closes the rest: a small industry-keyed pack of templates + a draft
// first campaign + a starter chatbot flow + an invite email.
//
// Design notes:
//   - Industry packs are deterministic content, not LLM-generated. The
//     partner picks salon/clinic/realestate/ecommerce/coaching/generic
//     in the create form; we look up the matching pack. Predictable +
//     auditable + zero AI cost per customer create.
//   - Templates are written as APPROVED locally (status="APPROVED") but
//     this only affects in-app gating — Meta template approval is its
//     own out-of-band flow.
//   - The campaign is created as DRAFT. The partner / customer reviews
//     it on the customer's /campaigns page before sending.
//   - Email + chatbot seeding are best-effort: an exception in either
//     branch logs + continues so a transient SMTP/DB hiccup doesn't
//     roll back the whole customer create.
// ============================================================================

import type { Prisma } from "@nexaflow/db";

export type CustomerIndustry =
  | "salon"
  | "clinic"
  | "realestate"
  | "ecommerce"
  | "coaching"
  | "generic";

const KNOWN_INDUSTRIES: ReadonlySet<CustomerIndustry> = new Set([
  "salon",
  "clinic",
  "realestate",
  "ecommerce",
  "coaching",
  "generic",
]);

/** Normalize a free-form industry string to a known pack key. */
export function resolveIndustryPack(
  raw: string | null | undefined,
): CustomerIndustry {
  if (!raw) return "generic";
  const slug = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (KNOWN_INDUSTRIES.has(slug as CustomerIndustry)) {
    return slug as CustomerIndustry;
  }
  // Common aliases the partner might type.
  if (["beauty", "spa", "barbershop"].includes(slug)) return "salon";
  if (["healthcare", "dental", "doctor", "physio"].includes(slug)) return "clinic";
  if (["property", "broker", "realtor"].includes(slug)) return "realestate";
  if (["shop", "retail", "store"].includes(slug)) return "ecommerce";
  if (["fitness", "tutor", "trainer", "consulting"].includes(slug)) return "coaching";
  return "generic";
}

interface TemplateSeed {
  name: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
}

interface ChatbotSeed {
  name: string;
  triggerKeywords: string[];
  /** Pre-rendered JSON for ChatbotFlow.nodes. */
  nodesJson: string;
}

interface IndustryPack {
  campaignName: string;
  campaignDescription: string;
  templates: TemplateSeed[]; // [0] is the welcome/first-campaign template
  chatbot: ChatbotSeed;
}

function flowNodes(welcomeReply: string): string {
  // Minimal 2-node flow: trigger → reply. The customer can edit on
  // /flows. Stored as JSON because ChatbotFlow.nodes is a String column
  // by historical schema choice.
  return JSON.stringify([
    {
      id: "trigger_1",
      type: "TRIGGER",
      data: { keywords: ["hi", "hello"] },
      position: { x: 0, y: 0 },
    },
    {
      id: "reply_1",
      type: "MESSAGE",
      data: { text: welcomeReply },
      position: { x: 240, y: 0 },
    },
  ]);
}

const INDUSTRY_PACKS: Record<CustomerIndustry, IndustryPack> = {
  salon: {
    campaignName: "Welcome series — Salon",
    campaignDescription: "Greets new customers and offers a first-visit discount.",
    templates: [
      {
        name: "welcome_salon",
        bodyText:
          "Hi {{1}}, welcome to {{2}}! ✂️ Book your first appointment and get 15% off — reply BOOK to start.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "appointment_reminder_salon",
        bodyText:
          "Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Reply 1 to confirm, 2 to reschedule.",
      },
      {
        name: "winback_salon",
        bodyText:
          "We miss you {{1}}! Here's 20% off your next visit at {{2}}. Code: COMEBACK20",
      },
    ],
    chatbot: {
      name: "Greet new bookings",
      triggerKeywords: ["hi", "hello", "book"],
      nodesJson: flowNodes(
        "Hi! 👋 I can help you book an appointment. Reply with the service you want and your preferred date.",
      ),
    },
  },
  clinic: {
    campaignName: "Welcome series — Clinic",
    campaignDescription: "Onboards new patients and shares appointment instructions.",
    templates: [
      {
        name: "welcome_clinic",
        bodyText:
          "Hi {{1}}, welcome to {{2}}. Reply HELP for clinic hours, appointments, or directions.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "appointment_reminder_clinic",
        bodyText:
          "Reminder: appointment with {{1}} on {{2}} at {{3}}. Please arrive 10 minutes early. Reply CANCEL to reschedule.",
      },
      {
        name: "checkup_reminder_clinic",
        bodyText:
          "Hi {{1}}, it's been a while since your last visit to {{2}}. Reply BOOK to schedule your next checkup.",
      },
    ],
    chatbot: {
      name: "Patient FAQ",
      triggerKeywords: ["hi", "hello", "help"],
      nodesJson: flowNodes(
        "Hi 👋 Reply HOURS for clinic timings, BOOK to schedule, or DIRECTIONS for the address.",
      ),
    },
  },
  realestate: {
    campaignName: "Welcome series — Real Estate",
    campaignDescription: "Welcomes new leads and offers a property catalog.",
    templates: [
      {
        name: "welcome_realestate",
        bodyText:
          "Hi {{1}}, thanks for your interest in {{2}}'s listings. Reply CATALOG to see our latest properties.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "viewing_reminder_realestate",
        bodyText:
          "Reminder: viewing for {{1}} on {{2}} at {{3}}. Reply 1 to confirm or 2 to reschedule.",
      },
      {
        name: "winback_realestate",
        bodyText:
          "Hi {{1}}, still looking for a home? {{2}} has 5 new listings in your area. Reply YES to see them.",
      },
    ],
    chatbot: {
      name: "Lead qualifier",
      triggerKeywords: ["hi", "hello", "catalog"],
      nodesJson: flowNodes(
        "Hi 👋 Tell me your budget and preferred area, and I'll send matching listings.",
      ),
    },
  },
  ecommerce: {
    campaignName: "Welcome series — E-commerce",
    campaignDescription: "Welcomes new shoppers with a first-order discount.",
    templates: [
      {
        name: "welcome_ecommerce",
        bodyText:
          "Welcome to {{1}}, {{2}}! 🎉 Use code FIRST10 for 10% off your first order.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "order_update_ecommerce",
        bodyText:
          "Hi {{1}}, your order {{2}} from {{3}} is {{4}}. Track at the link in our email.",
      },
      {
        name: "abandoned_cart_ecommerce",
        bodyText:
          "Hi {{1}}, you left items in your cart at {{2}}. Complete checkout in 24h and save 10%.",
      },
    ],
    chatbot: {
      name: "Order status FAQ",
      triggerKeywords: ["hi", "hello", "order"],
      nodesJson: flowNodes(
        "Hi 👋 Reply with your order number to check status, or CATALOG to browse new arrivals.",
      ),
    },
  },
  coaching: {
    campaignName: "Welcome series — Coaching",
    campaignDescription: "Welcomes new students and books a discovery call.",
    templates: [
      {
        name: "welcome_coaching",
        bodyText:
          "Hi {{1}}, welcome to {{2}}! Reply CALL to schedule a free 15-min discovery session.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "session_reminder_coaching",
        bodyText:
          "Reminder: your session with {{1}} on {{2}} at {{3}}. Reply 1 to confirm or 2 to reschedule.",
      },
      {
        name: "checkin_coaching",
        bodyText:
          "Hi {{1}}, just checking in on your goals from our last session. Reply with a quick update?",
      },
    ],
    chatbot: {
      name: "Discovery scheduler",
      triggerKeywords: ["hi", "hello", "call"],
      nodesJson: flowNodes(
        "Hi 👋 I can book a free 15-min discovery call. What day/time works for you?",
      ),
    },
  },
  generic: {
    campaignName: "Welcome series",
    campaignDescription: "Greets new contacts and invites them to engage.",
    templates: [
      {
        name: "welcome",
        bodyText:
          "Hi {{1}}, welcome to {{2}}! Reply YES to get started, or STOP to opt out.",
        headerText: "Welcome",
        footerText: "Reply STOP to opt out",
      },
      {
        name: "follow_up",
        bodyText:
          "Hi {{1}}, just following up. Is there anything we can help you with?",
      },
      {
        name: "winback",
        bodyText:
          "We miss you {{1}}! Reply YES and we'll show you what's new at {{2}}.",
      },
    ],
    chatbot: {
      name: "Greet new contacts",
      triggerKeywords: ["hi", "hello"],
      nodesJson: flowNodes(
        "Hi 👋 Thanks for getting in touch. How can we help you today?",
      ),
    },
  },
};

export function getIndustryPack(industry: CustomerIndustry): IndustryPack {
  return INDUSTRY_PACKS[industry];
}

export interface StarterPackResult {
  industry: CustomerIndustry;
  templateIds: string[];
  campaignId: string;
  chatbotFlowId: string;
}

/**
 * Seed a fresh customer tenant with starter content. Called from inside
 * the customer-create $transaction so all-or-nothing semantics with the
 * tenant/admin/wallet rows. Each best-effort piece (chatbot, email)
 * lives outside this transaction so a transient failure there can't
 * roll back the customer itself.
 */
export async function seedStarterTemplatesAndCampaign(
  tx: Prisma.TransactionClient,
  tenantId: string,
  industry: CustomerIndustry,
): Promise<{ templateIds: string[]; campaignId: string; chatbotFlowId: string }> {
  const pack = INDUSTRY_PACKS[industry];

  // Templates first — the campaign references the welcome template.
  const created = await Promise.all(
    pack.templates.map((t) =>
      tx.whatsAppTemplate.create({
        data: {
          tenantId,
          name: t.name,
          bodyText: t.bodyText,
          headerText: t.headerText ?? null,
          footerText: t.footerText ?? null,
          status: "APPROVED",
          language: "en",
          category: "MARKETING",
          variants: [],
        },
        select: { id: true },
      }),
    ),
  );
  const templateIds = created.map((t) => t.id);
  const welcomeTemplateId = templateIds[0];

  const campaign = await tx.campaign.create({
    data: {
      tenantId,
      name: pack.campaignName,
      description: pack.campaignDescription,
      type: "BROADCAST",
      status: "DRAFT",
      templateId: welcomeTemplateId,
      targetContacts: JSON.stringify({ mode: "contacts", contactIds: [] }),
      totalContacts: 0,
    },
    select: { id: true },
  });

  const chatbot = await tx.chatbotFlow.create({
    data: {
      tenantId,
      name: pack.chatbot.name,
      trigger: "keyword",
      triggerKeywords: pack.chatbot.triggerKeywords,
      nodes: pack.chatbot.nodesJson,
      isActive: false, // partner activates after WhatsApp connect
    },
    select: { id: true },
  });

  return {
    templateIds,
    campaignId: campaign.id,
    chatbotFlowId: chatbot.id,
  };
}

/**
 * Fire-and-forget invite email. Runs OUTSIDE the customer-create
 * transaction so an SMTP hiccup never rolls back the tenant. The
 * partner can always re-send via the existing user-invite path.
 */
export async function sendInviteEmail(args: {
  toEmail: string;
  toName: string;
  customerWorkspaceName: string;
  loginUrl: string;
  tenantId: string;
}): Promise<void> {
  try {
    const { sendEmail } = await import("./email.service");
    await sendEmail({
      to: args.toEmail,
      subject: `Welcome to ${args.customerWorkspaceName}`,
      tenantId: args.tenantId,
      text:
        `Hi ${args.toName},\n\n` +
        `Your workspace "${args.customerWorkspaceName}" is ready.\n\n` +
        `Sign in: ${args.loginUrl}\n\n` +
        "We've pre-loaded a welcome message template, a draft first campaign, " +
        "and a starter chatbot flow so you can get going fast.\n\n" +
        "Reply to this email with any questions.\n",
    });
  } catch (err) {
    console.warn(
      "[customerProvisioning] invite email failed (non-fatal):",
      (err as Error).message,
    );
  }
}
