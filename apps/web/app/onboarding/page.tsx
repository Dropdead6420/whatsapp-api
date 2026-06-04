"use client";

// Onboarding wizard — guided activation flow for new tenants.
//
// Server computes the 4-step checklist from existing tables, so the
// page is a thin renderer: poll status, show progress, link to the
// page that owns each step. When all 4 are done, the page swaps to
// a "you're all set" celebration card with shortcuts to the most
// useful surfaces.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useI18n } from "../../src/i18n/I18nProvider";

type StepKey =
  | "connect_whatsapp"
  | "import_contacts"
  | "create_agent"
  | "send_message";

interface OnboardingStep {
  key: StepKey;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  done: boolean;
  detail: string | null;
}

interface OnboardingStatus {
  steps: OnboardingStep[];
  completedSteps: number;
  totalSteps: number;
  completed: boolean;
}

export default function OnboardingPage() {
  const { t } = useI18n();
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await api.get<OnboardingStatus>(
        "/api/v1/onboarding/status",
      );
      setStatus(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("onboarding.statusLoadFailed"));
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;
  }

  const progressPct = status
    ? Math.round((status.completedSteps / status.totalSteps) * 100)
    : 0;

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("onboarding.subtitle")}</p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {status && (
        <>
          {/* Progress bar */}
          <div className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>
                {t("onboarding.progress", {
                  done: status.completedSteps,
                  total: status.totalSteps,
                })}
              </span>
              <span className="font-mono text-slate-500">
                {progressPct}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {!status.completed && (
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
              >
                {t("onboarding.refresh")}
              </button>
            )}
          </div>

          {/* Completion card or checklist */}
          {status.completed ? <CompletionCard /> : <Checklist status={status} />}
        </>
      )}
    </DashboardShell>
  );
}

function Checklist({ status }: { status: OnboardingStatus }) {
  // Find the first incomplete step — that's the "current" one. The UI
  // gives it a distinct accent so the operator knows what to click.
  const currentIdx = status.steps.findIndex((s) => !s.done);

  return (
    <ol className="space-y-3">
      {status.steps.map((step, i) => {
        const isCurrent = i === currentIdx;
        return (
          <li
            key={step.key}
            className={`rounded-md border p-4 shadow-sm transition ${
              step.done
                ? "border-emerald-200 bg-emerald-50/50"
                : isCurrent
                  ? "border-emerald-400 bg-white ring-2 ring-emerald-100"
                  : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start gap-3">
              <StepBubble done={step.done} index={i + 1} />
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {step.title}
                  </h3>
                  {step.detail && (
                    <span
                      className={`text-[10px] font-medium ${
                        step.done ? "text-emerald-700" : "text-slate-500"
                      }`}
                    >
                      {step.detail}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-600">{step.description}</p>
                <Link
                  href={step.ctaHref}
                  className={`mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    step.done
                      ? "border border-slate-300 text-slate-600 hover:bg-slate-100"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {step.ctaLabel} →
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepBubble({ done, index }: { done: boolean; index: number }) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        done
          ? "bg-emerald-600 text-white"
          : "border border-slate-300 bg-white text-slate-500"
      }`}
    >
      {done ? "✓" : index}
    </div>
  );
}

function CompletionCard() {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 p-6 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white">
        ✓
      </div>
      <h2 className="mt-3 text-lg font-semibold text-emerald-900">
        {t("onboarding.allSet")}
      </h2>
      <p className="mt-1 text-sm text-emerald-800">{t("onboarding.allSetBody")}</p>
      <div className="mt-5 grid gap-3 text-left sm:grid-cols-3">
        <Link
          href="/dashboard"
          className="rounded-md border border-emerald-300 bg-white p-3 text-sm hover:border-emerald-500"
        >
          <div className="font-semibold text-slate-900">{t("onboarding.openDashboard")}</div>
          <div className="mt-1 text-xs text-slate-600">
            {t("onboarding.openDashboardDesc")}
          </div>
        </Link>
        <Link
          href="/inbox"
          className="rounded-md border border-emerald-300 bg-white p-3 text-sm hover:border-emerald-500"
        >
          <div className="font-semibold text-slate-900">{t("onboarding.watchInbox")}</div>
          <div className="mt-1 text-xs text-slate-600">
            {t("onboarding.watchInboxDesc")}
          </div>
        </Link>
        <Link
          href="/campaigns"
          className="rounded-md border border-emerald-300 bg-white p-3 text-sm hover:border-emerald-500"
        >
          <div className="font-semibold text-slate-900">{t("onboarding.sendCampaign")}</div>
          <div className="mt-1 text-xs text-slate-600">
            {t("onboarding.sendCampaignDesc")}
          </div>
        </Link>
      </div>
    </div>
  );
}
