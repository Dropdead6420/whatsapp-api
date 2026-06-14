"use client";

// WhatsApp Templates dashboard.
//
// Lists tenant templates, lets operators create new ones, runs AI
// generation (T-055) for variant ideas, and predicts Meta's approval
// score BEFORE submission. The score badge is the headline UX win —
// operators stop guessing whether their template will pass review.

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type TemplateStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "FLAGGED";

interface Template {
  id: string;
  name: string;
  category: string;
  templateType: string | null;
  language: string;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  status: TemplateStatus;
  approvalReason: string | null;
  variants: string[];
  aiScoreApprovalChance: number | null;
  messageCount: number;
  successRate: number | null;
  createdAt: string;
  updatedAt: string;
}

interface AiVariant {
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  rationale: string;
}

interface PredictResult {
  score: number;
  verdict: "likely_approve" | "uncertain" | "likely_reject";
  reasons: string[];
}

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const CATEGORY_FILTERS = ["ALL", "MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const TYPE_FILTERS = [
  "ALL",
  "CUSTOM",
  "CATALOGUE",
  "FLOWS",
  "ORDER_DETAILS",
  "CAROUSEL",
  "OTP",
] as const;
const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
] as const;

function emptyDraft() {
  return {
    name: "",
    category: "MARKETING" as (typeof CATEGORIES)[number],
    language: "en_US",
    headerText: "",
    bodyText: "",
    footerText: "",
  };
}

function emptyAiInput() {
  return {
    industry: "",
    goal: "",
    tone: "friendly, concise",
    category: "MARKETING" as (typeof CATEGORIES)[number],
    samples: "",
    placeholders: "",
  };
}

