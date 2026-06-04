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
    q: "Can I start with one business?",
    a: "Yes. Use Starter or Growth for a single tenant, then move to partner controls when you manage multiple clients.",
  },
  {
    q: "Are WhatsApp provider charges included?",
    a: "Provider and Meta conversation costs are tracked separately through wallet and usage controls so the business can see spend clearly.",
  },
  {
    q: "Can features be gated per tenant?",
    a: "Yes. SuperAdmin feature flags can turn AI, flows, webhooks, campaigns, appointments, and compliance modules on or off per tenant.",
  },
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
            Pricing that grows with your WhatsApp operation
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Pick a simple business plan, then add AI, automation, compliance,
            and partner controls as your workflow matures.
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
