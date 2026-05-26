"use client";

// Drip sequences dashboard. Lists this tenant's sequences, lets operators
// create + edit them, and surfaces enrollment counts. The detail view
// (enrollments per sequence) is reachable from the row "View" action which
// inlines an expandable enrollments panel.

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
type Trigger = "MANUAL" | "CONTACT_CREATED" | "TAG_ADDED";
type EnrollmentStatus = "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";

interface DripStep {
  delayHours: number;
  templateId: string;
  languageCode?: string;
  bodyParams?: string[];
}

interface DripSequence {
  id: string;
  name: string;
  description: string | null;
  status: Status;
  trigger: Trigger;
  triggerTag: string | null;
  steps: DripStep[];
  createdAt: string;
  updatedAt: string;
  _count: { enrollments: number };
}

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
}

interface Enrollment {
  id: string;
  sequenceId: string;
  currentStep: number;
  status: EnrollmentStatus;
  nextStepAt: string | null;
  lastStepAt: string | null;
  sentCount: number;
  failedCount: number;
  lastError: string | null;
  contact: { id: string; name: string; phoneNumber: string };
  createdAt: string;
}

function statusBadge(s: Status): string {
  switch (s) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-800";
    case "DRAFT":
      return "bg-slate-200 text-slate-700";
    case "PAUSED":
      return "bg-amber-100 text-amber-800";
    case "ARCHIVED":
      return "bg-slate-100 text-slate-500";
  }
}

