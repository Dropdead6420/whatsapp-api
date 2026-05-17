"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret: string;
  createdAt: string;
}

interface WebhookLog {
  id: string;
  webhookId: string;
  event: string;
  payload: string;
  statusCode: number | null;
  response: string | null;
  error: string | null;
  attempt: number;
  nextRetryAt: string | null;
  createdAt: string;
}

const ALL_EVENTS = [
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "LEAD_CREATED",
  "CONTACT_TAGGED",
  "CAMPAIGN_COMPLETED",
  "CONVERSATION_ASSIGNED",
  "APPOINTMENT_BOOKED",
];

export default function WebhooksPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [items, setItems] = useState<Webhook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("https://");
  const [chosen, setChosen] = useState<string[]>([
    "MESSAGE_RECEIVED",
    "APPOINTMENT_BOOKED",
  ]);
  const [busy, setBusy] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState<{
    id: string;
    secret: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);

  async function refresh() {
    try {
      const data = await api.get<Webhook[]>("/api/v1/webhooks");
      setItems(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  useEffect(() => {
    if (!selectedId) {
      setLogs([]);
      return;
    }
    api
      .get<WebhookLog[]>(`/api/v1/webhooks/${selectedId}/logs`)
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [selectedId]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (chosen.length === 0) {
      setErr("Pick at least one event.");
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<Webhook>("/api/v1/webhooks", {
        url,
        events: chosen,
        isActive: true,
      });
      setShowForm(false);
      setUrl("https://");
      setChosen(["MESSAGE_RECEIVED", "APPOINTMENT_BOOKED"]);
      setSecretRevealed({ id: created.id, secret: created.secret });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(w: Webhook) {
    try {
      await api.patch(`/api/v1/webhooks/${w.id}`, { isActive: !w.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Toggle failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook subscription?")) return;
    try {
      await api.delete(`/api/v1/webhooks/${id}`);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed");
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="text-sm text-slate-500">
            Subscribe an external URL to platform events. Payloads are signed
            with HMAC-SHA256 in the <code>X-NexaFlow-Signature</code> header.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? "Cancel" : "+ New webhook"}
        </button>
      </header>

      {secretRevealed && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-medium">✓ Webhook created. Copy the signing secret — it won't be shown again:</div>
          <code className="mt-2 block break-all rounded bg-white p-2 font-mono text-xs">
            {secretRevealed.secret}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(secretRevealed.secret)}
            className="mt-2 rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs hover:bg-emerald-100"
          >
            Copy secret
          </button>
          <button
            onClick={() => setSecretRevealed(null)}
            className="ml-2 text-xs text-emerald-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Endpoint URL
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.example.com/nexaflow-webhook"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Events to subscribe to
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_EVENTS.map((ev) => {
                const on = chosen.includes(ev);
                return (
                  <button
                    type="button"
                    key={ev}
                    onClick={() =>
                      setChosen((cs) =>
                        on ? cs.filter((c) => c !== ev) : [...cs, ev],
                      )
                    }
                    className={`rounded-full px-3 py-1 text-xs ${
                      on
                        ? "bg-emerald-600 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create webhook"}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Events</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((w) => (
                  <tr
                    key={w.id}
                    onClick={() => setSelectedId(selectedId === w.id ? null : w.id)}
                    className={`cursor-pointer ${
                      selectedId === w.id ? "bg-emerald-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-[11px] break-all">
                      {w.url}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {w.events.map((e) => (
                          <span
                            key={e}
                            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggle(w);
                        }}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          w.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {w.isActive ? "Active" : "Paused"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          remove(w.id);
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No webhooks yet. Add one to receive event notifications.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-500">
              Delivery logs
            </h2>
            {!selectedId ? (
              <p className="text-xs text-slate-500">Select a webhook to view its failed-delivery log.</p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-slate-500">No failed deliveries.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {logs.map((l) => (
                  <details
                    key={l.id}
                    className="rounded-md border border-slate-100 bg-slate-50 p-2"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="truncate">
                        <b className="font-mono">{l.event}</b>{" "}
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                            l.statusCode && l.statusCode >= 200 && l.statusCode < 300
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {l.statusCode ?? "ERR"}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        try {l.attempt}
                      </span>
                    </summary>
                    <div className="mt-1 space-y-1">
                      {l.error && (
                        <div className="font-mono text-[10px] text-red-700">
                          {l.error}
                        </div>
                      )}
                      {l.response && (
                        <pre className="overflow-auto rounded bg-white p-1 font-mono text-[10px]">
                          {l.response.slice(0, 300)}
                        </pre>
                      )}
                      {l.nextRetryAt && (
                        <div className="text-[10px] text-slate-500">
                          retry: {new Date(l.nextRetryAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
