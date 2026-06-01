"use client";

// AI Agent Builder dashboard (T-052 slices 1-4 frontend).
//
// Mirror of /knowledge-base structure:
//   - left rail: filter pills + searchable list
//   - right pane: create/edit form + lifecycle buttons + set-default toggle
//   - top of right pane: settings card (the aiAgentAutoReply switch)
//   - bottom of right pane: test-drive panel
//
// All write paths go through routes shipped in slices 1-4.

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type AgentStatus = "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED";
type Provider = "openai" | "anthropic";
type Fallback = "ESCALATE_TO_HUMAN" | "SEND_TEMPLATE" | "SILENT";

interface KnowledgeScope {
  categories: string[];
  tags: string[];
  topK: number;
}

interface Agent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  persona: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  knowledgeScope: KnowledgeScope;
  tools: string[];
  fallbackBehavior: Fallback;
  fallbackTemplateId: string | null;
  isDefault: boolean;
  status: AgentStatus;
  publishedAt: string | null;
  disabledAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentListResponse {
  agents: Agent[];
  pagination: { page: number; limit: number; total: number };
}

interface TestRunResult {
  reply: string | null;
  toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }>;
  citations: Array<{
    entryId: string;
    title: string;
    category: string;
    score: number;
    snippet: string;
  }>;
  escalated: boolean;
  escalationBehavior: Fallback | null;
  modelUsed: string | null;
  providerUsed: "anthropic" | "openai" | null;
  reason: string;
}

const PROVIDERS = ["openai", "anthropic"] as const;
const MODEL_PRESETS: Record<
  (typeof PROVIDERS)[number],
  Array<{ label: string; model: string; hint: string }>
> = {
  openai: [
    {
      label: "Fast support",
      model: "gpt-4o-mini",
      hint: "Low-latency inbox answers and test runs.",
    },
    {
      label: "High reasoning",
      model: "gpt-4o",
      hint: "Complex sales or support conversations.",
    },
  ],
  anthropic: [
    {
      label: "Fast support",
      model: "claude-3-5-haiku-latest",
      hint: "Quick, concise WhatsApp responses.",
    },
    {
      label: "High reasoning",
      model: "claude-3-5-sonnet-latest",
      hint: "Richer reasoning with KB grounding.",
    },
  ],
};
const ALLOWED_TOOLS = [
  "CREATE_LEAD",
  "ADD_TAG",
  "BOOK_APPOINTMENT",
  "TRANSFER_TO_HUMAN",
  "SEND_TEMPLATE",
  "LOOKUP_CONTACT",
  "LOOKUP_ORDER",
] as const;
const TOOL_HELP: Record<(typeof ALLOWED_TOOLS)[number], string> = {
  CREATE_LEAD: "Creates a CRM lead from the conversation.",
  ADD_TAG: "Adds a contact tag such as pricing or vip.",
  BOOK_APPOINTMENT: "Books against the tenant service calendar.",
  TRANSFER_TO_HUMAN: "Escalates to the routing queue.",
  SEND_TEMPLATE: "Resolves a template for a downstream send node.",
  LOOKUP_CONTACT: "Reads the current contact profile.",
  LOOKUP_ORDER: "Reserved for commerce integrations.",
};
const FALLBACKS: Fallback[] = ["ESCALATE_TO_HUMAN", "SEND_TEMPLATE", "SILENT"];
const FALLBACK_HELP: Record<Fallback, string> = {
  ESCALATE_TO_HUMAN: "Transfer unresolved conversations to an agent.",
  SEND_TEMPLATE: "Return a named template id for a downstream template send.",
  SILENT: "Do nothing if the model cannot answer safely.",
};
const STATUS_FILTERS = ["ALL", "DRAFT", "ACTIVE", "DISABLED", "ARCHIVED"] as const;
const KB_CATEGORIES = [
  "FAQ",
  "SERVICE",
  "PRODUCT",
  "POLICY",
  "HOURS",
  "LOCATION",
  "OTHER",
] as const;

function emptyDraft() {
  return {
    name: "",
    description: "",
    persona: "You are a helpful assistant for our business. Be concise and friendly.",
    provider: "openai" as Provider,
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 800,
    knowledgeCategories: [] as string[],
    knowledgeTags: "",
    knowledgeTopK: 5,
    tools: [] as string[],
    fallbackBehavior: "ESCALATE_TO_HUMAN" as Fallback,
    fallbackTemplateId: "",
  };
}

