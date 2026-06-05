import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  MarketingPageShell,
  SectionHeader,
} from "../../src/components/marketing/MarketingShell";
import { PricingComparison } from "../../src/components/marketing/PricingComparison";
import { PricingPlans } from "../../src/components/marketing/PricingPlans";

const questions = [
  {
    q: "Can SuperAdmin change these plans?",
    a: "Yes. These public cards are synced from the SuperAdmin plan catalog, so prices, limits, and descriptions can be updated without changing the website code.",
  },
  {
    q: "Are WhatsApp and AI usage included?",
    a: "Plan limits include workspace access and AI allowances. WhatsApp provider charges, extra AI credits, image generation, and overages can be priced separately through wallet and add-on controls.",
  },
  {
    q: "Do you support partners and white-label agencies?",
    a: "Yes. Partner Basic, Growth, and Enterprise packages give agencies customer provisioning, wallet monitoring, margin controls, white-label branding, and support operations.",
  },
];

const aiCreditPacks = [
  { name: "Starter AI Pack", price: "₹499", detail: "1,000 credits" },
  { name: "Growth AI Pack", price: "₹1,999", detail: "5,000 credits" },
  { name: "Scale AI Pack", price: "₹3,499", detail: "10,000 credits" },
  { name: "Enterprise AI Pack", price: "₹14,999", detail: "50,000 credits" },
];

const addOnGroups = [
  {
    title: "GMB Growth Add-ons",
    items: [
      {
        name: "Lite",
        price: "₹999/mo",
        features: ["8 GMB posts", "AI captions", "4 AI images", "Review reply suggestions"],
      },
      {
        name: "Growth",
        price: "₹1,999/mo",
        features: ["20 posts", "AI review replies", "Auto scheduling", "Monthly report"],
      },
      {
        name: "Pro",
        price: "₹3,999/mo",
        features: ["30 posts", "Multi-location", "Advanced report", "Competitor ideas"],
      },
    ],
  },
  {
    title: "Website and Landing Add-ons",
    items: [
      {
        name: "Landing Page Lite",
        price: "₹499/mo",
        features: ["3 pages", "Hosted URL", "WhatsApp CTA", "CRM lead capture"],
      },
      {
        name: "Website Builder Pro",
        price: "₹1,999/mo",
        features: ["AI single-page site", "AI edit", "Booking button", "Analytics"],
      },
      {
        name: "Website Builder Agency",
        price: "₹4,999/mo",
        features: ["25 pages", "Custom domain", "AI copy/images", "A/B testing"],
      },
    ],
  },
  {
    title: "Partner and White-label",
    items: [
      {
        name: "Partner Basic",
        price: "₹4,999/mo",
        features: ["10 customers", "Partner dashboard", "Basic branding", "Limited margin control"],
      },
      {
        name: "Partner Growth",
        price: "₹14,999/mo",
        features: ["50 customers", "Custom domain", "White-label branding", "Health score"],
      },
      {
        name: "Partner Enterprise",
        price: "₹49,999+/mo",
        features: ["Custom customers", "Credit line", "Custom providers", "SLA"],
      },
    ],
  },
];

const creditUsage = [
  "Short reply: 1 credit",
  "Long reply or review reply: 2 credits",
  "Campaign copy or template: 5 credits",
  "Chatbot flow: 25 credits",
  "Landing page copy: 30 credits",
  "AI image generation: 25 credits",
  "Monthly report: 50 credits",
];

export const metadata = {
  title: "Pricing | NexaFlow AI",
  description: "NexaFlow AI pricing for WhatsApp CRM, campaigns, AI agents, workflows, compliance, and partner operations.",
};

export default function PricingPage() {
  return (
    <MarketingPageShell>
      <section className="border-b border-slate-200 bg-white px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
            Pricing for WhatsApp, AI, GMB, Ads, and no-code growth
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Start free, launch with a simple business plan, then add AI credits,
            landing pages, GMB growth, ads automation, and partner controls as
            your customer base scales.
          </p>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <PricingPlans showSourceNote />
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            align="center"
            title="Compare core capabilities"
            description="This table is driven by the same SuperAdmin plan catalog as the pricing cards, so limits and feature flags stay aligned."
          />
          <div className="mt-10">
            <PricingComparison />
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            align="center"
            title="Add-ons and usage pricing"
            description="The proposal keeps subscription plans simple, then monetizes AI credits, GMB content, website/landing pages, ads assistants, and partner white-label operations separately."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {aiCreditPacks.map((pack) => (
              <div key={pack.name} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-slate-950">{pack.name}</div>
                <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {pack.price}
                </div>
                <p className="mt-2 text-sm text-slate-600">{pack.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-950">AI credit consumption</h3>
            <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2 lg:grid-cols-4">
              {creditUsage.map((item) => (
                <div key={item} className="rounded-md bg-slate-50 px-3 py-2">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {addOnGroups.map((group) => (
              <div key={group.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-semibold text-slate-950">{group.title}</h3>
                <div className="mt-5 space-y-4">
                  {group.items.map((item) => (
                    <div key={item.name} className="rounded-lg border border-slate-100 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.features.join(" · ")}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          {item.price}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              Ready to launch your first WhatsApp workspace?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Start with one pilot tenant, validate the inbox and campaign loop,
              then add automation and AI where the workflow is ready.
            </p>
          </div>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
          >
            Create account
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <SectionHeader align="center" title="Pricing FAQ" />
          <div className="mt-10 divide-y divide-slate-200 rounded-lg border border-slate-200">
            {questions.map((item) => (
              <div key={item.q} className="p-6">
                <h3 className="font-semibold text-slate-950">{item.q}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
