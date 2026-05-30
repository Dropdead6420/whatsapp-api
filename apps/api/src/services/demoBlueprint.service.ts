// ============================================================================
// AI Demo Builder (PRD-v2 §6, Sprint 3 slice 3)
//
// Turns a one-line prospect brief into a structured demo blueprint that the
// partner can preview, tweak, and seed into a fresh demo tenant. The output
// shape is the same DemoSeedPlan that `createDemoTenant({ seedPlan })`
// already accepts in demo.service.ts — so the AI layer never touches the
// DB on its own; it just produces JSON the partner approves.
//
// Billing: every generation is billed to the partner tenant via the
// existing runTenantLlmJson plumbing (assertCanAffordAi + debitAi).
// Failure mode: when the LLM hiccups or the env has no API key, we
// fall back to an industry-aware deterministic blueprint so the UI is
// never stuck on an empty state.
// ============================================================================

import type { DemoSeedPlan } from "./demo.service";

export interface DemoBlueprintBrief {
  /** Prospect's business name, e.g. "Sunshine Bakeries". */
  prospectName: string;
  /** Industry vertical — drives template tone + sample contact names. */
  industry: string;
  /** Free-form pain points / goals the prospect mentioned. */
  goals?: string;
  /** Rough team / customer size hint, e.g. "5 agents, 2k customers". */
  scale?: string;
  /** Channel mix hint, e.g. "primarily WhatsApp, some Instagram". */
  channels?: string;
  /** Preferred language for sample copy. Defaults to "en". */
  language?: string;
}

export interface GenerateDemoBlueprintResult {
  blueprint: DemoSeedPlan;
  source: "ai" | "fallback";
  rationale?: string;
}

const DEFAULT_LANGUAGE = "en";

/**
 * Deterministic fallback used when the LLM call fails or the platform
 * is running without an Anthropic key. Industry-aware enough to feel
 * tailored without depending on a model.
 */
function fallbackBlueprint(brief: DemoBlueprintBrief): DemoSeedPlan {
  const industry = (brief.industry || "general business").trim();
  const lang = brief.language ?? DEFAULT_LANGUAGE;
  const safeName = brief.prospectName.replace(/[^a-z0-9 ]/gi, "").slice(0, 40) || "Demo";

  const contacts = [
    { name: "Anaya Sharma", phoneNumber: "+919876500001", email: "anaya@example.com", tags: [industry.toLowerCase(), "high-intent"] },
    { name: "Rohan Mehta",  phoneNumber: "+919876500002", email: "rohan@example.com", tags: [industry.toLowerCase(), "new-lead"] },
    { name: "Priya Singh",  phoneNumber: "+919876500003", email: "priya@example.com", tags: [industry.toLowerCase(), "repeat"] },
    { name: "Arjun Iyer",   phoneNumber: "+919876500004", email: "arjun@example.com", tags: [industry.toLowerCase(), "churned"] },
    { name: "Meera Kapoor", phoneNumber: "+919876500005", email: "meera@example.com", tags: [industry.toLowerCase(), "vip"] },
  ];

  return {
    industry,
    contacts,
    templates: [
      {
        name: "welcome",
        bodyText: `Hi {{1}}, welcome to ${safeName}! Reply YES to get started.`,
        category: "MARKETING",
        headerText: `Welcome to ${safeName}`,
        footerText: "Reply STOP to opt out",
        language: lang,
      },
      {
        name: "appointment_reminder",
        bodyText: `Hi {{1}}, your appointment with ${safeName} is on {{2}}. Reply 1 to confirm, 2 to reschedule.`,
        category: "UTILITY",
        language: lang,
      },
      {
        name: "winback",
        bodyText: `We've missed you, {{1}}! Here's 15% off your next order at ${safeName}. Use code: COMEBACK15`,
        category: "MARKETING",
        language: lang,
      },
    ],
    campaignName: `${safeName} – Welcome series`,
    leadTitle: `${safeName} – Hot lead`,
    leadValue: 25_000,
    agentPersona: {
      name: `${safeName} Concierge`,
      role: `AI front desk for a ${industry} business`,
      systemPrompt:
        `You are the AI concierge for ${safeName}, a ${industry} business. ` +
        `Greet customers warmly, answer FAQs, qualify leads, and hand off to a human ` +
        `when the question is outside your scope. Keep replies under 3 sentences.`,
    },
    welcomeMessage: `Hi 👋 I'm the ${safeName} concierge. How can I help you today?`,
  };
}

/**
 * Generate a demo blueprint from a prospect brief. Billed to the
 * partner tenant. Returns the AI result on success, or a deterministic
 * industry-aware fallback (with `source: "fallback"`) if the model
 * call fails for any reason.
 */
