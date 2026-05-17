"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError, API_BASE, tokenStore } from "../../src/lib/api";

type LifecycleStage =
  | "LEAD"
  | "PROSPECT"
  | "CUSTOMER"
  | "REPEAT_CUSTOMER"
  | "VIP"
  | "CHURNED";

const STAGE_STYLES: Record<LifecycleStage, string> = {
  LEAD: "bg-slate-100 text-slate-700",
  PROSPECT: "bg-blue-50 text-blue-700",
  CUSTOMER: "bg-emerald-50 text-emerald-700",
  REPEAT_CUSTOMER: "bg-emerald-100 text-emerald-800",
  VIP: "bg-amber-100 text-amber-800",
  CHURNED: "bg-red-50 text-red-700",
};

const STAGE_LABELS: Record<LifecycleStage, string> = {
  LEAD: "Lead",
  PROSPECT: "Prospect",
  CUSTOMER: "Customer",
  REPEAT_CUSTOMER: "Repeat",
  VIP: "VIP",
  CHURNED: "Churned",
};

interface Contact {
  id: string;
  phoneNumber: string;
  name: string;
  email: string | null;
  tags: string[];
  optedOut: boolean;
  optedOutAt: string | null;
  lifecycleStage: LifecycleStage;
  createdAt: string;
}

export default function ContactsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"],
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    try {
      const list = await api.get<Contact[]>("/api/v1/contacts?limit=100");
      setContacts(list);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function setStage(contactId: string, stage: LifecycleStage) {
    try {
      await api.patch(`/api/v1/contacts/${contactId}`, { lifecycleStage: stage });
      setContacts((cs) =>
        cs.map((c) => (c.id === contactId ? { ...c, lifecycleStage: stage } : c)),
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  async function reOptIn(contactId: string, name: string) {
    if (
      !confirm(
        `Re-opt-in ${name}? Only do this if you have explicit consent from the customer. Marketing without consent violates Meta Commerce Policy.`,
      )
    )
      return;
    try {
      await api.patch(`/api/v1/contacts/${contactId}`, { optedOut: false });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Re-opt-in failed");
    }
  }

  async function downloadCsv() {
    const token = tokenStore.getAccess();
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/v1/contacts/export.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setErr(`Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-slate-500">{contacts.length} total</p>
        </div>
        <div className="flex gap-2">
          {user.role !== "AGENT" && (
            <button
              onClick={downloadCsv}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              ⬇ Export CSV
            </button>
          )}
          {user.role !== "AGENT" && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {showCreate ? "Cancel" : "+ New contact"}
            </button>
          )}
        </div>
      </header>

      {showCreate && (
        <CreateContactForm onSaved={() => { setShowCreate(false); refresh(); }} />
      )}

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Opt-out</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium">
                  {c.name}
                  {c.email && (
                    <div className="text-[11px] text-slate-500">{c.email}</div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{c.phoneNumber}</td>
                <td className="px-4 py-3">
                  {user.role !== "AGENT" ? (
                    <select
                      value={c.lifecycleStage}
                      onChange={(e) =>
                        setStage(c.id, e.target.value as LifecycleStage)
                      }
                      className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLES[c.lifecycleStage]} border-0 focus:ring-1 focus:ring-emerald-500`}
                    >
                      {(Object.keys(STAGE_LABELS) as LifecycleStage[]).map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLES[c.lifecycleStage]}`}
                    >
                      {STAGE_LABELS[c.lifecycleStage]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.tags.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.optedOut ? (
                    <div className="space-y-1">
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        Opted out
                      </span>
                      {c.optedOutAt && (
                        <div className="text-[11px] text-slate-500">
                          {new Date(c.optedOutAt).toLocaleDateString()}
                        </div>
                      )}
                      {user.role !== "AGENT" && (
                        <button
                          onClick={() => reOptIn(c.id, c.name)}
                          className="block text-[11px] text-emerald-700 hover:underline"
                          title="Only re-opt-in with explicit consent (Meta policy)"
                        >
                          Re-opt-in
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Subscribed</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && !err && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  No contacts yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}

function CreateContactForm({ onSaved }: { onSaved: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.post("/api/v1/contacts", {
        phoneNumber: phone.trim(),
        name: name.trim(),
        email: email.trim() || undefined,
        tags,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5"
    >
      <input
        placeholder="+919876543210"
        required
        pattern="^\+?[1-9]\d{6,14}$"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Full name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Email (optional)"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Tags (comma)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {err && (
        <div className="md:col-span-5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {err}
        </div>
      )}
    </form>
  );
}