function providerForModel(model: string): Provider {
  return model.toLowerCase().startsWith("claude") ? "anthropic" : "openai";
}

function preferredModel(provider: Provider): string {
  return MODEL_PRESETS[provider][0].model;
}

function parseDraftNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export default function AiAgentsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [autoReply, setAutoReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Test-drive panel state.
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const activeAgents = useMemo(
    () => agents.filter((a) => a.status === "ACTIVE"),
    [agents],
  );
  const selectedPreset = useMemo(
    () => MODEL_PRESETS[draft.provider].find((p) => p.model === draft.model),
    [draft.model, draft.provider],
  );

  // Filtered list — search is client-side since the dataset is small
  // (tenants typically have <10 agents). If we ever see hundreds,
  // promote this to a server-side `?search=` query.
  const visibleAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q),
    );
  }, [agents, search]);

  async function refreshAgents(nextSelectedId = selectedId) {
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const data = await api.get<AgentListResponse>(
        `/api/v1/ai-agents?${params.toString()}`,
      );
      setAgents(data.agents);
      if (nextSelectedId && data.agents.some((a) => a.id === nextSelectedId)) {
        setSelectedId(nextSelectedId);
      } else {
        setSelectedId(data.agents[0]?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Agent list load failed.");
    }
  }

  async function refreshSettings() {
    try {
      const data = await api.get<{ aiAgentAutoReply: boolean }>(
        "/api/v1/ai-agents/settings",
      );
      setAutoReply(data.aiAgentAutoReply);
    } catch (e) {
      // Settings is best-effort — if the endpoint 404s (older deploy)
      // we just leave the toggle off; the master switch stays off.
      console.warn("[ai-agents] settings load failed", e);
    }
  }

  useEffect(() => {
    if (user) {
      void refreshAgents();
      void refreshSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      description: selected.description ?? "",
      persona: selected.persona,
      provider: (selected.provider === "anthropic"
        ? "anthropic"
        : "openai") as Provider,
      model: selected.model,
      temperature: selected.temperature,
      maxTokens: selected.maxTokens,
      knowledgeCategories: selected.knowledgeScope?.categories ?? [],
      knowledgeTags: (selected.knowledgeScope?.tags ?? []).join(", "),
      knowledgeTopK: selected.knowledgeScope?.topK ?? 5,
      tools: selected.tools,
      fallbackBehavior: selected.fallbackBehavior,
      fallbackTemplateId: selected.fallbackTemplateId ?? "",
    });
    setTestResult(null);
  }, [selected]);

  function newAgent() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setNotice(null);
    setErr(null);
    setTestResult(null);
  }

  function payloadFromDraft() {
    const temperature = parseDraftNumber(Number(draft.temperature), 0.7);
    const maxTokens = Math.floor(parseDraftNumber(Number(draft.maxTokens), 800));
    const knowledgeTopK = Math.floor(
      parseDraftNumber(Number(draft.knowledgeTopK), 5),
    );
    const tags = draft.knowledgeTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      persona: draft.persona,
      provider: draft.provider,
      model: draft.model.trim(),
      temperature,
      maxTokens,
      knowledgeScope: {
        categories: draft.knowledgeCategories,
        tags,
        topK: knowledgeTopK,
      },
      tools: draft.tools,
      fallbackBehavior: draft.fallbackBehavior,
      fallbackTemplateId:
        draft.fallbackBehavior === "SEND_TEMPLATE"
          ? draft.fallbackTemplateId.trim() || undefined
          : undefined,
    };
  }

  function validateDraft(): string | null {
    const body = payloadFromDraft();
    if (!body.name) return "Agent name is required.";
    if (body.name.length > 120) return "Agent name must be 120 characters or less.";
    if (!body.persona.trim()) return "Persona is required.";
    if (body.persona.length > 8_000) return "Persona must be 8,000 characters or less.";
    if (!body.model) return "Choose a model preset or enter a model id.";
    if (body.temperature < 0 || body.temperature > 2) {
      return "Temperature must be between 0 and 2.";
    }
    if (body.maxTokens < 1 || body.maxTokens > 4096) {
      return "Max tokens must be between 1 and 4,096.";
    }
    if (body.knowledgeScope.topK < 1 || body.knowledgeScope.topK > 20) {
      return "Knowledge Top K must be between 1 and 20.";
    }
    if (body.fallbackBehavior === "SEND_TEMPLATE" && !body.fallbackTemplateId) {
      return "Fallback template id is required when fallback is SEND_TEMPLATE.";
    }
    return null;
  }

  function chooseProvider(provider: Provider) {
    setDraft((d) => ({
      ...d,
      provider,
      model:
        providerForModel(d.model) === provider || !d.model.trim()
          ? d.model || preferredModel(provider)
          : preferredModel(provider),
    }));
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const validation = validateDraft();
      if (validation) {
        setErr(validation);
        return;
      }
      const body = payloadFromDraft();
      if (selected) {
        const updated = await api.patch<Agent>(
          `/api/v1/ai-agents/${selected.id}`,
          body,
        );
        setNotice("Agent saved.");
        await refreshAgents(updated.id);
      } else {
        const created = await api.post<Agent>("/api/v1/ai-agents", body);
        setNotice("Agent created in DRAFT. Publish to make it usable.");
        await refreshAgents(created.id);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(
    action: "publish" | "disable" | "archive" | "set-default" | "clear-default",
  ) {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const updated = await api.post<Agent>(
        `/api/v1/ai-agents/${selected.id}/${action}`,
        {},
      );
      const niceLabel: Record<string, string> = {
        publish: "Published — agent is now ACTIVE.",
        disable: "Disabled — agent will no longer answer.",
        archive: "Archived.",
        "set-default": "Marked as tenant default.",
        "clear-default": "Cleared default flag.",
      };
      setNotice(niceLabel[action]);
      await refreshAgents(updated.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : `${action} failed.`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}" permanently?`)) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.delete(`/api/v1/ai-agents/${selected.id}`);
      setNotice("Agent deleted.");
      setSelectedId(null);
      await refreshAgents(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoReply(next: boolean) {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.patch("/api/v1/ai-agents/settings", {
        aiAgentAutoReply: next,
      });
      setAutoReply(next);
      setNotice(
        next
          ? "Auto-reply enabled. The default agent will answer un-routed inbound DMs."
          : "Auto-reply disabled. Inbound DMs without a flow trigger go unanswered.",
      );
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Settings update failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testDrive(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    if (!testInput.trim()) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    setTestResult(null);
    try {
      const result = await api.post<TestRunResult>(
        `/api/v1/ai-agents/${selected.id}/test`,
        {
          conversation: [{ role: "user", content: testInput.trim() }],
        },
      );
      setTestResult(result);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Test run failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleArrayValue<T extends string>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  const defaultAgent = agents.find((a) => a.isDefault && a.status === "ACTIVE");
  const inactiveDefault = agents.find((a) => a.isDefault && a.status !== "ACTIVE");

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Agents</h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure agents that answer inbound conversations. Grounded against
            your Knowledge Base; tool calls execute against your CRM.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              {agents.length} total
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              {activeAgents.length} active
            </span>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
              {defaultAgent ? `${defaultAgent.name} default` : "No default agent"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={newAgent}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
          disabled={busy}
        >
          + New agent
        </button>
      </header>

      {/* Auto-reply settings card */}
      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Inbound auto-reply
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              When ON: inbound WhatsApp DMs that don&apos;t match any flow are
              answered by the tenant&apos;s default agent ({" "}
              {defaultAgent ? (
                <span className="font-medium text-slate-800">
                  {defaultAgent.name}
                </span>
              ) : (
                <span className="italic text-slate-400">no default set</span>
              )}
              ).
            </p>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              checked={autoReply}
              disabled={busy}
              onChange={(e) => void toggleAutoReply(e.target.checked)}
            />
            <span>{autoReply ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        {autoReply && !defaultAgent && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Auto-reply is on but no default agent is set. Inbound DMs are
            silently ignored until you mark one of your ACTIVE agents as
            default below.
          </p>
        )}
        {inactiveDefault && (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {inactiveDefault.name} is marked default but is {inactiveDefault.status.toLowerCase()}.
            Publish it again or choose another active agent before enabling autopilot replies.
          </p>
        )}
      </section>

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
          <div className="border-b border-slate-100 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-sm placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
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
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {visibleAgents.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                No agents yet. Click &quot;New agent&quot; to create one.
              </li>
            )}
            {visibleAgents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm transition ${
                    selectedId === a.id
                      ? "bg-emerald-50"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{a.name}</span>
                    {a.isDefault && (
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                        default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <StatusPill status={a.status} />
                    <span className="font-mono">{a.model}</span>
                    {a.tools.length > 0 && (
                      <span>{a.tools.length} tool{a.tools.length === 1 ? "" : "s"}</span>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Name
                <input
                  required
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  placeholder="e.g. Sales Bot"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Description (operator note)
                <input
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="What this agent is for"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-slate-700">
              Persona (system prompt)
              <textarea
                required
                value={draft.persona}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, persona: e.target.value }))
                }
                rows={6}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
                placeholder="You are a friendly support agent for ..."
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Sent as the system message on every reply. Cap is 8,000 chars.
              </span>
            </label>

            {/* Model + tuning */}
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block text-xs font-medium text-slate-700">
                Provider
                <select
                  value={draft.provider}
                  onChange={(e) =>
                    chooseProvider(e.target.value as Provider)
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Model
                <input
                  list="ai-agent-model-presets"
                  value={draft.model}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, model: e.target.value }))
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
                />
                <datalist id="ai-agent-model-presets">
                  {MODEL_PRESETS[draft.provider].map((preset) => (
                    <option key={preset.model} value={preset.model}>
                      {preset.label}
                    </option>
                  ))}
                </datalist>
                <span className="mt-1 block text-[10px] text-slate-400">
                  {selectedPreset
                    ? selectedPreset.hint
                    : "Custom model id; verify the backend provider allows it."}
                </span>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Temperature
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={draft.temperature}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      temperature: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Max tokens
                <input
                  type="number"
                  step="100"
                  min="1"
                  max="4096"
                  value={draft.maxTokens}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maxTokens: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODEL_PRESETS[draft.provider].map((preset) => (
                <button
                  key={preset.model}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, model: preset.model }))
                  }
                  className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                    draft.model === preset.model
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className="block font-semibold">{preset.label}</span>
                  <span className="mt-0.5 block font-mono text-[10px]">
                    {preset.model}
                  </span>
                </button>
              ))}
            </div>

            {/* Knowledge scope */}
            <fieldset className="rounded-md border border-slate-200 px-3 pb-3 pt-2">
              <legend className="px-1 text-xs font-semibold text-slate-700">
                Knowledge scope
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-[1fr,1fr,140px]">
                <div className="text-xs">
                  <span className="font-medium text-slate-700">Categories</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {KB_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            knowledgeCategories: toggleArrayValue(
                              d.knowledgeCategories,
                              c,
                            ),
                          }))
                        }
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          draft.knowledgeCategories.includes(c)
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <span className="mt-2 block text-[10px] text-slate-400">
                    None selected = pull from all categories.
                  </span>
                </div>
                <label className="block text-xs font-medium text-slate-700">
                  Tags (comma-separated)
                  <input
                    value={draft.knowledgeTags}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        knowledgeTags: e.target.value,
                      }))
                    }
                    placeholder="vip, pricing"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">
                    Empty = no tag filter.
                  </span>
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  Top K
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={draft.knowledgeTopK}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        knowledgeTopK: Number(e.target.value),
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>
            </fieldset>

            {/* Tools */}
            <fieldset className="rounded-md border border-slate-200 px-3 pb-3 pt-2">
              <legend className="px-1 text-xs font-semibold text-slate-700">
                Allowed tools
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ALLOWED_TOOLS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        tools: toggleArrayValue(d.tools, t),
                      }))
                    }
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      draft.tools.includes(t)
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {draft.tools.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {draft.tools.map((tool) => (
                    <div
                      key={tool}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600"
                    >
                      <span className="font-semibold text-slate-800">{tool}</span>
                      <span className="mt-0.5 block">{TOOL_HELP[tool as (typeof ALLOWED_TOOLS)[number]]}</span>
                    </div>
                  ))}
                </div>
              )}
              <span className="mt-2 block text-[10px] text-slate-400">
                Tools the agent can propose. Allowlist; runtime refuses anything
                outside this set.
              </span>
            </fieldset>

            {/* Fallback */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Fallback behavior
                <select
                  value={draft.fallbackBehavior}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      fallbackBehavior: e.target.value as Fallback,
                    }))
                  }
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {FALLBACKS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-slate-400">
                  {FALLBACK_HELP[draft.fallbackBehavior]}
                </span>
              </label>
              {draft.fallbackBehavior === "SEND_TEMPLATE" && (
                <label className="block text-xs font-medium text-slate-700">
                  Fallback template id
                  <input
                    value={draft.fallbackTemplateId}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        fallbackTemplateId: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
                    placeholder="tmpl_..."
                    required
                  />
                </label>
              )}
            </div>

            {/* Save + lifecycle row */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {selected ? "Save changes" : "Create draft"}
              </button>
              {selected && (
                <>
                  {selected.status !== "ACTIVE" && selected.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("publish")}
                      disabled={busy}
                      className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Publish
                    </button>
                  )}
                  {selected.status === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("disable")}
                      disabled={busy}
                      className="rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Disable
                    </button>
                  )}
                  {selected.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("archive")}
                      disabled={busy}
                      className="rounded-md border border-slate-400 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                  {selected.status === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() =>
                        void lifecycle(
                          selected.isDefault ? "clear-default" : "set-default",
                        )
                      }
                      disabled={busy}
                      className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                        selected.isDefault
                          ? "border-slate-400 text-slate-600 hover:bg-slate-100"
                          : "border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {selected.isDefault ? "Clear default" : "Set as default"}
                    </button>
                  )}
                  <span className="ml-auto" />
                  <button
                    type="button"
                    onClick={() => void removeSelected()}
                    disabled={busy}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </form>

          {/* Test-drive */}
          {selected && (
            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Test the agent
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Send a sample customer message and see how this agent would
                respond. Wallet is debited per real run (so tuning iterations
                show up in your AI usage report).
              </p>
              <form onSubmit={testDrive} className="mt-3 flex gap-2">
                <input
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder='e.g. "what are your hours?"'
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || selected.status !== "ACTIVE"}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  title={
                    selected.status !== "ACTIVE"
                      ? "Publish the agent first"
                      : ""
                  }
                >
                  Run
                </button>
              </form>
              {testResult && (
                <div className="mt-3 space-y-2 rounded-md bg-white p-3 text-xs ring-1 ring-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">Reason:</span>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5">
                      {testResult.reason}
                    </code>
                    {testResult.modelUsed && (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5">
                        {testResult.providerUsed} / {testResult.modelUsed}
                      </code>
                    )}
                  </div>
                  {testResult.reply && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Reply
                      </div>
                      <div className="mt-1 whitespace-pre-wrap rounded bg-emerald-50 px-2 py-1.5 text-slate-800">
                        {testResult.reply}
                      </div>
                    </div>
                  )}
                  {testResult.toolCalls.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Tool calls
                      </div>
                      <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                        {JSON.stringify(testResult.toolCalls, null, 2)}
                      </pre>
                    </div>
                  )}
                  {testResult.citations.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        KB citations
                      </div>
                      <ul className="mt-1 space-y-1">
                        {testResult.citations.map((c, i) => (
                          <li
                            key={c.entryId}
                            className="rounded bg-slate-50 px-2 py-1"
                          >
                            <span className="text-[9px] font-semibold text-emerald-700">
                              [KB-{i + 1}]
                            </span>{" "}
                            <span className="font-medium">{c.title}</span>{" "}
                            <span className="text-[10px] text-slate-500">
                              ({c.category}, score {c.score.toFixed(2)})
                            </span>
                            <div className="mt-0.5 text-[10px] text-slate-600">
                              {c.snippet}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  const styles: Record<AgentStatus, string> = {
    DRAFT: "bg-slate-200 text-slate-700",
    ACTIVE: "bg-emerald-100 text-emerald-700",
    DISABLED: "bg-amber-100 text-amber-700",
    ARCHIVED: "bg-slate-100 text-slate-500",
  };
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}
