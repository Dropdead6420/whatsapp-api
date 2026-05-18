"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useAutoSave } from "../../src/hooks/useAutoSave";
import { useInbox } from "../../src/hooks/useInbox";

interface Convo {
  id: string;
  isActive: boolean;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  slaBreachedAt: string | null;
  firstResponseSeconds: number | null;
  labels: string[];
  contact: { id: string; name: string; phoneNumber: string };
  agent: { id: string; name: string } | null;
  messages: Array<{
    id: string;
    content: string;
    direction: "INBOUND" | "OUTBOUND";
    createdAt: string;
  }>;
}

interface Sentiment {
  label: "positive" | "neutral" | "negative";
  score: number;
  summary: string;
}

interface ReplySuggestion {
  id: string;
  tone: "professional" | "friendly" | "apologetic" | "concise";
  text: string;
}

interface CannedReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

interface Note {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export default function InboxPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["AGENT", "TEAM_LEAD", "BUSINESS_ADMIN"],
  });
  const [err, setErr] = useState<string | null>(null);
  const userScope = `${user?.tenantId ?? "anon"}:${user?.id ?? "anon"}`;
  const [drafts, setDrafts, draftStatus] = useAutoSave<Record<string, string>>(
    `inbox-drafts:${userScope}`,
    {},
    {
      isEmpty: (v) =>
        !v || Object.values(v as Record<string, string>).every((s) => !s?.trim()),
    },
  );
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [sentiments, setSentiments] = useState<Record<string, Sentiment>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, ReplySuggestion[]>>({});
  const [suggesting, setSuggesting] = useState<Record<string, boolean>>({});
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([]);
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [filterSlaBreached, setFilterSlaBreached] = useState(false);
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useAutoSave<Record<string, string>>(
    `inbox-note-drafts:${userScope}`,
    {},
    {
      isEmpty: (v) =>
        !v || Object.values(v as Record<string, string>).every((s) => !s?.trim()),
    },
  );

  // useInbox owns the fetch + realtime subscription + polling fallback.
  // It re-fetches automatically on message:received / message:sent /
  // conversation:updated WS events; falls back to 15s polling when the
  // socket is offline.
  const inboxEndpoint = useMemo(() => {
    const params = new URLSearchParams({ limit: "50" });
    if (user?.role === "AGENT") params.set("assignedToMe", "true");
    if (filterLabel) params.set("label", filterLabel);
    if (filterSlaBreached) params.set("slaBreached", "true");
    return `/api/v1/conversations?${params.toString()}`;
  }, [user?.role, filterLabel, filterSlaBreached]);

  const {
    data: convos,
    error: inboxError,
    refresh,
    realtimeConnected,
  } = useInbox<Convo>({ endpoint: inboxEndpoint, enabled: Boolean(user) });

  useEffect(() => {
    if (inboxError) setErr(inboxError);
  }, [inboxError]);

  useEffect(() => {
    if (user) {
      api
        .get<CannedReply[]>("/api/v1/canned-replies")
        .then(setCannedReplies)
        .catch(() => setCannedReplies([]));
    }
  }, [user]);

  function applyCanned(conversationId: string, draft: string): string {
    // Expand "/shortcut" at start of draft into the canned reply body.
    const match = draft.match(/^(\/[a-z0-9_-]+)\s*$/);
    if (!match) return draft;
    const found = cannedReplies.find((c) => c.shortcut === match[1]);
    return found ? found.body : draft;
  }

  async function loadNotes(conversationId: string) {
    try {
      const list = await api.get<Note[]>(
        `/api/v1/conversations/${conversationId}/notes`,
      );
      setNotes((n) => ({ ...n, [conversationId]: list }));
    } catch {
      setNotes((n) => ({ ...n, [conversationId]: [] }));
    }
  }

  async function addNote(conversationId: string) {
    const body = noteDraft[conversationId]?.trim();
    if (!body) return;
    try {
      await api.post(`/api/v1/conversations/${conversationId}/notes`, { body });
      setNoteDraft((n) => ({ ...n, [conversationId]: "" }));
      await loadNotes(conversationId);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Add note failed");
    }
  }

  async function deleteNote(conversationId: string, noteId: string) {
    try {
      await api.delete(`/api/v1/conversations/${conversationId}/notes/${noteId}`);
      await loadNotes(conversationId);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete note failed");
    }
  }

  async function addLabel(conversationId: string) {
    const raw = labelDraft[conversationId]?.trim().toLowerCase();
    if (!raw) return;
    const clean = raw.replace(/[^a-z0-9_-]+/g, "-");
    try {
      await api.post(`/api/v1/conversations/${conversationId}/labels`, {
        label: clean,
      });
      setLabelDraft((d) => ({ ...d, [conversationId]: "" }));
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Add label failed");
    }
  }

  async function removeLabel(conversationId: string, label: string) {
    try {
      await api.delete(
        `/api/v1/conversations/${conversationId}/labels/${encodeURIComponent(label)}`,
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Remove label failed");
    }
  }

  async function sendReply(conversationId: string) {
    const rawDraft = drafts[conversationId]?.trim();
    if (!rawDraft) return;
    const body = applyCanned(conversationId, rawDraft);
    setSending((c) => ({ ...c, [conversationId]: true }));
    setErr(null);
    try {
      await api.post(`/api/v1/conversations/${conversationId}/reply`, { body });
      setDrafts((c) => ({ ...c, [conversationId]: "" }));
      setSuggestions((c) => ({ ...c, [conversationId]: [] }));
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to send reply");
    } finally {
      setSending((c) => ({ ...c, [conversationId]: false }));
    }
  }

  async function analyzeSentiment(conversationId: string) {
    setAnalyzing((c) => ({ ...c, [conversationId]: true }));
    setErr(null);
    try {
      const s = await api.post<Sentiment>("/api/v1/ai/sentiment", {
        conversationId,
      });
      setSentiments((c) => ({ ...c, [conversationId]: s }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Sentiment failed");
    } finally {
      setAnalyzing((c) => ({ ...c, [conversationId]: false }));
    }
  }

  async function suggestReplies(conversationId: string) {
    setSuggesting((c) => ({ ...c, [conversationId]: true }));
    setErr(null);
    try {
      const data = await api.post<{ suggestions: ReplySuggestion[] }>(
        "/api/v1/ai/reply-suggestions",
        { conversationId },
      );
      setSuggestions((c) => ({ ...c, [conversationId]: data.suggestions }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Suggestion failed");
    } finally {
      setSuggesting((c) => ({ ...c, [conversationId]: false }));
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-slate-500">
            {user.role === "AGENT"
              ? "Conversations assigned to you. Tap ✦ Suggest to draft a reply with AI."
              : "All active conversations in your tenant. AI sentiment and reply assistance available."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              realtimeConnected
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
            title={
              realtimeConnected
                ? "Realtime connected — new messages appear instantly."
                : "Realtime offline — falling back to 15s polling."
            }
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                realtimeConnected ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
            {realtimeConnected ? "Live" : "Polling"}
          </span>
          <SaveStatus status={draftStatus} />
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => setFilterSlaBreached((v) => !v)}
          className={`rounded-full px-3 py-1 ${
            filterSlaBreached
              ? "bg-red-600 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          ⚠ SLA breached
        </button>
        {["urgent", "follow-up", "closed", "new-lead"].map((label) => (
          <button
            key={label}
            onClick={() => setFilterLabel(filterLabel === label ? null : label)}
            className={`rounded-full px-3 py-1 ${
              filterLabel === label
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
        {(filterLabel || filterSlaBreached) && (
          <button
            onClick={() => {
              setFilterLabel(null);
              setFilterSlaBreached(false);
            }}
            className="text-slate-500 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-slate-500">{convos.length} shown</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {convos.map((c) => {
          const last = c.messages[0];
          const sentiment = sentiments[c.id];
          const sugg = suggestions[c.id] ?? [];
          return (
            <div
              key={c.id}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.contact.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {c.contact.phoneNumber}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.slaBreachedAt && <SlaChip breachedAt={c.slaBreachedAt} />}
                  {sentiment && <SentimentChip s={sentiment} />}
                  {c.agent ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                      {c.agent.name}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      Unassigned
                    </span>
                  )}
                </div>
              </div>

              {(c.labels.length > 0 || c.firstResponseSeconds !== null) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {c.labels.map((l) => (
                    <span
                      key={l}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white"
                    >
                      {l}
                      <button
                        onClick={() => removeLabel(c.id, l)}
                        className="hover:text-red-300"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <details className="inline-block">
                    <summary className="cursor-pointer rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">
                      + label
                    </summary>
                    <form
                      className="mt-1 inline-flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addLabel(c.id);
                      }}
                    >
                      <input
                        value={labelDraft[c.id] ?? ""}
                        onChange={(e) =>
                          setLabelDraft((d) => ({ ...d, [c.id]: e.target.value }))
                        }
                        placeholder="urgent"
                        list={`label-suggest-${c.id}`}
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px]"
                      />
                      <datalist id={`label-suggest-${c.id}`}>
                        {["urgent", "follow-up", "closed", "new-lead", "vip"].map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                      <button
                        type="submit"
                        className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] text-white"
                      >
                        Add
                      </button>
                    </form>
                  </details>
                  {c.firstResponseSeconds !== null && (
                    <span
                      className="ml-auto text-[10px] text-slate-500"
                      title="First response time"
                    >
                      ⏱ {formatDuration(c.firstResponseSeconds)}
                    </span>
                  )}
                </div>
              )}

              {last && (
                <p className="mt-3 line-clamp-2 text-xs text-slate-600">
                  <span className="font-medium uppercase tracking-wide text-slate-400">
                    {last.direction === "INBOUND" ? "Them: " : "You: "}
                  </span>
                  {last.content}
                </p>
              )}

              {sentiment && (
                <p className="mt-2 text-[11px] italic text-slate-500">
                  {sentiment.summary}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
                <button
                  onClick={() => analyzeSentiment(c.id)}
                  disabled={analyzing[c.id]}
                  className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {analyzing[c.id] ? "…" : "✦ Sentiment"}
                </button>
                <button
                  onClick={() => suggestReplies(c.id)}
                  disabled={suggesting[c.id]}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {suggesting[c.id] ? "…" : "✦ Suggest reply"}
                </button>
                <button
                  onClick={() => {
                    const next = openNotes === c.id ? null : c.id;
                    setOpenNotes(next);
                    if (next && !notes[c.id]) loadNotes(c.id);
                  }}
                  className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                >
                  📝 Notes{notes[c.id] && notes[c.id].length > 0 ? ` (${notes[c.id].length})` : ""}
                </button>
                <span className="ml-auto text-slate-400">
                  {c.lastMessageAt && new Date(c.lastMessageAt).toLocaleString()}
                </span>
              </div>

              {openNotes === c.id && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Internal notes (not visible to customer)
                  </div>
                  <div className="space-y-2">
                    {(notes[c.id] ?? []).map((n) => (
                      <div
                        key={n.id}
                        className="rounded-md border border-slate-200 bg-white p-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>
                            <b>{n.authorName}</b> · {new Date(n.createdAt).toLocaleString()}
                          </span>
                          <button
                            onClick={() => deleteNote(c.id, n.id)}
                            className="text-red-600 hover:underline"
                          >
                            delete
                          </button>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">{n.body}</div>
                      </div>
                    ))}
                    {(notes[c.id] ?? []).length === 0 && (
                      <p className="text-[11px] italic text-slate-500">No notes yet.</p>
                    )}
                  </div>
                  <form
                    className="mt-2 flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addNote(c.id);
                    }}
                  >
                    <input
                      value={noteDraft[c.id] ?? ""}
                      onChange={(e) =>
                        setNoteDraft((d) => ({ ...d, [c.id]: e.target.value }))
                      }
                      placeholder="Add a note for your team…"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={!(noteDraft[c.id] ?? "").trim()}
                      className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </form>
                </div>
              )}

              {sugg.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {sugg.map((s) => (
                    <button
                      key={s.id}
                      onClick={() =>
                        setDrafts((d) => ({ ...d, [c.id]: s.text }))
                      }
                      className="block w-full rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-left text-xs hover:bg-emerald-100"
                    >
                      <span className="mr-1 inline-block rounded-full bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700">
                        {s.tone}
                      </span>
                      {s.text}
                    </button>
                  ))}
                </div>
              )}

              <form
                className="mt-4 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendReply(c.id);
                }}
              >
                <input
                  value={drafts[c.id] ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [c.id]: event.target.value,
                    }))
                  }
                  list={`canned-${c.id}`}
                  placeholder={
                    cannedReplies.length > 0
                      ? `Reply or type /shortcut (${cannedReplies.length} saved)`
                      : "Reply on WhatsApp"
                  }
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <datalist id={`canned-${c.id}`}>
                  {cannedReplies.map((r) => (
                    <option key={r.id} value={r.shortcut}>
                      {r.title}
                    </option>
                  ))}
                </datalist>
                <button
                  type="submit"
                  disabled={sending[c.id] || !(drafts[c.id] ?? "").trim()}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          );
        })}
        {convos.length === 0 && !err && (
          <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
            No conversations yet. Inbound WhatsApp messages will appear here.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <span
      className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        status === "saving"
          ? "bg-slate-100 text-slate-600"
          : "bg-emerald-50 text-emerald-700"
      }`}
      title="Reply drafts auto-saved locally"
    >
      <span
        className={
          status === "saving"
            ? "h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
            : "h-1.5 w-1.5 rounded-full bg-emerald-500"
        }
      />
      {status === "saving" ? "Saving draft…" : "Drafts saved"}
    </span>
  );
}

function SlaChip({ breachedAt }: { breachedAt: string }) {
  const elapsed = Math.max(
    0,
    Math.round((Date.now() - new Date(breachedAt).getTime()) / 60000),
  );
  return (
    <span
      className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white"
      title={`SLA breached ${elapsed} min ago`}
    >
      ⚠ SLA +{elapsed}m
    </span>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function SentimentChip({ s }: { s: Sentiment }) {
  const style =
    s.label === "positive"
      ? "bg-emerald-50 text-emerald-700"
      : s.label === "negative"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-600";
  const icon = s.label === "positive" ? "↑" : s.label === "negative" ? "↓" : "·";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${style}`}
      title={`Score ${s.score.toFixed(2)}`}
    >
      {icon} {s.label}
    </span>
  );
}
