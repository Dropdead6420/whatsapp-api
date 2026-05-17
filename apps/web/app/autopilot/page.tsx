"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useAutoSave } from "../../src/hooks/useAutoSave";

interface AutopilotDraft {
  goal: string;
  audienceDescription: string;
  audienceFilter: {
    reasoning: string;
    tagsAny?: string[];
    tagsAll?: string[];
    inactiveSinceDays?: number;
    interactedWithinDays?: number;
    optedOut?: boolean;
  };
  estimatedAudienceSize: number;
  messageVariants: Array<{ text: string; rationale: string }>;
  suggestedSendAt: string;
  followUpSequence: Array<{ delayHours: number; message: string }>;
  reasoning: string;
}

const PRESETS = [
  "Get more bookings this weekend",
  "Re-engage customers who haven&apos;t visited in 60 days",
  "Promote our new hair-spa service",
  "Bring back lapsed VIP customers",
  "Drive 10 appointment bookings this week",
];

export default function AutopilotPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const userScope = `${user?.tenantId ?? "anon"}:${user?.id ?? "anon"}`;
  const [goal, setGoal, goalStatus] = useAutoSave<string>(
    `autopilot-goal:${userScope}`,
    "",
  );
  const [businessType, setBusinessType] = useAutoSave<string>(
    `autopilot-businessType:${userScope}`,
    "salon",
  );
  const [draft, setDraft] = useState<AutopilotDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState<number | null>(null);
  const [launched, setLaunched] = useState<{ id: string; name: string } | null>(
    null,
  );

  async function plan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setDraft(null);
    setLaunched(null);
    try {
      const data = await api.post<AutopilotDraft>("/api/v1/ai/autopilot/campaign", {
        goal: goal.trim(),
        businessType: businessType || undefined,
      });
      setDraft(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Autopilot failed");
    } finally {
      setBusy(false);
    }
  }

  async function launch(variantIndex: number) {
    if (!draft) return;
    const variant = draft.messageVariants[variantIndex];
    if (!variant) return;
    setLaunching(variantIndex);
    setErr(null);
    setLaunched(null);
    try {
      const name = `Autopilot · ${draft.goal.slice(0, 60)}`;
      const result = await api.post<{
        campaign: { id: string; name: string };
        followUps: Array<{ campaignId: string; scheduledFor: string }>;
        audienceSize: number;
        warnings: string[];
      }>("/api/v1/ai/autopilot/launch", {
        name,
        goal: draft.goal,
        bodyText: variant.text,
        audienceFilter: draft.audienceFilter,
        scheduledFor: draft.suggestedSendAt,
        followUpSequence: draft.followUpSequence,
      });
      setLaunched({ id: result.campaign.id, name: result.campaign.name });
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Launch failed");
    } finally {
      setLaunching(null);
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            ✦ Flagship feature
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Campaign Autopilot</h1>
          <p className="text-sm text-slate-500">
            Type a goal. AI plans the audience, writes the copy, picks the best
            send time, and designs the follow-up sequence.
          </p>
        </div>
        {goalStatus !== "idle" && (
          <span
            className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              goalStatus === "saving"
                ? "bg-slate-100 text-slate-600"
                : "bg-emerald-50 text-emerald-700"
            }`}
            title="Goal auto-saved locally"
          >
            <span
              className={
                goalStatus === "saving"
                  ? "h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                  : "h-1.5 w-1.5 rounded-full bg-emerald-500"
              }
            />
            {goalStatus === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </header>

      <form
        onSubmit={plan}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <label className="block text-sm font-medium text-slate-700">
          What outcome do you want?
        </label>
        <textarea
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder='e.g. "I want 15 more appointments this weekend from our regular customers"'
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setGoal(p.replace(/&apos;/g, "'"))}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              dangerouslySetInnerHTML={{ __html: p }}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Business type (optional)
            </label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— Not specified —</option>
              <option value="salon">Salon</option>
              <option value="clinic">Clinic</option>
              <option value="spa">Spa</option>
              <option value="gym">Gym</option>
              <option value="coaching">Coaching</option>
              <option value="real estate">Real estate</option>
              <option value="e-commerce">E-commerce</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={busy || !goal.trim()}
            className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Planning…" : "✦ Plan campaign"}
          </button>
        </div>
      </form>

      {err && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {draft && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              AI reasoning
            </div>
            <p className="mt-1">{draft.reasoning}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Audience" hint={draft.audienceDescription}>
              <div className="text-3xl font-semibold">
                {draft.estimatedAudienceSize}
              </div>
              <div className="text-xs text-slate-500">contacts will match</div>
              <ul className="mt-3 space-y-0.5 text-xs text-slate-600">
                {draft.audienceFilter.tagsAny && (
                  <li>Any tags: {draft.audienceFilter.tagsAny.join(", ")}</li>
                )}
                {draft.audienceFilter.tagsAll && (
                  <li>All tags: {draft.audienceFilter.tagsAll.join(", ")}</li>
                )}
                {typeof draft.audienceFilter.inactiveSinceDays === "number" && (
                  <li>Inactive ≥ {draft.audienceFilter.inactiveSinceDays} days</li>
                )}
                {typeof draft.audienceFilter.interactedWithinDays === "number" && (
                  <li>Active within {draft.audienceFilter.interactedWithinDays} days</li>
                )}
              </ul>
            </Card>
            <Card title="Best send time">
              <div className="text-lg font-medium">
                {new Date(draft.suggestedSendAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Optimized for response rate
              </div>
            </Card>
            <Card title="Follow-up sequence">
              <ol className="space-y-2 text-xs text-slate-700">
                {draft.followUpSequence.map((step, i) => (
                  <li key={i}>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium">
                      +{step.delayHours}h
                    </span>{" "}
                    {step.message}
                  </li>
                ))}
                {draft.followUpSequence.length === 0 && (
                  <li className="italic text-slate-500">No follow-ups</li>
                )}
              </ol>
            </Card>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Message variants
            </h2>
            <div className="mt-3 space-y-3">
              {draft.messageVariants.map((v, i) => (
                <div
                  key={i}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                      Variant {i + 1}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {v.text.length} chars
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{v.text}</p>
                  <p className="mt-2 text-[11px] italic text-slate-500">
                    {v.rationale}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(v.text)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-100"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => launch(i)}
                      disabled={launching !== null || launched !== null}
                      className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {launching === i
                        ? "Launching…"
                        : launched
                          ? "Launched"
                          : "✦ Use this variant — create campaign"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {launched ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="font-semibold">✓ Campaign created: {launched.name}</div>
              <p className="mt-1 text-xs">
                Scheduled for{" "}
                {new Date(draft.suggestedSendAt).toLocaleString()}. The
                WhatsApp template is in <b>DRAFT</b> — submit it to Meta for
                approval before the campaign can broadcast.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => router.push("/campaigns")}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                >
                  Open Campaigns →
                </button>
                <button
                  onClick={() => setLaunched(null)}
                  className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Plan another
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <b>Heads up:</b> Clicking "Use this variant" creates a scheduled
              Campaign + draft Template. The template still needs Meta approval
              before WhatsApp will actually broadcast it.
            </div>
          )}
        </section>
      )}
    </DashboardShell>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
