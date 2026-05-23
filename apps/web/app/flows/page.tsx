"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface FlowSummary {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: string;
  triggerKeywords: string[];
  updatedAt: string;
}

interface FlowTemplate {
  slug: string;
  name: string;
  industry: string;
  description: string | null;
}

interface FlowDetail extends FlowSummary {
  definition: { nodes: unknown[]; edges?: unknown[] } | null;
  nodes: string;
}

interface FlowRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  resumeAt: string | null;
  currentNodeId: string | null;
  contactId: string | null;
  context: string;
  trail: string;
  error: string | null;
}

const FLOW_TRIGGERS = [
  { value: "keyword", label: "Keyword (WhatsApp)" },
  { value: "message_received", label: "Any inbound message" },
  { value: "lead_created", label: "Lead created" },
  { value: "tag_added", label: "Tag added to contact" },
  { value: "appointment_booked", label: "Appointment booked" },
  { value: "manual", label: "Manual / API only" },
] as const;

const STARTER_FLOW = {
  name: "Price inquiry auto-reply",
  description: "Replies when a customer asks about prices.",
  trigger: "keyword" as const,
  triggerKeywords: ["prices", "price", "pricing"],
  isActive: false,
  definition: {
    nodes: [
      { id: "start", type: "START", isEntry: true, config: {}, next: "reply" },
      {
        id: "reply",
        type: "MESSAGE",
        config: {
          text:
            "Hi! Our service prices: Haircut Rs 800, Spa Rs 1500. Reply BOOK to schedule.",
        },
        next: "tag",
      },
      { id: "tag", type: "ADD_TAG", config: { tag: "price_inquiry" }, next: "done" },
      { id: "done", type: "END", config: {} },
    ],
  },
};

