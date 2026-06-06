import type { PageBlock } from "./landingPage.service";

// =====================================================================
// AI Website Builder — starter blueprint generator (Complete Planning PDF
// §2.16, Phase 10). Produces a sensible single-page site (hero, features,
// CTA, contact) from a few business inputs. Deterministic + template-based
// so it always succeeds offline; LLM copy enhancement (via the AI gateway)
// layers on in a follow-up. Mirrors the existing demo/proposal blueprint
// generators in this codebase.
// =====================================================================

export type LandingGoal = "leads" | "sales" | "bookings" | "awareness";

export interface LandingBlueprintInput {
  businessName: string;
  industry?: string;
  description?: string;
  primaryGoal?: LandingGoal;
  city?: string;
  phone?: string;
}

export interface LandingBlueprint {
  title: string;
  blocks: PageBlock[];
}

const GOAL_CTA: Record<LandingGoal, string> = {
  leads: "Get a Free Quote",
  sales: "Shop Now",
  bookings: "Book an Appointment",
  awareness: "Learn More",
};

const GOAL_HEADLINE: Record<LandingGoal, string> = {
  leads: "Tell us what you need — we'll get back fast.",
  sales: "Ready when you are.",
  bookings: "Pick a time that works for you.",
  awareness: "Discover what we do.",
};

/** Three feature blurbs, industry-aware with a generic fallback. */
export function featuresForIndustry(industry?: string): Array<{ title: string; body: string }> {
  const key = (industry ?? "").trim().toLowerCase();
  const map: Record<string, Array<{ title: string; body: string }>> = {
    restaurant: [
      { title: "Fresh every day", body: "Seasonal ingredients prepared to order." },
      { title: "Easy ordering", body: "Order on WhatsApp and skip the queue." },
      { title: "Dine in or take away", body: "However you like it, whenever you like." },
    ],
    clinic: [
      { title: "Trusted care", body: "Experienced practitioners who listen." },
      { title: "Quick appointments", body: "Book a slot in seconds on WhatsApp." },
      { title: "Follow-up support", body: "We stay in touch after your visit." },
    ],
    salon: [
      { title: "Expert stylists", body: "Looks tailored to you." },
      { title: "Simple booking", body: "Reserve your chair on WhatsApp." },
      { title: "Premium products", body: "Only what's good for you." },
    ],
    realestate: [
      { title: "Curated listings", body: "Homes that match what you want." },
      { title: "Fast responses", body: "Questions answered on WhatsApp." },
      { title: "End-to-end help", body: "From viewing to keys in hand." },
    ],
  };
  return (
    map[key] ?? [
      { title: "Quality you can trust", body: "We sweat the details so you don't have to." },
      { title: "Talk to a human", body: "Reach us on WhatsApp anytime." },
      { title: "Fast and reliable", body: "We show up and deliver." },
    ]
  );
}

/** Build a starter landing-page blueprint. Pure. */
export function buildLandingBlueprint(input: LandingBlueprintInput): LandingBlueprint {
  const name = input.businessName.trim() || "Your Business";
  const goal: LandingGoal = input.primaryGoal ?? "leads";
  const ctaLabel = GOAL_CTA[goal];
  const subheadline =
    input.description?.trim() ||
    `${input.industry?.trim() || "Trusted"} services${input.city?.trim() ? ` in ${input.city.trim()}` : ""} you can rely on.`;

  const blocks: PageBlock[] = [
    {
      type: "hero",
      props: { headline: name, subheadline, ctaLabel, ctaHref: "#contact" },
    },
    {
      type: "features",
      props: { heading: "Why choose us", items: featuresForIndustry(input.industry) },
    },
    {
      type: "cta",
      props: { headline: GOAL_HEADLINE[goal], buttonLabel: ctaLabel, buttonHref: "#contact" },
    },
    {
      type: "contact",
      props: {
        heading: "Get in touch",
        whatsapp: true,
        phone: input.phone?.trim() || null,
        city: input.city?.trim() || null,
      },
    },
  ];

  return { title: name, blocks };
}
