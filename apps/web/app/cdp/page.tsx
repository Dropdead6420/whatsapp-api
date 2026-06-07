"use client";

// CDP customer-360 timeline (Complete Planning PDF §2.12). Loads a contact's
// unified activity feed (conversations, calls, appointments, leads). Accepts
// ?contactId= for deep-linking from a contact view. English-first.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface TimelineEvent {
  type: string;
  at: string;
  title: string;
  detail?: string;
  sourceId: string;
}

const TYPE_STYLE: Record<string, string> = {
  conversation: "bg-emerald-50 text-emerald-700",
  call: "bg-blue-50 text-blue-700",
  appointment: "bg-purple-50 text-purple-700",
  lead: "bg-amber-50 text-amber-700",
};

export default function CdpTimelinePage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [contactId, setContactId] = useState("");
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(id: string) {
    const target = id.trim();
    if (!target) return;
    setBusy(true);
    setErr(null);
    setEvents(null);
    try {
      const data = await api.get<{ contactId: string; events: TimelineEvent[] }>(
        `/api/v1/cdp/contacts/${encodeURIComponent(target)}/timeline`,
      );
      setEvents(data.events);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load timeline.");
    } finally {
      setBusy(false);
    }
  }

  // Deep-link support: ?contactId=...
  useEffect(() => {
    if (!user) return;
    const fromUrl = new URLSearchParams(window.location.search).get("contactId");
    if (fromUrl) {
      setContactId(fromUrl);
      void load(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void load(contactId);
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">CRM</p>
        <h1 className="text-2xl font-semibold text-slate-950">Customer timeline</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          A unified, chronological view of a contact&apos;s activity — conversations,
          calls, appointments and leads.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mb-5 flex flex-wrap items-end gap-2">
        <label className="text-sm font-medium text-slate-700">
          Contact id
          <input
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
            placeholder="contact cuid"
            className="mt-1 block w-80 rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Loading..." : "Load timeline"}
        </button>
      </form>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      {events && (
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          {events.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">No activity for this contact yet.</div>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {events.map((ev) => (
                <li key={`${ev.type}-${ev.sourceId}`} className="relative">
                  <span className="absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLE[ev.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {ev.type}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{ev.title}</span>
                    <span className="text-xs text-slate-400">{new Date(ev.at).toLocaleString()}</span>
                  </div>
                  {ev.detail && <p className="mt-0.5 text-sm text-slate-600">{ev.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </DashboardShell>
  );
}
