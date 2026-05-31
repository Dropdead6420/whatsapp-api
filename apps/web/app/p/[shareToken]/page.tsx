"use client";

import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError, api } from "../../../src/lib/api";

type ProposalStatus = "SENT" | "ACCEPTED";

interface PublicProposal {
  shareToken: string;
  prospectName: string;
  industry: string;
  title: string;
  currency: string;
  estimatedValue: number | null;
  status: ProposalStatus;
  content: {
    executiveSummary: string;
    painPoints: string[];
    recommendedPlan: {
      name: string;
      priceMonthly: number;
      currency: string;
      features: string[];
    };
    roiEstimate: {
      summary: string;
      metrics: Array<{ label: string; value: string }>;
    };
    timeline: Array<{ phase: string; duration: string; detail: string }>;
    callToAction: string;
  };
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  partner: {
    name: string;
    domain: string | null;
    logoUrl: string | null;
    brandColors: string | null;
  };
}

export default function PublicProposalPage() {
  const params = useParams<{ shareToken: string }>();
  const shareToken = params?.shareToken ?? "";
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const data = await api.get<PublicProposal>(
          `/api/v1/public/proposals/${shareToken}`,
          { auth: false },
        );
        if (!cancelled) setProposal(data);
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof ApiClientError && e.status === 404
              ? "This proposal link is no longer available."
              : "Unable to load this proposal right now.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (shareToken) void load();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  const formattedPrice = useMemo(() => {
    const plan = proposal?.content.recommendedPlan;
    if (!plan) return "";
    return `${plan.currency} ${plan.priceMonthly.toLocaleString()}`;
  }, [proposal]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-700">
        <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Loading proposal...
        </div>
      </main>
    );
  }

  if (err || !proposal) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold text-slate-950">Proposal unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {err ?? "This proposal link is not available."}
          </p>
        </div>
      </main>
    );
  }

  const { content } = proposal;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {proposal.partner.logoUrl ? (
              <img
                src={proposal.partner.logoUrl}
                alt=""
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-white">
                {proposal.partner.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-950">
                {proposal.partner.name}
              </div>
              <div className="truncate text-xs text-slate-500">
                Proposal for {proposal.prospectName}
              </div>
            </div>
          </div>
          <StatusPill status={proposal.status} />
        </div>
      </header>

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              WhatsApp automation proposal
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              {proposal.title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              {content.executiveSummary}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Recommended plan
            </div>
            <div className="mt-2 text-2xl font-black text-slate-950">
              {content.recommendedPlan.name}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              {formattedPrice} / month
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[0.95fr_1.05fr]">
        <Section title="What this solves">
          <div className="grid gap-3">
            {content.painPoints.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </div>
        </Section>

        <Section title="Included features">
          <div className="grid gap-3 sm:grid-cols-2">
            {content.recommendedPlan.features.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </div>
        </Section>

        <Section title="Expected impact">
          <p className="mb-4 text-sm leading-6 text-slate-600">
            {content.roiEstimate.summary}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {content.roiEstimate.metrics.map((metric) => (
              <div key={`${metric.label}-${metric.value}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {metric.label}
                </div>
                <div className="mt-1 text-base font-black text-slate-950">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Implementation timeline">
          <div className="space-y-3">
            {content.timeline.map((step) => (
              <div key={`${step.phase}-${step.duration}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-slate-950">{step.phase}</div>
                  <div className="rounded-full bg-white px-2 py-1 text-xs font-bold text-emerald-700">
                    {step.duration}
                  </div>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="rounded-xl bg-slate-950 p-6 text-white">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
              Next step
            </div>
            <p className="mt-3 text-lg font-semibold leading-8">{content.callToAction}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-black text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
      <span>{children}</span>
    </div>
  );
}

function StatusPill({ status }: { status: ProposalStatus }) {
  const label = status === "ACCEPTED" ? "Accepted" : "Sent";
  const className =
    status === "ACCEPTED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-indigo-200 bg-indigo-50 text-indigo-700";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${className}`}>
      {label}
    </span>
  );
}
