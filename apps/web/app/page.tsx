import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  CheckList,
  MarketingPageShell,
  SectionHeader,
} from "../src/components/marketing/MarketingShell";
import {
  CompactProductPreview,
  HeroProductMockup,
} from "../src/components/marketing/ProductMockup";
import { PricingPlans } from "../src/components/marketing/PricingPlans";
import {
  productPillars,
  proofPoints,
  useCases,
} from "../src/components/marketing/data";

const workflowSteps = [
  "Capture customer conversations",
  "Let AI classify intent and urgency",
  "Route to an agent, campaign, or workflow",
  "Check compliance before sending",
  "Track outcomes back to CRM and wallet",
];

const faqs = [
  {
    q: "Is NexaFlow only for broadcasts?",
    a: "No. Broadcasts are one part of the platform. NexaFlow also covers team inbox, CRM, automations, AI agents, compliance, appointments, webhooks, wallets, and partner operations.",
  },
  {
    q: "Can agents stay in control?",
    a: "Yes. AI can suggest replies, draft content, or run through an approved workflow. Teams can keep human review on for sensitive use cases.",
  },
  {
    q: "Does it support agencies?",
    a: "Yes. The platform includes partner and white-label surfaces, feature flags, client provisioning, wallet controls, and revenue signals.",
  },
];

export default function LandingPage() {
  return (
    <MarketingPageShell>
      <section className="overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-16 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-20">
          <div className="flex flex-col justify-center">
            <h1 className="text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl lg:text-7xl">
              AI WhatsApp Growth Platform
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Run WhatsApp sales, support, campaigns, automations, AI agents,
              compliance, and partner operations from one tenant-safe workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Start building
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/features/ai-agents"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Explore AI agents
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-4 border-t border-slate-200 pt-8 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {proofPoints.map((point) => (
                <div key={point.label}>
                  <div className="text-2xl font-semibold text-slate-950">
                    {point.value}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {point.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <HeroProductMockup />
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-5 text-sm font-medium text-slate-600 sm:px-6 lg:px-8">
          {useCases.map((item) => (
            <span key={item} className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {item}
            </span>
          ))}
        </div>
      </section>

      <section id="product" className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            align="center"
            title="One workspace for the full WhatsApp revenue loop"
            description="NexaFlow brings the daily operating pieces together: inbox, campaigns, workflows, AI, compliance, analytics, and partner controls."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {productPillars.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="group rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
              >
                <item.icon className="h-6 w-6 text-emerald-500" />
                <h3 className="mt-5 text-lg font-semibold text-slate-950">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {item.description}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  View feature
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Move from manual replies to governed automation.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              The platform is designed for a practical automation-first rollout:
              start with shared inbox and CRM, add campaigns and flows, then layer
              in AI agents and compliance once the operating rules are clear.
            </p>
            <Link
              href="/features/workflows"
              className="mt-8 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              See workflows
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <div className="grid gap-3">
              {workflowSteps.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-4 rounded-md border border-slate-800 bg-slate-950 px-4 py-3"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/15 text-sm font-semibold text-emerald-300">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-100">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeader
              title="AI agents that operators can actually configure"
              description="Agents are built around provider presets, model controls, knowledge scope, tools, fallback behavior, and a test panel. Then they can be used directly in the Flow Builder."
            />
            <div className="mt-8">
              <CheckList
                items={[
                  "Publish, disable, archive, set default, and manage auto-reply safely.",
                  "Select knowledge-base categories and tags for grounded answers.",
                  "Use the AI_AGENT workflow node to pass a generated reply into downstream steps.",
                ]}
              />
            </div>
          </div>
          <CompactProductPreview />
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            align="center"
            title="Plans for businesses, teams, and partners"
            description="Start with the core WhatsApp workspace, then unlock AI, compliance, automation, and partner controls as operations scale."
          />
          <div className="mt-12">
            <PricingPlans compact showSourceNote />
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Compare plans
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <SectionHeader align="center" title="Questions teams ask before launch" />
          <div className="mt-10 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {faqs.map((faq) => (
              <div key={faq.q} className="p-6">
                <h3 className="font-semibold text-slate-950">{faq.q}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