export default function FlowsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [testRunStatus, setTestRunStatus] = useState<string | null>(null);
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [triggerDraft, setTriggerDraft] = useState("");
  const [keywordsDraft, setKeywordsDraft] = useState("");
  const [savingTrigger, setSavingTrigger] = useState(false);

  async function refresh() {
    try {
      const list = await api.get<FlowSummary[]>("/api/v1/flows");
      setFlows(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Load failed");
    }
  }

  async function loadTemplates() {
    try {
      const list = await api.get<FlowTemplate[]>("/api/v1/flow-templates");
      setTemplates(list);
    } catch {
      setTemplates([]);
    }
  }

  async function installTemplate(slug: string) {
    setInstalling(slug);
    setErr(null);
    try {
      const res = await api.post<{ flowId: string; name: string }>(
        `/api/v1/flow-templates/${slug}/install`,
        {},
      );
      await refresh();
      setSelectedId(res.flowId);
      setTestRunStatus(`Installed “${res.name}” (inactive — activate when ready).`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Install failed");
    } finally {
      setInstalling(null);
    }
  }

  async function loadDetail(id: string) {
    try {
      const [d, r] = await Promise.all([
        api.get<FlowDetail>(`/api/v1/flows/${id}`),
        api.get<FlowRun[]>(`/api/v1/flows/${id}/runs`),
      ]);
      setDetail(d);
      setRuns(r);
      setTriggerDraft(d.trigger);
      setKeywordsDraft(d.triggerKeywords.join(", "));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Detail load failed");
    }
  }

  useEffect(() => {
    if (user) {
      void refresh();
      void loadTemplates();
    }
  }, [user]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  async function saveTriggerSettings() {
    if (!detail) return;
    setSavingTrigger(true);
    setErr(null);
    try {
      const triggerKeywords = keywordsDraft
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      await api.patch(`/api/v1/flows/${detail.id}`, {
        trigger: triggerDraft,
        triggerKeywords,
      });
      await refresh();
      await loadDetail(detail.id);
      setTestRunStatus("Trigger settings saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed");
    } finally {
      setSavingTrigger(false);
    }
  }

  async function toggleActive(f: FlowSummary) {
    try {
      await api.patch(`/api/v1/flows/${f.id}`, { isActive: !f.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Toggle failed");
    }
  }

  async function createStarter() {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<{ id: string }>("/api/v1/flows", STARTER_FLOW);
      await refresh();
      setSelectedId(created.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this flow? Running flow instances will not be affected."))
      return;
    try {
      await api.delete(`/api/v1/flows/${id}`);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed");
    }
  }

  async function testRun() {
    if (!selectedId) return;
    setTestRunStatus("Running…");
    try {
      const result = await api.post<FlowRun>(
        `/api/v1/flows/${selectedId}/test-run`,
        { triggerText: "test-run from admin" },
      );
      setTestRunStatus(`Test ${result.status} — node: ${result.currentNodeId ?? "end"}`);
      await loadDetail(selectedId);
    } catch (e) {
      setTestRunStatus(
        e instanceof ApiClientError ? `Failed: ${e.message}` : "Failed",
      );
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Flows</h1>
          <p className="text-sm text-slate-500">
            Trigger automations when customers send WhatsApp messages. Inbound
            keyword → message reply, tag, AI response, agent transfer, webhook.
          </p>
        </div>
        <button
          onClick={createStarter}
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Creating…" : "+ Starter flow"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {templates.length > 0 && (
        <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Marketplace templates</h2>
          <p className="mt-1 text-xs text-slate-500">
            Install a pre-built flow, then edit and activate it.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <div
                key={t.slug}
                className="rounded-md border border-slate-100 p-3 text-sm"
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-slate-500">{t.industry}</div>
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{t.description}</p>
                )}
                <button
                  type="button"
                  disabled={installing === t.slug}
                  onClick={() => installTemplate(t.slug)}
                  className="mt-2 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                >
                  {installing === t.slug ? "Installing…" : "Install"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Flow list */}
        <div className="space-y-2 lg:col-span-1">
          {flows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              No flows yet. Tap "+ Starter flow" to create a price-inquiry
              auto-reply you can edit.
            </div>
          ) : (
            flows.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`block w-full rounded-lg border p-4 text-left transition-colors ${
                  selectedId === f.id
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{f.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      f.isActive
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {f.isActive ? "Active" : "Off"}
                  </span>
                </div>
                {f.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                    {f.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.triggerKeywords.slice(0, 5).map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono"
                    >
                      /{kw}
                    </span>
                  ))}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {detail ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{detail.name}</h2>
                    <p className="text-sm text-slate-500">{detail.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/flows/${detail.id}/edit`}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      ✎ Edit
                    </Link>
                    <button
                      onClick={() => toggleActive(detail)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        detail.isActive
                          ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      {detail.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={testRun}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                    >
                      ✦ Test run
                    </button>
                    <button
                      onClick={() => remove(detail.id)}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {testRunStatus && (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                    {testRunStatus}
                  </div>
                )}

                <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Trigger settings
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="text-slate-600">When to start</span>
                      <select
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                        value={triggerDraft}
                        onChange={(e) => setTriggerDraft(e.target.value)}
                      >
                        {FLOW_TRIGGERS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(triggerDraft === "keyword" || triggerDraft === "tag_added") && (
                      <label className="block text-sm sm:col-span-2">
                        <span className="text-slate-600">
                          {triggerDraft === "tag_added"
                            ? "Tags (comma-separated, empty = any tag)"
                            : "Keywords (comma-separated)"}
                        </span>
                        <input
                          className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                          value={keywordsDraft}
                          onChange={(e) => setKeywordsDraft(e.target.value)}
                          placeholder="book, price, vip"
                        />
                      </label>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveTriggerSettings()}
                    disabled={savingTrigger}
                    className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {savingTrigger ? "Saving…" : "Save trigger"}
                  </button>
                </div>

                <div className="mt-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Nodes
                  </h3>
                  {detail.definition ? (
                    <ol className="space-y-1.5 text-sm">
                      {(detail.definition.nodes as Array<{
                        id: string;
                        type: string;
                        next?: string;
                        config?: Record<string, unknown>;
                      }>).map((n) => (
                        <li
                          key={n.id}
                          className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-1.5"
                        >
                          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px]">
                            {n.type}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {n.id}
                          </span>
                          <span className="ml-auto truncate text-[11px] text-slate-500">
                            {n.next ? `→ ${n.next}` : "(end)"}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-slate-500">JSON malformed.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Recent runs
                </h3>
                {runs.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No runs yet. Click "Test run" or trigger via WhatsApp.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {runs.slice(0, 8).map((r) => (
                      <details
                        key={r.id}
                        className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs"
                      >
                        <summary className="flex cursor-pointer items-center justify-between">
                          <span>
                            <b className="font-mono">{r.status}</b>
                            <span className="ml-2 text-slate-500">
                              {new Date(r.startedAt).toLocaleString()}
                            </span>
                          </span>
                          {r.error && (
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                              error
                            </span>
                          )}
                        </summary>
                        <div className="mt-2 space-y-1">
                          {(() => {
                            try {
                              const trail = JSON.parse(r.trail) as Array<{
                                nodeId: string;
                                type: string;
                                at: string;
                                result?: Record<string, unknown>;
                                error?: string;
                              }>;
                              return trail.map((t, i) => (
                                <div
                                  key={i}
                                  className="rounded bg-white p-1.5 font-mono text-[11px]"
                                >
                                  <span className="text-slate-400">
                                    {t.at.slice(11, 19)}
                                  </span>{" "}
                                  <b>{t.type}</b>{" "}
                                  <span className="text-slate-500">{t.nodeId}</span>
                                  {t.error ? (
                                    <span className="ml-2 text-red-600">
                                      {t.error}
                                    </span>
                                  ) : t.result && Object.keys(t.result).length > 0 ? (
                                    <span className="ml-2 text-slate-500">
                                      {JSON.stringify(t.result)}
                                    </span>
                                  ) : null}
                                </div>
                              ));
                            } catch {
                              return null;
                            }
                          })()}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
              Pick a flow from the list to see its nodes and recent runs.
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