export async function generateDemoBlueprint(args: {
  partnerTenantId: string;
  brief: DemoBlueprintBrief;
}): Promise<GenerateDemoBlueprintResult> {
  const { partnerTenantId, brief } = args;

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{
      industry?: string;
      contacts?: Array<{ name?: string; phoneNumber?: string; email?: string; tags?: string[] }>;
      templates?: Array<{
        name?: string;
        bodyText?: string;
        category?: string;
        headerText?: string;
        footerText?: string;
        language?: string;
      }>;
      campaignName?: string;
      leadTitle?: string;
      leadValue?: number;
      agentPersona?: { name?: string; role?: string; systemPrompt?: string };
      welcomeMessage?: string;
      rationale?: string;
    }>({
      tenantId: partnerTenantId,
      feature: "demo_blueprint",
      system:
        "You are a NexaFlow solutions architect building a tailored WhatsApp demo " +
        "for a partner's prospect. Return a JSON object that matches this shape:\n" +
        '{\n' +
        '  "industry": "...",\n' +
        '  "contacts": [{"name":"...", "phoneNumber":"+E.164", "email":"...", "tags":["..."]}],\n' +
        '  "templates": [{"name":"snake_case", "bodyText":"...{{1}}...", "category":"MARKETING|UTILITY|AUTHENTICATION", "headerText":"...", "footerText":"...", "language":"en"}],\n' +
        '  "campaignName": "...",\n' +
        '  "leadTitle": "...",\n' +
        '  "leadValue": 25000,\n' +
        '  "agentPersona": {"name":"...", "role":"...", "systemPrompt":"..."},\n' +
        '  "welcomeMessage": "...",\n' +
        '  "rationale": "one-line why this blueprint fits"\n' +
        "}\n" +
        "Rules:\n" +
        " - 5 to 8 contacts with realistic names appropriate to the industry/region.\n" +
        " - All phone numbers in +E.164 format with unique digits.\n" +
        " - 3 to 5 templates demonstrating distinct use cases (welcome, reminder, win-back, etc).\n" +
        " - Template names snake_case, under 30 chars, English unless specified.\n" +
        " - Body text 1-2 sentences max, use {{1}} {{2}} placeholders.\n" +
        " - Keep agent system prompt under 600 chars.\n" +
        " - No real personal data — these are demo personas.",
      prompt: JSON.stringify(brief),
      maxTokens: 1500,
      temperature: 0.6,
    });

    const blueprint: DemoSeedPlan = {
      industry: (llm.industry || brief.industry).slice(0, 80),
      contacts: (llm.contacts ?? [])
        .filter((c) => c.name && c.phoneNumber)
        .slice(0, 8)
        .map((c) => ({
          name: String(c.name).slice(0, 120),
          phoneNumber: String(c.phoneNumber).slice(0, 24),
          email: c.email ? String(c.email).slice(0, 200) : undefined,
          tags: Array.isArray(c.tags)
            ? c.tags.filter((t) => typeof t === "string").slice(0, 8)
            : [],
        })),
      templates: (llm.templates ?? [])
        .filter((t) => t.bodyText)
        .slice(0, 5)
        .map((t, idx) => ({
          name:
            (t.name || `demo_template_${idx + 1}`)
              .replace(/[^a-z0-9_]/gi, "_")
              .toLowerCase()
              .slice(0, 50),
          bodyText: String(t.bodyText).slice(0, 1024),
          category:
            t.category === "UTILITY" || t.category === "AUTHENTICATION"
              ? (t.category as "UTILITY" | "AUTHENTICATION")
              : "MARKETING",
          headerText: t.headerText ? String(t.headerText).slice(0, 60) : undefined,
          footerText: t.footerText ? String(t.footerText).slice(0, 60) : undefined,
          language: (t.language || brief.language || DEFAULT_LANGUAGE).slice(0, 8),
        })),
      campaignName: llm.campaignName ? String(llm.campaignName).slice(0, 120) : undefined,
      leadTitle: llm.leadTitle ? String(llm.leadTitle).slice(0, 200) : undefined,
      leadValue:
        typeof llm.leadValue === "number" && llm.leadValue > 0
          ? Math.floor(llm.leadValue)
          : undefined,
      agentPersona:
        llm.agentPersona &&
        llm.agentPersona.name &&
        llm.agentPersona.role &&
        llm.agentPersona.systemPrompt
          ? {
              name: String(llm.agentPersona.name).slice(0, 120),
              role: String(llm.agentPersona.role).slice(0, 240),
              systemPrompt: String(llm.agentPersona.systemPrompt).slice(0, 4000),
            }
          : undefined,
      welcomeMessage: llm.welcomeMessage
        ? String(llm.welcomeMessage).slice(0, 500)
        : undefined,
    };

    // Sanity check — if the LLM returned nothing useful, prefer the
    // deterministic fallback so the partner doesn't see an empty form.
    if ((blueprint.contacts?.length ?? 0) === 0 && (blueprint.templates?.length ?? 0) === 0) {
      return {
        blueprint: fallbackBlueprint(brief),
        source: "fallback",
        rationale: "AI returned an empty blueprint; using deterministic fallback.",
      };
    }

    return {
      blueprint,
      source: "ai",
      rationale: llm.rationale ? String(llm.rationale).slice(0, 280) : undefined,
    };
  } catch (err) {
    console.error("[demo-blueprint] generation failed:", err);
    return {
      blueprint: fallbackBlueprint(brief),
      source: "fallback",
      rationale: "AI provider unavailable; using deterministic fallback.",
    };
  }
}
