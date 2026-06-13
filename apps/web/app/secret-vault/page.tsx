"use client";

// Secret Vault admin (Complete Planning PDF §2.9). Manage encrypted provider
// credentials: add, test (decrypt check), rotate, reveal-once and delete.
// Secrets are stored envelope-encrypted server-side; this UI only ever sees
// a masked last4 unless you explicitly reveal. English-first.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const PROVIDERS = [
  "META", "OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK", "GROK", "REPLICATE",
  "RAZORPAY", "STRIPE", "PAYPAL", "PAYU", "SMTP", "CUSTOM",
] as const;

interface Secret {
  id: string;
  scope: string;
  provider: string;
  label: string;
  last4: string | null;
  status: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

export default function SecretVaultPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Secret[]>([]);
  const [provider, setProvider] = useState<string>("OPENAI");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<Secret[]>("/api/v1/secret-vault?includeDisabled=true"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load secrets.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function addSecret(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const created = await api.post<Secret>("/api/v1/secret-vault", {
        provider,
        label: label.trim(),
        value,
      });
      setLabel("");
      setValue("");
      setNotice(`Secret "${created.label}" stored. Reference id: ${created.id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to store secret.");
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setErr(null);
    setNotice(null);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/api/v1/secret-vault/${id}/test`, {});
      setNotice(`${r.ok ? "OK" : "Failed"}: ${r.message}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Test failed.");
    }
  }

  async function rotate(id: string) {
    const next = window.prompt("Enter the new secret value (rotates the stored key):");
    if (!next) return;
    try {
      await api.post(`/api/v1/secret-vault/${id}/rotate`, { value: next });
      setNotice("Secret rotated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Rotate failed.");
    }
  }

  async function reveal(id: string) {
    if (!window.confirm("Reveal this secret in plaintext? This is audited.")) return;
    try {
      const r = await api.post<{ value: string }>(`/api/v1/secret-vault/${id}/reveal`, {});
      window.alert(`Secret value:\n\n${r.value}`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Reveal failed.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this secret? Anything referencing it will lose access.")) return;
    try {
      await api.delete(`/api/v1/secret-vault/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Security</p>
        <h1 className="text-2xl font-semibold text-slate-950">Secret vault</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Store provider API keys (Meta, AI, payments, SMTP). Values are encrypted
          at rest and never shown again — only a masked hint — unless you reveal.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 break-all">{notice}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={addSecret} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Add secret</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} placeholder="e.g. Production OpenAI" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Secret value
            <textarea value={value} onChange={(e) => setValue(e.target.value)} required rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          </label>
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Storing..." : "Store secret"}
          </button>
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No secrets stored yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Provider</th>
                    <th className="px-4 py-3 font-semibold">Label</th>
                    <th className="px-4 py-3 font-semibold">Hint</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{s.provider}</div>
                        <div className="text-xs text-slate-500">{s.scope}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{s.label}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.last4 ? `••••${s.last4}` : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => void test(s.id)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Test</button>
                        <button onClick={() => void rotate(s.id)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Rotate</button>
                        <button onClick={() => void reveal(s.id)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reveal</button>
                        <button onClick={() => void remove(s.id)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
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
