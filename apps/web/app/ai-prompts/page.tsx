"use client";

// AdGrowly — AI Prompt Management (planning PDF §4). SUPER_ADMIN-curated prompt
// templates consumed across AI features. Backed by module 6:
// /api/v1/admin/ai-prompts (+ /:id/preview). No hardcoded prompts.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  template: string;
  variables: string[];
  model: string | null;
  isActive: boolean;
  version: number;
}

export default function AiPromptsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Template[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [model, setModel] = useState("");
  const [template, setTemplate] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewVars, setPreviewVars] = useState("{}");
  const [previewResult, setPreviewResult] = useState<{ text: string; missing: string[] } | null>(null);
  const [seeds, setSeeds] = useState<{ key: string; template: string }[]>([]);
  const [coverage, setCoverage] = useState<{ key: string; hasActiveTemplate: boolean; source: string }[]>([]);
  const [sampleVars, setSampleVars] = useState<Record<string, Record<string, unknown>>>({});

  async function refresh() {
    try {
      setErr(null);
      const [list, seedList, coverageList, sampleList] = await Promise.all([
        api.get<Template[]>("/api/v1/admin/ai-prompts"),
        api.get<{ key: string; template: string }[]>("/api/v1/admin/ai-prompts/seeds"),
        api.get<{ key: string; hasActiveTemplate: boolean; source: string }[]>("/api/v1/admin/ai-prompts/coverage"),
        api.get<{ key: string; variables: Record<string, unknown> }[]>("/api/v1/admin/ai-prompts/sample-vars"),
      ]);
      setItems(list);
      setSeeds(seedList);
      setCoverage(coverageList);
      setSampleVars(Object.fromEntries(sampleList.map((s) => [s.key, s.variables])));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load prompts (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  function adoptSeed(seed: { key: string; template: string }) {
    setKey(seed.key);
    setTemplate(seed.template);
    if (!name.trim()) setName(seed.key.replace(/^gmb\./, "").replace(/[_.]/g, " "));
    setNotice(`Loaded starter template for ${seed.key} — edit and create.`);
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/ai-prompts", {
        key: key.trim(),
        name: name.trim(),
        category: category.trim() || undefined,
        model: model.trim() || undefined,
        template,
      });
      setKey("");
      setName("");
      setCategory("");
      setModel("");
      setTemplate("");
      setNotice("Prompt template created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create template.");
    }
  }

  async function saveEdit(id: string) {
    try {
      await api.patch(`/api/v1/admin/ai-prompts/${id}`, { template: editText });
      setEditId(null);
      setNotice("Template updated (version bumped).");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update template.");
    }
  }

  async function toggleActive(t: Template) {
    try {
      await api.patch(`/api/v1/admin/ai-prompts/${t.id}`, { isActive: !t.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to toggle.");
    }
  }

  async function runPreview(id: string) {
    setErr(null);
    let variables: unknown;
    try {
      variables = JSON.parse(previewVars || "{}");
    } catch {
      setErr("Variables must be valid JSON, e.g. { \"name\": \"Acme\" }.");
      return;
    }
    try {
      setPreviewResult(await api.post<{ text: string; missing: string[] }>(`/api/v1/admin/ai-prompts/${id}/preview`, { variables }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to preview.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this template?")) return;
    try {
      await api.delete(`/api/v1/admin/ai-prompts/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Super Admin</p>
        <h1 className="text-2xl font-semibold text-slate-950">AI Prompt Management</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Manage the prompt templates used across AI features. Use <code className="rounded bg-slate-100 px-1">{"{{variable}}"}</code> placeholders; preview with sample values before saving.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      {coverage.length > 0 && (
        <div className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Prompt coverage</h2>
            <span className="text-xs text-slate-400">
              {coverage.filter((c) => c.hasActiveTemplate).length}/{coverage.length} features on a curated template
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Features without an active template fall back to the built-in seed.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {coverage.map((c) => (
              <span
                key={c.key}
                title={c.hasActiveTemplate ? "Uses an active admin template" : "Falls back to the built-in seed"}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  c.hasActiveTemplate ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                {c.key.replace(/^gmb\./, "")}
                <span className="opacity-70">· {c.hasActiveTemplate ? "template" : "seed"}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={create} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New template</h2>
          {seeds.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-slate-500">Adopt a starter template:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {seeds.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => adoptSeed(s)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {s.key.replace(/^gmb\./, "")}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Key
            <input value={key} onChange={(e) => setKey(e.target.value)} required placeholder="gmb.review_reply" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Category
              <input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Model
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="optional" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Template
            <textarea value={template} onChange={(e) => setTemplate(e.target.value)} required rows={5} placeholder="Reply to {{author}} about their {{rating}}-star review…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Create template</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No templates yet.</p>}
          {items.map((t) => (
            <div key={t.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-800">{t.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{t.key} · v{t.version}{t.category ? ` · ${t.category}` : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => void toggleActive(t)} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${t.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    {t.isActive ? "active" : "inactive"}
                  </button>
                  <button onClick={() => void remove(t.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                </div>
              </div>

              {editId === t.id ? (
                <div className="mt-3">
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={5} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono" />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void saveEdit(t.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
                    <button onClick={() => setEditId(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              ) : (
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{t.template}</pre>
              )}

              {t.variables.length > 0 && (
                <p className="mt-2 text-xs text-slate-400">variables: {t.variables.join(", ")}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => { setEditId(t.id); setEditText(t.template); }} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Edit</button>
                <button onClick={() => { setPreviewId(previewId === t.id ? null : t.id); setPreviewResult(null); }} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Preview</button>
              </div>

              {previewId === t.id && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Sample variables (JSON)
                    <textarea value={previewVars} onChange={(e) => setPreviewVars(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs" />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void runPreview(t.id)} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900">Render</button>
                    {sampleVars[t.key.trim().toLowerCase()] && (
                      <button
                        type="button"
                        onClick={() => setPreviewVars(JSON.stringify(sampleVars[t.key.trim().toLowerCase()], null, 2))}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Fill sample
                      </button>
                    )}
                  </div>
                  {previewResult && (
                    <div className="mt-2">
                      <p className="whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">{previewResult.text}</p>
                      {previewResult.missing.length > 0 && (
                        <p className="mt-1 text-xs text-amber-700">missing: {previewResult.missing.join(", ")}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
