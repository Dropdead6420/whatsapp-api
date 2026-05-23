"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Category =
  | "FAQ"
  | "SERVICE"
  | "PRODUCT"
  | "POLICY"
  | "HOURS"
  | "LOCATION"
  | "OTHER";

type Status = "DRAFT" | "PUBLISHED" | "ARCHIVED";

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  category: Category;
  tags: string[];
  source: string | null;
  sourceUrl: string | null;
  status: Status;
  publishedAt: string | null;
  archivedAt: string | null;
  embeddingModel: string | null;
  embeddingVectorLength: number;
  lastEmbeddedAt: string | null;
  embeddingError: string | null;
  needsEmbedding: boolean;
  updatedAt: string;
}

interface EntryListResponse {
  entries: KnowledgeEntry[];
  pagination: { page: number; limit: number; total: number };
}

interface RetrievalResult {
  query: string;
  embeddingModel: string;
  results: Array<{
    id: string;
    title: string;
    summary: string | null;
    category: Category;
    tags: string[];
    score: number;
    scoreSource: string;
    snippet: string;
  }>;
}

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "FAQ", label: "FAQ" },
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "POLICY", label: "Policy" },
  { value: "HOURS", label: "Hours" },
  { value: "LOCATION", label: "Location" },
  { value: "OTHER", label: "Other" },
];

const STATUS_FILTERS = ["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"] as const;

function emptyDraft() {
  return {
    title: "",
    summary: "",
    content: "",
    category: "FAQ" as Category,
    tags: "",
    source: "",
    sourceUrl: "",
    publish: false,
  };
}

