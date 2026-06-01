import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  CheckList,
  MarketingPageShell,
  SectionHeader,
} from "../../../src/components/marketing/MarketingShell";
import { CompactProductPreview } from "../../../src/components/marketing/ProductMockup";
import { featurePages, productPillars } from "../../../src/components/marketing/data";

type FeatureSlug = keyof typeof featurePages;

export function generateStaticParams() {
  return Object.keys(featurePages).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const feature = featurePages[params.slug as FeatureSlug];
  if (!feature) return {};
  return {
    title: `${feature.title} | NexaFlow AI`,
    description: feature.intro,
  };
}

export default function FeaturePage({ params }: { params: { slug: string } }) {
  const feature = featurePages[params.slug as FeatureSlug];
  if (!feature) notFound();

  const related = productPillars.filter((item) => item.href !== `/features/${params.slug}`);

  return (
    <MarketingPageShell>
      <section className="border-b border-slate-200 bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <feature.icon className="h-9 w-9 text-emerald-500" />
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
              {feature.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              {feature.intro}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                See pricing
              </Link>
            </div>
          </div>
          <CompactProductPreview />
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeader
            title="Built for daily operators"
            description="The feature is designed for teams that need clear controls, predictable state, and enough automation to reduce repetitive work without losing visibility."
          />
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <CheckList items={feature.bullets} />
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            align="center"
            title="How the workflow feels in production"
            description="Each module follows the same pattern: capture signal, apply rules or AI, route the next action, then record the outcome."
          />
          <div className="mt-12 grid gap-3 md:grid-cols-5">
            {feature.workflow.map((step, index) => (
              <div
                key={step}
                className="rounded-lg border border-slate-200 bg-white p-5 text-center shadow-sm"
              >
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-sm font-semibold text-emerald-700">
                  {index + 1}
                </div>
                <div className="mt-4 text-sm font-semibold text-slate-950">{step}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">
              Add {feature.title.toLowerCase()} to your WhatsApp stack.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Start locally with one tenant, then expand into campaigns,
              automation, analytics, and partner controls as the team grows.
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
        <div className="mx-auto max-w-7xl">
          <SectionHeader title="Explore more NexaFlow modules" />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {related.slice(0, 3).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-emerald-200 hover:shadow-md"
              >
                <item.icon className="h-5 w-5 text-emerald-500" />
                <div className="mt-4 font-semibold text-slate-950">{item.title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
