"use client";

// SuperAdmin — AI Template Categories (AI Center). Managed category groups for
// reusable AI prompt templates. Backed by /api/v1/admin/ai-template-categories.

import { FormEvent, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Category {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
}

type StatusFilter = "all" | "enabled" | "disabled";

const blankForm = { name: "", icon: "", description: "", enabled: true };

export default function AiTemplateCategoriesPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [rows, setRows] = useState<Category[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setErr(null);
      setRows(await api.get<Category[]>("/api/v1/admin/ai-template-categories"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load categories (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  const stats = useMemo(() => {
    const enabled = rows.filter((r) => r.enabled).length;
    return { total: rows.length, enabled, disabled: rows.length - enabled };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "enabled" && !r.enabled) return false;
      if (status === "disabled" && r.enabled) return false;
      if (!q) return true;
      return [r.name, r.key, r.icon ?? "", r.description ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, status]);

  function openCreate() {
    setEditId(null);
    setForm(blankForm);
    setShowForm(true);
  }
  function openEdit(c: Category) {
    setEditId(c.id);
    setForm({ name: c.name, icon: c.icon ?? "", description: c.description ?? "", enabled: c.enabled });
    setShowForm(true);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: form.name.trim(),
        icon: form.icon.trim() || undefined,
        description: form.description.trim() || undefined,
        enabled: form.enabled,
      };
      if (editId) await api.patch(`/api/v1/admin/ai-template-categories/${editId}`, body);
      else await api.post("/api/v1/admin/ai-template-categories", body);
      setNotice(editId ? "Category updated." : "Category created.");
      setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save category.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Category) {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try {
      await api.delete(`/api/v1/admin/ai-template-categories/${c.id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete category.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">AI Center</p>
          <h1 className="text-2xl font-semibold text-slate-950">
            AI Template Categories <span className="ml-2 text-sm font-normal text-slate-400">{rows.length} records</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Organize reusable AI prompts into clear category groups for faster authoring and governance.</p>
        </div>
        <button onClick={openCreate} className="flex-none rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          Create category
        </button>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Total", value: stats.total, hint: "All configured category groups." },
          { label: "Enabled", value: stats.enabled, hint: "Available to template authors." },
          { label: "Disabled", value: stats.disabled, hint: "Hidden from the active workflow." },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{s.value}</p>
            <p className="mt-1 text-xs text-slate-400">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex-1 text-sm font-medium text-slate-700">
          Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, icon, description..." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button onClick={() => { setQuery(""); setStatus("all"); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Reset</button>
      </div>

      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{filtered.length} matching categories</p>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No categories found.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-400">{c.icon || c.key}</p>
                </div>
                <span className={`flex-none rounded-full border px-2 py-0.5 text-xs font-medium ${c.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                  {c.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-500">{c.description || "No description provided for this template category yet."}</p>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => openEdit(c)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button>
                <button onClick={() => void remove(c)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-950">{editId ? "Edit category" : "Create category"}</h2>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Name
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Icon (e.g. fa-light fa-dumbbell)
              <input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Description
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Enabled
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} disabled={busy} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </DashboardShell>
  );
}