export default function TemplatesPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [categoryFilter, setCategoryFilter] =
    useState<(typeof CATEGORY_FILTERS)[number]>("ALL");
  const [typeFilter, setTypeFilter] =
    useState<(typeof TYPE_FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // AI panel state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState(emptyAiInput());
  const [aiVariants, setAiVariants] = useState<AiVariant[] | null>(null);

  // Approval prediction for the currently displayed draft (used in
  // both edit & create modes).
  const [predict, setPredict] = useState<PredictResult | null>(null);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (categoryFilter !== "ALL" && t.category !== categoryFilter) return false;
      if (typeFilter !== "ALL" && (t.templateType ?? "CUSTOM") !== typeFilter) return false;
      if (q && !`${t.name} ${t.bodyText}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, statusFilter, categoryFilter, typeFilter, search]);

  async function refresh(nextSelectedId = selectedId) {
    try {
      const data = await api.get<Template[]>("/api/v1/templates");
      setTemplates(data);
      if (nextSelectedId && data.some((t) => t.id === nextSelectedId)) {
        setSelectedId(nextSelectedId);
      } else {
        setSelectedId(data[0]?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Template load failed.");
    }
  }

  async function syncTemplates() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<{ synced: number; created: number; updated: number }>(
        "/api/v1/templates/sync",
        {},
      );
      setNotice(
        `Synced ${result.synced} template${result.synced === 1 ? "" : "s"} from Meta — ${result.created} new, ${result.updated} updated.`,
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      category: (CATEGORIES as readonly string[]).includes(selected.category)
        ? (selected.category as (typeof CATEGORIES)[number])
        : "MARKETING",
      language: selected.language,
      headerText: selected.headerText ?? "",
      bodyText: selected.bodyText,
      footerText: selected.footerText ?? "",
    });
    setPredict(null);
  }, [selected]);

  function newTemplate() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setNotice(null);
    setErr(null);
    setPredict(null);
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selected) {
      // Backend doesn't ship a PATCH yet — for now, "edit" means
      // create a new template since names are unique per tenant.
      setErr(
        "Templates are immutable after creation (Meta requirement). Create a new template instead.",
      );
      return;
    }
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const body = {
        name: draft.name.trim(),
        category: draft.category,
        language: draft.language.trim() || "en_US",
        headerText: draft.headerText.trim() || undefined,
        bodyText: draft.bodyText,
        footerText: draft.footerText.trim() || undefined,
      };
      const created = await api.post<Template>("/api/v1/templates", body);
      setNotice(`Template "${created.name}" created as DRAFT.`);
      await refresh(created.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runAiGenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setAiVariants(null);
    try {
      const samples = aiInput.samples
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
      const placeholders = aiInput.placeholders
        .split(",")
        .map((p) => p.trim())
        .filter((p) => /^[A-Za-z][A-Za-z0-9_]*$/.test(p))
        .slice(0, 10);
      const result = await api.post<{ variants: AiVariant[] }>(
        "/api/v1/templates/ai/generate",
        {
          industry: aiInput.industry,
          goal: aiInput.goal,
          tone: aiInput.tone || undefined,
          category: aiInput.category,
          language: draft.language || "en",
          samples,
          placeholders,
        },
      );
      setAiVariants(result.variants);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "AI generate failed.");
    } finally {
      setBusy(false);
    }
  }

  function applyVariant(v: AiVariant) {
    setDraft((d) => ({
      ...d,
      headerText: v.headerText ?? "",
      bodyText: v.bodyText,
      footerText: v.footerText ?? "",
    }));
    setAiOpen(false);
    setNotice("Variant copied into the form. Review + save.");
    setPredict(null);
  }

  async function submitToMeta(templateId: string) {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/templates/${templateId}/submit`, {});
      setNotice("Template submitted to Meta for approval.");
      await refresh(templateId);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Submit to Meta failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runPredict() {
    if (!draft.bodyText.trim()) {
      setErr("Add a body before predicting approval.");
      return;
    }
    setBusy(true);
    setErr(null);
    setPredict(null);
    try {
      // If we're editing a saved template, score-and-persist. Otherwise
      // score raw fields (no persistence yet).
      const body = selected
        ? { templateId: selected.id }
        : {
            category: draft.category,
            language: draft.language || "en",
            headerText: draft.headerText.trim() || null,
            bodyText: draft.bodyText.trim(),
            footerText: draft.footerText.trim() || null,
          };
      const result = await api.post<PredictResult>(
        "/api/v1/templates/ai/predict-approval",
        body,
      );
      setPredict(result);
      if (selected) {
        // Refresh to pick up the persisted aiScoreApprovalChance.
        await refresh(selected.id);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Predict failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            WhatsApp Templates
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create templates for campaigns + workflow nodes. AI can draft
            variants and score Meta&apos;s approval likelihood before you
            submit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAiInput(emptyAiInput());
              setAiVariants(null);
              setAiOpen(true);
            }}
            className="rounded-md border border-violet-600 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-100"
          >
            ✦ Generate with AI
          </button>
          <button
            type="button"
            onClick={newTemplate}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            + Quick create
          </button>
          <button
            type="button"
            onClick={() => void syncTemplates()}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            ⟳ Sync Templates
          </button>
          <Link
            href="/templates/create"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700"
          >
            Create Template
          </Link>
        </div>
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            err
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        {/* List */}
        <aside className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2 border-b border-slate-100 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or body…"
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Category
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as (typeof CATEGORY_FILTERS)[number])}
                  className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                >
                  {CATEGORY_FILTERS.map((c) => (
                    <option key={c} value={c}>
                      {c === "ALL" ? "All categories" : c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Template Type
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as (typeof TYPE_FILTERS)[number])}
                  className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                >
                  {TYPE_FILTERS.map((t) => (
                    <option key={t} value={t}>
                      {t === "ALL" ? "All types" : t.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                    statusFilter === s
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
            {visibleTemplates.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                No templates yet. Click &quot;New template&quot; to create one,
                or use AI to draft variants.
              </li>
            )}
            {visibleTemplates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm transition ${
                    selectedId === t.id
                      ? "bg-emerald-50"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-medium text-slate-900">
                      {t.name}
                    </span>
                    <StatusPill status={t.status} />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{t.category}</span>
                    <span>·</span>
                    <span>{t.language}</span>
                    {t.aiScoreApprovalChance !== null && (
                      <>
                        <span>·</span>
                        <ApprovalBadge score={t.aiScoreApprovalChance} />
                      </>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Form */}
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-slate-700">
                Name
                <input
                  required
                  disabled={!!selected}
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      name: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                  placeholder="ramadan_sale_2026"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
                <span className="mt-1 block text-[10px] text-slate-400">
                  Lowercase, digits, underscore. Immutable after create.
                </span>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Category
                <select
                  disabled={!!selected}
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      category: e.target
                        .value as (typeof CATEGORIES)[number],
                    }))
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Language
                <input
                  disabled={!!selected}
                  value={draft.language}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, language: e.target.value }))
                  }
                  placeholder="en_US"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-slate-700">
              Header (≤ 60 chars, optional)
              <input
                disabled={!!selected}
                maxLength={60}
                value={draft.headerText}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, headerText: e.target.value }))
                }
                placeholder="Big news from {{1}}"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
              />
              <span className="mt-0.5 block text-[10px] text-slate-400">
                {draft.headerText.length} / 60
              </span>
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Body (required, ≤ 1024 chars)
              <textarea
                required
                disabled={!!selected}
                maxLength={1024}
                rows={6}
                value={draft.bodyText}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, bodyText: e.target.value }))
                }
                placeholder="Hi {{1}}, your order #{{2}} ships today. Reply STOP to opt out."
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
              />
              <span className="mt-0.5 block text-[10px] text-slate-400">
                {draft.bodyText.length} / 1024
              </span>
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Footer (≤ 60 chars, optional)
              <input
                disabled={!!selected}
                maxLength={60}
                value={draft.footerText}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, footerText: e.target.value }))
                }
                placeholder="Reply STOP to opt out"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
              />
              <span className="mt-0.5 block text-[10px] text-slate-400">
                {draft.footerText.length} / 60
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              {!selected && (
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  Create template
                </button>
              )}
              <button
                type="button"
                onClick={() => void runPredict()}
                disabled={busy || !draft.bodyText.trim()}
                className="rounded-md border border-violet-600 px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
              >
                ✦ Predict approval
              </button>
            </div>
          </form>

          {predict && <PredictPanel result={predict} />}

          {selected && (
            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-700">Status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusPill status={selected.status} />
                    {selected.aiScoreApprovalChance !== null && (
                      <ApprovalBadge
                        score={selected.aiScoreApprovalChance}
                        verbose
                      />
                    )}
                  </div>
                  {selected.approvalReason && (
                    <div className="mt-2 max-w-md text-[10px] text-amber-700">
                      Meta said: {selected.approvalReason}
                    </div>
                  )}
                </div>
                <div className="text-right text-[10px]">
                  <div>Sent: {selected.messageCount.toLocaleString()}</div>
                  {selected.successRate !== null && (
                    <div>
                      Success: {(selected.successRate * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              </div>
              {(selected.status === "DRAFT" || selected.status === "REJECTED") && (
                <button
                  type="button"
                  onClick={() => void submitToMeta(selected.id)}
                  disabled={busy}
                  className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Submit to Meta for approval
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* AI Generate Drawer */}
      {aiOpen && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center">
          <div className="w-full max-w-2xl rounded-t-lg bg-white shadow-2xl sm:rounded-lg">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">
                Generate template variants
              </h2>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </header>
            <form
              onSubmit={runAiGenerate}
              className="space-y-3 px-4 py-4 text-sm"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-700">
                  Industry
                  <input
                    required
                    value={aiInput.industry}
                    onChange={(e) =>
                      setAiInput((d) => ({ ...d, industry: e.target.value }))
                    }
                    placeholder="medical scrubs retail"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Goal
                  <input
                    required
                    value={aiInput.goal}
                    onChange={(e) =>
                      setAiInput((d) => ({ ...d, goal: e.target.value }))
                    }
                    placeholder="announce ramadan 20% off sale"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Category
                  <select
                    value={aiInput.category}
                    onChange={(e) =>
                      setAiInput((d) => ({
                        ...d,
                        category: e.target
                          .value as (typeof CATEGORIES)[number],
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Tone
                  <input
                    value={aiInput.tone}
                    onChange={(e) =>
                      setAiInput((d) => ({ ...d, tone: e.target.value }))
                    }
                    placeholder="friendly, concise"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-slate-700">
                Placeholders (comma-separated, alpha-numeric only)
                <input
                  value={aiInput.placeholders}
                  onChange={(e) =>
                    setAiInput((d) => ({ ...d, placeholders: e.target.value }))
                  }
                  placeholder="name, orderId"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-violet-500 focus:outline-none"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Past examples (one per line, up to 5)
                <textarea
                  value={aiInput.samples}
                  onChange={(e) =>
                    setAiInput((d) => ({ ...d, samples: e.target.value }))
                  }
                  rows={3}
                  placeholder="Hi {{1}}, we&apos;re running a sale this week..."
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:border-violet-500 focus:outline-none"
                />
              </label>
              <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {busy ? "Generating..." : "Generate 3 variants"}
                </button>
                <button
                  type="button"
                  onClick={() => setAiOpen(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>

            {aiVariants && (
              <div className="max-h-[50vh] space-y-3 overflow-y-auto border-t border-slate-200 p-4">
                {aiVariants.length === 0 && (
                  <p className="text-xs text-slate-500">
                    AI returned no variants. Try a different industry/goal
                    phrasing.
                  </p>
                )}
                {aiVariants.map((v, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Variant {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => applyVariant(v)}
                        className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700"
                      >
                        Use this
                      </button>
                    </div>
                    {v.headerText && (
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        Header
                      </div>
                    )}
                    {v.headerText && (
                      <div className="mb-1 text-xs font-medium text-slate-800">
                        {v.headerText}
                      </div>
                    )}
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Body
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-800">
                      {v.bodyText}
                    </div>
                    {v.footerText && (
                      <>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                          Footer
                        </div>
                        <div className="text-xs text-slate-600">
                          {v.footerText}
                        </div>
                      </>
                    )}
                    <div className="mt-2 rounded bg-violet-50 px-2 py-1 text-[10px] italic text-violet-800">
                      Why this works: {v.rationale}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

function StatusPill({ status }: { status: TemplateStatus }) {
  const styles: Record<TemplateStatus, string> = {
    DRAFT: "bg-slate-200 text-slate-700",
    SUBMITTED: "bg-blue-100 text-blue-700",
    APPROVED: "bg-emerald-100 text-emerald-700",
    REJECTED: "bg-red-100 text-red-700",
    FLAGGED: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function ApprovalBadge({
  score,
  verbose = false,
}: {
  score: number;
  verbose?: boolean;
}) {
  const verdict =
    score >= 0.75
      ? { label: "likely approve", color: "bg-emerald-600" }
      : score >= 0.4
        ? { label: "uncertain", color: "bg-amber-500" }
        : { label: "likely reject", color: "bg-red-600" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white ${verdict.color}`}
      title={`AI predicts ${(score * 100).toFixed(0)}% approval`}
    >
      ✦ {verbose ? verdict.label : `${(score * 100).toFixed(0)}%`}
    </span>
  );
}

function PredictPanel({ result }: { result: PredictResult }) {
  const verdictStyles = {
    likely_approve: "border-emerald-300 bg-emerald-50 text-emerald-900",
    uncertain: "border-amber-300 bg-amber-50 text-amber-900",
    likely_reject: "border-red-300 bg-red-50 text-red-900",
  };
  const verdictLabel = {
    likely_approve: "Likely to be approved",
    uncertain: "Approval uncertain",
    likely_reject: "Likely to be rejected",
  };
  return (
    <div
      className={`mt-3 rounded-md border px-3 py-2 text-xs ${verdictStyles[result.verdict]}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {verdictLabel[result.verdict]} ({(result.score * 100).toFixed(0)}%)
        </span>
      </div>
      {result.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {result.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
