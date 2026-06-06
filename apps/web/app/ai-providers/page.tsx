"use client";

// AI Providers admin (Complete Planning PDF §2.10). Surfaces the AI Provider
// Hub: configure providers + fallback order, test connectivity against the
// linked Secret Vault key, and view spend from the cost manager. English-
// first; localisation + a vault-secret picker are follow-ups.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const PROVIDERS = ["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK", "GROK", "CUSTOM"] as const;
const KINDS = ["TEXT", "IMAGE", "VIDEO", "VOICE", "EMBEDDING"] as const;

interface ProviderConfig {
  id: string;
  provider: string;
  kind: string;
  label: string;
  defaultModel: string | null;
  baseUrl: string | null;
  priority: number;
  isDefault: boolean;
  status: string;
  hasKey: boolean;
}

interface UsageSummary {
  sinceDays: number;
  totalEvents: number;
  totalCostCents: number;
  byModel: Array<{ key: string; events: number; costCents: number }>;
}

interface TestResult {
  ok: boolean;
  message: string;
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AiProvidersPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<ProviderConfig[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [provider, setProvider] = useState<string>("OPENAI");
  const [kind, setKind] = useState<string>("TEXT");
  const [label, setLabel] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [secretId, setSecretId] = useState("");
  const [priority, setPriority] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<ProviderConfig[]>("/api/v1/ai-providers"));
      setUsage(await api.get<UsageSummary>("/api/v1/ai-providers/usage?days=30"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load AI providers.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function addProvider(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/ai-providers", {
        provider,
        kind,
        label: label.trim(),
        defaultModel: defaultModel.trim() || undefined,
        secretId: secretId.trim() || undefined,
        priority,
      });
      setLabel("");
      setDefaultModel("");
      setSecretId("");
      setPriority(100);
      setNotice("Provider added.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to add provider.");
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(id: string) {
    setErr(null);
    setNotice(null);
    try {
      const r = await api.post<TestResult>(`/api/v1/ai-providers/${id}/test`, {});
      setNotice(`${r.ok ? "OK" : "Failed"}: ${r.message}`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Test failed.");
    }
  }

  async function setDefault(id: string) {
    try {
      await api.post(`/api/v1/ai-providers/${id}/set-default`, {});
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to set default.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this provider config?")) return;
    try {
      await api.delete(`/api/v1/ai-providers/${id}`);
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
        <p className="text-sm font-medium text-emerald-700">AI</p>
        <h1 className="text-2xl font-semibold text-slate-950">AI providers</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Configure providers and fallback order. Requests try the default first,
          then the rest by ascending priority. Keys live in the Secret Vault.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {usage && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="AI spend (30d)" value={dollars(usage.totalCostCents)} />
          <SummaryCard label="Requests (30d)" value={String(usage.totalEvents)} />
          <SummaryCard
            label="Top model"
            value={usage.byModel[0]?.key ?? "—"}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <form onSubmit={addProvider} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Add provider</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Default model (optional)
            <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="e.g. gpt-4o-mini" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Vault secret id (optional)
            <input value={secretId} onChange={(e) => setSecretId(e.target.value)} placeholder="sv_..." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Priority (lower = tried first)
            <input type="number" value={priority} min={0} max={10000} onChange={(e) => setPriority(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Adding..." : "Add provider"}
          </button>
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No providers configured yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Provider</th>
                    <th className="px-4 py-3 font-semibold">Label</th>
                    <th className="px-4 py-3 font-semibold">Model</th>
                    <th className="px-4 py-3 font-semibold">Priority</th>
                    <th className="px-4 py-3 font-semibold">Key</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{it.provider}</div>
                        <div className="text-xs text-slate-500">{it.kind}{it.isDefault ? " · default" : ""}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{it.label}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{it.defaultModel ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{it.priority}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${it.hasKey ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {it.hasKey ? "linked" : "none"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => void testProvider(it.id)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Test</button>
                        {!it.isDefault && (
                          <button onClick={() => void setDefault(it.id)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Set default</button>
                        )}
                        <button onClick={() => void remove(it.id)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}