function enrollmentBadge(s: EnrollmentStatus): string {
  switch (s) {
    case "RUNNING":
      return "bg-emerald-100 text-emerald-800";
    case "COMPLETED":
      return "bg-indigo-100 text-indigo-800";
    case "CANCELLED":
      return "bg-slate-200 text-slate-600";
    case "FAILED":
      return "bg-red-100 text-red-700";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DripSequencesPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enrollmentsById, setEnrollmentsById] = useState<
    Record<string, Enrollment[]>
  >({});

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const [seqs, tmpls] = await Promise.all([
        api.get<DripSequence[]>("/api/v1/drip-sequences"),
        api.get<Template[]>("/api/v1/templates"),
      ]);
      setSequences(seqs);
      setTemplates(tmpls);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load: ${e.message}`
          : "Failed to load drip sequences.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadEnrollments(sequenceId: string) {
    try {
      const rows = await api.get<Enrollment[]>(
        `/api/v1/drip-sequences/${sequenceId}/enrollments`,
      );
      setEnrollmentsById((prev) => ({ ...prev, [sequenceId]: rows }));
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load enrollments: ${e.message}`
          : "Failed to load enrollments.",
      );
    }
  }

  function toggleExpand(sequenceId: string) {
    if (expandedId === sequenceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sequenceId);
    if (!enrollmentsById[sequenceId]) {
      void loadEnrollments(sequenceId);
    }
  }

  async function patchStatus(id: string, status: Status) {
    try {
      await api.patch(`/api/v1/drip-sequences/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to update sequence status.",
      );
    }
  }

  async function cancelEnrollment(sequenceId: string, enrollmentId: string) {
    try {
      await api.delete(`/api/v1/drip-sequences/enrollments/${enrollmentId}`);
      await loadEnrollments(sequenceId);
      await refresh();
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to cancel enrollment.",
      );
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const stats = {
    total: sequences.length,
    active: sequences.filter((s) => s.status === "ACTIVE").length,
    enrolled: sequences.reduce((sum, s) => sum + s._count.enrollments, 0),
  };

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Drip sequences
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Multi-step WhatsApp campaigns triggered by contact events. Each
            contact moves through the steps on the schedule you set.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            New sequence
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Total sequences" value={stats.total} accent="slate" />
        <Stat
          label="Active"
          value={stats.active}
          accent={stats.active > 0 ? "emerald" : "slate"}
        />
        <Stat label="Total enrollments" value={stats.enrolled} accent="indigo" />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {sequences.length === 0 && !busy && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No drip sequences yet. Click <strong>New sequence</strong> to build
            your first multi-step WhatsApp flow.
          </div>
        )}
        {sequences.length > 0 && (
          <div className="divide-y divide-slate-100">
            {sequences.map((seq) => {
              const expanded = expandedId === seq.id;
              const enrollments = enrollmentsById[seq.id];
              return (
                <article key={seq.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-slate-900">
                          {seq.name}
                        </h2>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge(seq.status)}`}
                        >
                          {seq.status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          {seq.trigger === "TAG_ADDED"
                            ? `Tag: ${seq.triggerTag ?? "—"}`
                            : seq.trigger.replace("_", " ").toLowerCase()}
                        </span>
                      </div>
                      {seq.description && (
                        <p className="mt-1 text-xs text-slate-500">
                          {seq.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                        <span>
                          {seq.steps.length} step
                          {seq.steps.length === 1 ? "" : "s"}
                        </span>
                        <span>·</span>
                        <span>
                          {seq._count.enrollments} enrolled
                        </span>
                        <span>·</span>
                        <span>Updated {fmtDate(seq.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {seq.status === "DRAFT" && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(seq.id, "ACTIVE")}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Activate
                        </button>
                      )}
                      {seq.status === "ACTIVE" && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(seq.id, "PAUSED")}
                          className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
                        >
                          Pause
                        </button>
                      )}
                      {seq.status === "PAUSED" && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(seq.id, "ACTIVE")}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Resume
                        </button>
                      )}
                      {seq.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          onClick={() => void patchStatus(seq.id, "ARCHIVED")}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpand(seq.id)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {expanded ? "Hide" : "Enrollments"}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-3">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Steps
                      </h3>
                      <ol className="mb-4 space-y-1 text-xs text-slate-700">
                        {seq.steps.map((step, idx) => {
                          const tmpl = templates.find(
                            (t) => t.id === step.templateId,
                          );
                          return (
                            <li
                              key={idx}
                              className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
                            >
                              <span className="font-mono text-[10px] text-slate-500">
                                #{idx + 1}
                              </span>
                              <span className="font-medium">
                                Wait {step.delayHours}h
                              </span>
                              <span className="text-slate-400">→</span>
                              <span>
                                Template:{" "}
                                <span className="font-medium">
                                  {tmpl?.name ?? step.templateId.slice(0, 8) + "…"}
                                </span>
                                {step.languageCode && (
                                  <span className="ml-1 font-mono text-[10px] text-slate-500">
                                    ({step.languageCode})
                                  </span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ol>

                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Enrollments
                      </h3>
                      {!enrollments && (
                        <div className="text-xs text-slate-500">
                          Loading enrollments…
                        </div>
                      )}
                      {enrollments && enrollments.length === 0 && (
                        <div className="text-xs text-slate-500">
                          No contacts enrolled yet.
                        </div>
                      )}
                      {enrollments && enrollments.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-2 py-1 font-semibold">Contact</th>
                                <th className="px-2 py-1 font-semibold">Status</th>
                                <th className="px-2 py-1 font-semibold">Step</th>
                                <th className="px-2 py-1 font-semibold">Next fire</th>
                                <th className="px-2 py-1 font-semibold">Sent</th>
                                <th className="px-2 py-1 font-semibold">&nbsp;</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {enrollments.map((e) => (
                                <tr key={e.id} className="bg-white">
                                  <td className="px-2 py-1.5">
                                    <Link
                                      href={`/contacts/${e.contact.id}`}
                                      className="font-medium text-emerald-700 hover:text-emerald-800"
                                    >
                                      {e.contact.name}
                                    </Link>
                                    <div className="font-mono text-[10px] text-slate-500">
                                      {e.contact.phoneNumber}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${enrollmentBadge(e.status)}`}
                                    >
                                      {e.status}
                                    </span>
                                    {e.lastError && (
                                      <div className="text-[10px] text-red-600">
                                        {e.lastError}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono tabular-nums">
                                    {e.currentStep + 1} / {seq.steps.length}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">
                                    {fmtDate(e.nextStepAt)}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono tabular-nums">
                                    {e.sentCount}
                                    {e.failedCount > 0 && (
                                      <span className="ml-1 text-red-600">
                                        ({e.failedCount} failed)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {e.status === "RUNNING" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void cancelEnrollment(seq.id, e.id)
                                        }
                                        className="text-[10px] font-medium text-red-700 hover:text-red-900"
                                      >
                                        Cancel
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCreate && (
        <CreateDialog
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await refresh();
          }}
        />
      )}
    </DashboardShell>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald" | "indigo";
}) {
  const map = {
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${map[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

interface CreateDialogProps {
  templates: Template[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

function CreateDialog({ templates, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("MANUAL");
  const [triggerTag, setTriggerTag] = useState("");
  const [steps, setSteps] = useState<DripStep[]>([
    { delayHours: 0, templateId: templates[0]?.id ?? "", languageCode: "en_US" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patchStep(idx: number, patch: Partial<DripStep>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        delayHours: 24,
        templateId: templates[0]?.id ?? "",
        languageCode: "en_US",
      },
    ]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    if (steps.some((s) => !s.templateId)) {
      setErr("Every step needs a template.");
      return;
    }
    if (trigger === "TAG_ADDED" && !triggerTag.trim()) {
      setErr("Trigger tag is required for TAG_ADDED.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.post("/api/v1/drip-sequences", {
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
        triggerTag: trigger === "TAG_ADDED" ? triggerTag.trim() : undefined,
        steps,
      });
      await onCreated();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to create sequence.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            New drip sequence
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {err && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {err}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Welcome sequence for new salon clients"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Description
            <textarea
              maxLength={800}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional. What goal does this sequence serve?"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700">
              Trigger
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as Trigger)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="MANUAL">Manual (API/CSV)</option>
                <option value="CONTACT_CREATED">When a contact is created</option>
                <option value="TAG_ADDED">When a tag is added</option>
              </select>
            </label>
            {trigger === "TAG_ADDED" && (
              <label className="block text-xs font-semibold text-slate-700">
                Trigger tag
                <input
                  value={triggerTag}
                  onChange={(e) => setTriggerTag(e.target.value)}
                  placeholder="e.g. spa-trial"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </label>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Steps ({steps.length})
              </h3>
              <button
                type="button"
                onClick={addStep}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                + Add step
              </button>
            </div>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">
                      Step #{idx + 1}
                    </span>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="text-red-700 hover:text-red-900"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr_120px]">
                    <label className="block text-[10px] font-semibold text-slate-600">
                      Delay (hours)
                      <input
                        type="number"
                        min={0}
                        max={24 * 30}
                        value={step.delayHours}
                        onChange={(e) =>
                          patchStep(idx, {
                            delayHours: Number(e.target.value),
                          })
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="block text-[10px] font-semibold text-slate-600">
                      Template
                      <select
                        value={step.templateId}
                        onChange={(e) =>
                          patchStep(idx, { templateId: e.target.value })
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="">— pick a template —</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.status})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[10px] font-semibold text-slate-600">
                      Language
                      <input
                        value={step.languageCode ?? "en_US"}
                        onChange={(e) =>
                          patchStep(idx, { languageCode: e.target.value })
                        }
                        maxLength={10}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create as draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
