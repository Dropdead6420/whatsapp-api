import Link from "next/link";
import { ArrowRight, CheckCircle2, Minus } from "lucide-react";
import {
  MarketingPageShell,
  SectionHeader,
} from "../../src/components/marketing/MarketingShell";
import { PricingPlans } from "../../src/components/marketing/PricingPlans";

const comparison = [
  {
    feature: "Shared inbox and CRM",
    starter: true,
    growth: true,
    partner: true,
  },
  {
    feature: "Broadcast campaigns and templates",
    starter: true,
    growth: true,
    partner: true,
  },
  {
    feature: "AI Agent Builder",
    starter: false,
    growth: true,
    partner: true,
  },
  {
    feature: "Workflow Builder",
    starter: false,
    growth: true,
    partner: true,
  },
  {
    feature: "Compliance Firewall",
    starter: false,
    growth: true,
    partner: true,
  },
  {
    feature: "White-label partner portal",
    starter: false,
    growth: false,
    partner: true,
  },
];

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
            description="Keep plan selection simple, then use tenant-level feature flags to fine tune access for each customer."
          />
          <div className="mt-10 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
              <div className="p-4">Feature</div>
              <div className="p-4 text-center">Starter</div>
              <div className="p-4 text-center">Growth</div>
              <div className="p-4 text-center">Partner</div>
            </div>
            {comparison.map((row) => (
              <div
                key={row.feature}
                className="grid grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-slate-100 text-sm last:border-b-0"
              >
                <div className="p-4 font-medium text-slate-800">{row.feature}</div>
                <PlanMark value={row.starter} />
                <PlanMark value={row.growth} />
                <PlanMark value={row.partner} />
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

function PlanMark({ value }: { value: boolean }) {
  return (
    <div className="flex items-center justify-center p-4">
      {value ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      ) : (
        <Minus className="h-5 w-5 text-slate-300" />
      )}
    </div>
  );
}
