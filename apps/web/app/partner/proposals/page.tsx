"use client";

import { CheckCircle2, FileText, Save, Send, Sparkles, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { useAuth } from "../../../src/hooks/useAuth";
import { ApiClientError, api } from "../../../src/lib/api";

type ProposalStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";

interface ProposalBrief {
  prospectName: string;
  industry: string;
  goals?: string;
  scale?: string;
  budget?: string;
  currency?: string;
}

interface ProposalContent {
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
}

interface GeneratedProposal {
  title: string;
  content: ProposalContent;
  currency: string;
  estimatedValue: number | null;
  source: "ai" | "fallback";
}

interface ProposalRow {
  id: string;
  prospectName: string;
  industry: string;
  title: string;
  currency: string;
  estimatedValue: number | null;
  status: ProposalStatus;
  source: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS: ProposalStatus[] = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"];

export default function PartnerProposalsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [brief, setBrief] = useState<ProposalBrief>({
    prospectName: "",
    industry: "salon",
    goals: "",
    scale: "",
    budget: "",
    currency: "INR",
  });
  const [draft, setDraft] = useState<GeneratedProposal | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const suffix = statusFilter === "ALL" ? "" : `?status=${statusFilter}`;
      const rows = await api.get<ProposalRow[]>(`/api/v1/partner/proposals${suffix}`);
      setProposals(rows);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load proposals");
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user, statusFilter]);

  async function generateDraft() {
    if (!brief.prospectName.trim() || !brief.industry.trim()) return;
    setBusy("generate");
    setErr(null);
    try {
      const result = await api.post<GeneratedProposal>("/api/v1/partner/proposals/generate", {
        prospectName: brief.prospectName.trim(),
        industry: brief.industry.trim(),
        goals: brief.goals?.trim() || undefined,
        scale: brief.scale?.trim() || undefined,
        budget: brief.budget?.trim() || undefined,
        currency: brief.currency?.trim() || "INR",
      });
      setDraft(result);
      setDraftJson(JSON.stringify(result, null, 2));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to generate proposal");
    } finally {
      setBusy(null);
    }
  }

  async function saveProposal() {
    if (!draftJson.trim()) return;
    setBusy("save");
    setErr(null);
    try {
      const parsed = JSON.parse(draftJson) as GeneratedProposal;
      await api.post<ProposalRow>("/api/v1/partner/proposals", {
        brief: {
          prospectName: brief.prospectName.trim(),
          industry: brief.industry.trim(),
          goals: brief.goals?.trim() || undefined,
          scale: brief.scale?.trim() || undefined,
          budget: brief.budget?.trim() || undefined,
          currency: brief.currency?.trim() || "INR",
        },
        draft: parsed,
      });
      setDraft(null);
      setDraftJson("");
      await load();
    } catch (e) {
      if (e instanceof SyntaxError) {
        setErr("Proposal JSON is invalid. Fix it before saving.");
      } else {
        setErr(e instanceof ApiClientError ? e.message : "Failed to save proposal");
      }
    } finally {
      setBusy(null);
    }
  }

  async function setProposalStatus(id: string, status: ProposalStatus) {
    setBusy(`status:${id}`);
    setErr(null);
    try {
      await api.patch<ProposalRow>(`/api/v1/partner/proposals/${id}/status`, { status });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to update proposal");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading proposals...</div>;
  }

  const preview = draft?.content;

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
            Partner sales
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            AI Proposal Generator
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Turn a prospect brief into a polished WhatsApp automation proposal with pricing, ROI, and timeline.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProposalStatus | "ALL")}
          className="w-fit rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500"
        >
          <option value="ALL">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>

      {err && (
        <div className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
            <Sparkles className="h-3.5 w-3.5" />
            Draft builder
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Prospect name"
              value={brief.prospectName}
              placeholder="Cutz & Bangs"
              onChange={(value) => setBrief((prev) => ({ ...prev, prospectName: value }))}
            />
            <Field
              label="Industry"
              value={brief.industry}
              placeholder="salon"
              onChange={(value) => setBrief((prev) => ({ ...prev, industry: value }))}
            />
            <Field
              label="Scale"
              value={brief.scale ?? ""}
              placeholder="2 branches, 8 staff"
              onChange={(value) => setBrief((prev) => ({ ...prev, scale: value }))}
            />
            <Field
              label="Budget"
              value={brief.budget ?? ""}
              placeholder="INR 8k-15k monthly"
              onChange={(value) => setBrief((prev) => ({ ...prev, budget: value }))}
            />
            <Field
              label="Currency"
              value={brief.currency ?? "INR"}
              placeholder="INR"
              onChange={(value) => setBrief((prev) => ({ ...prev, currency: value }))}
            />
            <label className="text-xs font-semibold text-slate-300 sm:col-span-2">
              Goals and pain points
              <textarea
                value={brief.goals ?? ""}
                onChange={(e) => setBrief((prev) => ({ ...prev, goals: e.target.value }))}
                placeholder="Missed appointment leads, slow replies, no campaign analytics..."
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              />
            </label>
            <button
              onClick={generateDraft}
              disabled={busy === "generate" || !brief.prospectName.trim() || !brief.industry.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50 sm:col-span-2"
            >
              <Sparkles className="h-4 w-4" />
              {busy === "generate" ? "Generating..." : "Generate proposal"}
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Editable JSON
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Adjust pricing, features, or timeline before saving.
                </p>
              </div>
              <button
                onClick={saveProposal}
                disabled={busy === "save" || !draftJson.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {busy === "save" ? "Saving..." : "Save"}
              </button>
            </div>
            <textarea
              value={draftJson}
              onChange={(e) => setDraftJson(e.target.value)}
              rows={15}
              spellCheck={false}
              placeholder="Generated proposal JSON appears here."
              className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
          {preview ? (
            <div className="space-y-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                    {draft.source}
                  </span>
                  <h2 className="mt-3 text-xl font-black tracking-tight text-white">{draft.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{preview.executiveSummary}</p>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Monthly</div>
                  <div className="text-xl font-black text-white">
                    {preview.recommendedPlan.currency} {preview.recommendedPlan.priceMonthly.toLocaleString()}
                  </div>
                </div>
              </div>

              <PreviewSection title="Pain points" items={preview.painPoints} />
              <PreviewSection title={preview.recommendedPlan.name} items={preview.recommendedPlan.features} />

              <div className="grid gap-3 sm:grid-cols-2">
                {preview.roiEstimate.metrics.map((metric) => (
                  <div key={`${metric.label}-${metric.value}`} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{metric.label}</div>
                    <div className="mt-1 text-sm font-bold text-white">{metric.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-sm leading-6 text-slate-400">{preview.roiEstimate.summary}</p>

              <div className="space-y-3">
                {preview.timeline.map((step) => (
                  <div key={`${step.phase}-${step.duration}`} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold text-white">{step.phase}</div>
                      <div className="text-xs font-semibold text-indigo-300">{step.duration}</div>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{step.detail}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm font-semibold leading-6 text-indigo-100">
                {preview.callToAction}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-slate-800 p-8 text-center">
              <div>
                <FileText className="mx-auto h-10 w-10 text-indigo-300" />
                <h2 className="mt-3 text-base font-bold text-white">Proposal preview appears here</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                  Generate a draft from a prospect brief, then save it into your proposal pipeline.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Proposal pipeline</h2>
            <p className="mt-1 text-xs text-slate-400">Move proposals from draft to sent, then accepted or declined.</p>
          </div>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Prospect</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {proposals.map((proposal) => (
                <tr key={proposal.id} className="bg-slate-950/30 hover:bg-slate-950/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{proposal.prospectName}</div>
                    <div className="mt-1 text-slate-500">{proposal.industry} - {proposal.title}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {proposal.estimatedValue
                      ? `${proposal.currency} ${proposal.estimatedValue.toLocaleString()}`
                      : "n/a"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={proposal.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(proposal.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {proposal.status === "DRAFT" && (
                        <IconAction
                          label="Mark sent"
                          disabled={busy === `status:${proposal.id}`}
                          onClick={() => setProposalStatus(proposal.id, "SENT")}
                          icon={<Send className="h-4 w-4" />}
                        />
                      )}
                      {proposal.status === "SENT" && (
                        <>
                          <IconAction
                            label="Accept"
                            disabled={busy === `status:${proposal.id}`}
                            onClick={() => setProposalStatus(proposal.id, "ACCEPTED")}
                            icon={<CheckCircle2 className="h-4 w-4" />}
                          />
                          <IconAction
                            label="Decline"
                            disabled={busy === `status:${proposal.id}`}
                            onClick={() => setProposalStatus(proposal.id, "DECLINED")}
                            icon={<XCircle className="h-4 w-4" />}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={5}>
                    No proposals yet. Generate one from the builder above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PartnerShell>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-semibold text-slate-300">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
      />
    </label>
  );
}

function PreviewSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <div key={item} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm leading-6 text-slate-300">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  const className =
    status === "ACCEPTED"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : status === "SENT"
        ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
        : status === "DECLINED"
          ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
          : "border-slate-700 bg-slate-800 text-slate-300";
  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${className}`}>
      {status}
    </span>
  );
}

function IconAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
    >
      {icon}
    </button>
  );
}