export default function KnowledgeBasePage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrieveQuery, setRetrieveQuery] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalResult | null>(null);

  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  async function refresh(nextSelectedId = selectedId) {
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const data = await api.get<EntryListResponse>(
        `/api/v1/knowledge-base?${params.toString()}`,
      );
      setEntries(data.entries);
      if (nextSelectedId && data.entries.some((entry) => entry.id === nextSelectedId)) {
        setSelectedId(nextSelectedId);
      } else {
        setSelectedId(data.entries[0]?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Knowledge base load failed.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user, status]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      title: selected.title,
      summary: selected.summary ?? "",
      content: selected.content,
      category: selected.category,
      tags: selected.tags.join(", "),
      source: selected.source ?? "",
      sourceUrl: selected.sourceUrl ?? "",
      publish: selected.status === "PUBLISHED",
    });
  }, [selected]);

  function newEntry() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setNotice(null);
    setErr(null);
  }

  function payloadFromDraft(includePublish: boolean) {
    return {
      title: draft.title,
      summary: draft.summary || undefined,
      content: draft.content,
      category: draft.category,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      source: draft.source || undefined,
      sourceUrl: draft.sourceUrl || undefined,
      ...(includePublish ? { publish: draft.publish } : {}),
    };
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      if (selected) {
        const updated = await api.patch<KnowledgeEntry>(
          `/api/v1/knowledge-base/${selected.id}`,
          payloadFromDraft(false),
        );
        setNotice("Knowledge entry updated.");
        await refresh(updated.id);
      } else {
        const created = await api.post<KnowledgeEntry>(
          "/api/v1/knowledge-base",
          payloadFromDraft(true),
        );
        setNotice(created.status === "PUBLISHED" ? "Entry created and published." : "Draft created.");
        await refresh(created.id);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "publish" | "archive" | "restore") {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const updated = await api.post<KnowledgeEntry>(
        `/api/v1/knowledge-base/${selected.id}/${action}`,
        {},
      );
      setNotice(`Entry moved to ${updated.status.toLowerCase()}.`);
      await refresh(updated.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : `${action} failed.`);
    } finally {
      setBusy(false);
    }
  }

  async function embedSelected() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<{
        embedded: boolean;
        embeddingModel: string | null;
        embeddingVectorLength: number;
      }>(`/api/v1/knowledge-base/${selected.id}/embed`, {});
      setNotice(
        `Embedded with ${result.embeddingModel ?? "local model"} (${result.embeddingVectorLength} dimensions).`,
      );
      await refresh(selected.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Embedding failed.");
    } finally {
      setBusy(false);
    }
  }

  async function embedStale() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<{
        checked: number;
        embedded: number;
        failed: number;
      }>("/api/v1/knowledge-base/embed-stale", { limit: 25 });
      setNotice(
        `Checked ${result.checked} entries. Embedded ${result.embedded}; failed ${result.failed}.`,
      );
      await refresh(selectedId);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Embedding batch failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runRetrieval(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const result = await api.post<RetrievalResult>("/api/v1/knowledge-base/retrieve", {
        query: retrieveQuery,
        limit: 5,
      });
      setRetrieval(result);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Retrieval test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!window.confirm("Delete this knowledge entry permanently?")) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.delete(`/api/v1/knowledge-base/${selected.id}`);
      setNotice("Entry deleted.");
      setSelectedId(null);
      await refresh(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed.");
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
          <h1 className="text-2xl font-semibold tracking-tight">AI Knowledge Base</h1>
          <p className="mt-1 text-sm text-slate-500">
            Publish tenant-approved facts that AI replies can safely use.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={embedStale}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            Embed stale
          </button>
          <button
            onClick={newEntry}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            New entry
          </button>
        </div>
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            err
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Search
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="hours, pricing, refund..."
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                Go
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUS_FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    status === item
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item === "ALL" ? "All" : item.toLowerCase()}
                </button>
              ))}
            </div>
          </form>

          <div className="space-y-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`w-full rounded-lg border p-4 text-left text-sm ${
                  selectedId === entry.id
                    ? "border-slate-900 bg-white shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">
                      {entry.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {entry.category.toLowerCase()} / {entry.status.toLowerCase()}
                    </div>
                  </div>
                  {entry.needsEmbedding && entry.status === "PUBLISHED" && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      stale
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                  {entry.summary || entry.content}
                </p>
                {entry.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {entry.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
            {entries.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
                No knowledge entries yet.
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-5">
          <form
            onSubmit={save}
            className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2"
          >
            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected ? "Edit knowledge entry" : "Create knowledge entry"}
                </h2>
                {selected && (
                  <p className="mt-1 text-xs text-slate-500">
                    Updated {new Date(selected.updatedAt).toLocaleString()}
                  </p>
                )}
              </div>
              {selected && (
                <div className="flex flex-wrap gap-2">
                  {selected.status !== "PUBLISHED" && selected.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("publish")}
                      disabled={busy}
                      className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      Publish
                    </button>
                  )}
                  {selected.status === "PUBLISHED" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("archive")}
                      disabled={busy}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                    >
                      Archive
                    </button>
                  )}
                  {selected.status === "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => void lifecycle("restore")}
                      disabled={busy}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                    >
                      Restore draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={embedSelected}
                    disabled={busy || selected.status !== "PUBLISHED"}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  >
                    Embed
                  </button>
                  <button
                    type="button"
                    onClick={removeSelected}
                    disabled={busy}
                    className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <label className="md:col-span-2 block text-sm font-medium text-slate-700">
              Title
              <input
                required
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Category
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value as Category }))
                }
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Tags
              <input
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="pricing, salon, vip"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="md:col-span-2 block text-sm font-medium text-slate-700">
              Summary
              <textarea
                rows={2}
                value={draft.summary}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, summary: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="md:col-span-2 block text-sm font-medium text-slate-700">
              Full answer / policy
              <textarea
                required
                rows={8}
                value={draft.content}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, content: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Source
              <input
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
                placeholder="manager, website, menu"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Source URL
              <input
                value={draft.sourceUrl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sourceUrl: e.target.value }))
                }
                placeholder="https://..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {!selected && (
              <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.publish}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, publish: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Publish immediately
              </label>
            )}

            <div className="md:col-span-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="text-xs text-slate-500">
                {selected?.lastEmbeddedAt
                  ? `Embedded ${new Date(selected.lastEmbeddedAt).toLocaleString()} with ${selected.embeddingModel ?? "local model"}`
                  : selected?.status === "PUBLISHED"
                    ? "Published entries can be embedded for retrieval."
                    : "Drafts are not retrieved by AI."}
                {selected?.embeddingError && (
                  <span className="block text-red-600">{selected.embeddingError}</span>
                )}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? "Saving..." : selected ? "Save changes" : "Create entry"}
              </button>
            </div>
          </form>

          <form
            onSubmit={runRetrieval}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[260px] flex-1 text-sm font-medium text-slate-700">
                Test AI retrieval
                <input
                  required
                  value={retrieveQuery}
                  onChange={(e) => setRetrieveQuery(e.target.value)}
                  placeholder="What are your opening hours?"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                Search facts
              </button>
            </div>

            {retrieval && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-slate-500">
                  Model: {retrieval.embeddingModel}. Results: {retrieval.results.length}.
                </div>
                {retrieval.results.map((result) => (
                  <div
                    key={result.id}
                    className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{result.title}</span>
                      <span className="text-xs text-slate-500">
                        {result.scoreSource} score {result.score}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-600">
                      {result.summary || result.snippet}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
