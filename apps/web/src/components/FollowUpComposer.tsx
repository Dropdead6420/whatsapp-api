"use client";

// Shared composer modal for creating follow-up tasks (PRD §7).
// Used by both /follow-ups (no preloaded context) and /inbox (preloads
// contactId + conversationId from the card the operator clicked).
//
// AGENT callers never see the assignee picker — the server pins them
// to self regardless, so showing the field would be misleading.

import { useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "../lib/api";

export interface FollowUpComposerProps {
  /** Closes the modal — caller controls visibility. */
  onClose: () => void;
  /** Fires after a successful POST. */
  onCreated?: () => void;
  /** Current user's role (controls assignee picker visibility). */
  userRole: string;
  /** Current user's display name (shown as default-assignee label). */
  userName: string;
  /** Preloaded contact link (e.g. when opened from an inbox card). */
  contactId?: string | null;
  /** Preloaded conversation link. */
  conversationId?: string | null;
  /** Visible badge for context — e.g. customer name. Optional. */
  contextLabel?: string;
  /** Optional list of agents for the picker (passed by /follow-ups). */
  agents?: Array<{ agentId: string; agentName: string; agentEmail: string }>;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDueAtLocal(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return toLocalInputValue(tomorrow);
}

export function FollowUpComposer(props: FollowUpComposerProps) {
  const {
    onClose,
    onCreated,
    userRole,
    userName,
    contactId,
    conversationId,
    contextLabel,
    agents: agentsProp,
  } = props;

  const canSeeOtherAgents = userRole !== "AGENT";

  const [draft, setDraft] = useState({
    title: "",
    dueAtLocal: defaultDueAtLocal(),
    assigneeId: "",
    notes: "",
  });
  const [agents, setAgents] = useState<
    Array<{ agentId: string; agentName: string; agentEmail: string }>
  >(agentsProp ?? []);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When opened from inbox we don't get the agent list from a parent
  // — fetch the manager-dashboard summary on mount (BUSINESS_ADMIN /
  // TEAM_LEAD only; AGENTs skip this).
  useEffect(() => {
    if (!canSeeOtherAgents || agentsProp) return;
    let cancelled = false;
    api
      .get<{ rows: Array<{ agentId: string; agentName: string; agentEmail: string }> }>(
        "/api/v1/agent-performance?sinceDays=30",
      )
      .then((s) => {
        if (!cancelled) setAgents(s.rows ?? []);
      })
      .catch(() => {
        // Picker just hides — agent will go to self.
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeOtherAgents, agentsProp]);

  const create = async () => {
    if (!draft.title.trim()) {
      setErr("Title is required.");
      return;
    }
    const dueAt = new Date(draft.dueAtLocal);
    if (Number.isNaN(dueAt.getTime())) {
      setErr("Pick a valid due date / time.");
      return;
    }
    setCreating(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        dueAt: dueAt.toISOString(),
      };
      if (draft.notes.trim()) body.notes = draft.notes.trim();
      if (canSeeOtherAgents && draft.assigneeId) {
        body.assigneeId = draft.assigneeId;
      }
      if (contactId) body.contactId = contactId;
      if (conversationId) body.conversationId = conversationId;
      await api.post("/api/v1/follow-up-tasks", body);
      onCreated?.();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const titlePrefix = useMemo(() => {
    if (!contextLabel) return null;
    return (
      <p className="mt-1 text-xs text-slate-500">
        Linked to <b>{contextLabel}</b>
      </p>
    );
  }, [contextLabel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !creating && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-950">
            New follow-up
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {canSeeOtherAgents
              ? "Assign to yourself or any active agent."
              : "This task will be added to your queue."}
          </p>
          {titlePrefix}
        </header>
        <div className="space-y-3 px-5 py-4">
          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {err}
            </div>
          )}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Title
            </label>
            <input
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              placeholder="Call back to confirm pricing"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              maxLength={280}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Due
            </label>
            <input
              type="datetime-local"
              value={draft.dueAtLocal}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dueAtLocal: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {canSeeOtherAgents && agents.length > 0 && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Assignee
              </label>
              <select
                value={draft.assigneeId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assigneeId: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Me ({userName}) —</option>
                {agents.map((a) => (
                  <option key={a.agentId} value={a.agentId}>
                    {a.agentName} · {a.agentEmail}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Notes (optional)
            </label>
            <textarea
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              placeholder="Context the next person on this needs."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              maxLength={4000}
            />
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={creating}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {creating ? "Saving…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
