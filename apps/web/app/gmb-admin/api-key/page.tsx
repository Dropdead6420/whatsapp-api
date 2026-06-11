"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { GmbAdminConsole } from "../../../src/components/GmbAdminConsole";
import { useAuth } from "../../../src/hooks/useAuth";
import { API_BASE, api, ApiClientError, tokenStore } from "../../../src/lib/api";

interface ApiKeyItem {
  id: string;
  name: string;
  rateLimit: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user?: {
    name: string;
    email: string;
  };
}

interface CreatedApiKey extends ApiKeyItem {
  secret: string;
}

interface ApiRequestLog {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ipAddress: string | null;
  createdAt: string;
}

interface ApiUsageSummary {
  totalLast7Days: number;
  byDay: Array<{ date: string; count: number; errors: number }>;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function apiBaseForDisplay(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

function sampleCurl(baseUrl: string): string {
  return [
    "curl -s \\",
    '  -H "Authorization: Bearer nxf_live_..." \\',
    `  "${baseUrl}/api/public/v1/status"`,
  ].join("\n");
}

export default function GmbAdminApiKeyPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "BUSINESS_ADMIN"],
  });
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [usage, setUsage] = useState<ApiUsageSummary | null>(null);
  const [name, setName] = useState("GMB Admin API");
  const [rateLimit, setRateLimit] = useState(1000);
  const [expiresAt, setExpiresAt] = useState("");
  const [createdSecret, setCreatedSecret] = useState<CreatedApiKey | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ApiRequestLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [specBusy, setSpecBusy] = useState<"download" | "open" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const [keys, summary] = await Promise.all([
        api.get<ApiKeyItem[]>("/api/v1/api-keys"),
        api.get<ApiUsageSummary>("/api/v1/api-keys/usage-summary"),
      ]);
      setItems(keys);
      setUsage(summary);
      setSelectedKeyId((current) => current ?? keys[0]?.id ?? null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load API keys.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  useEffect(() => {
    if (!selectedKeyId) {
      setLogs([]);
      return;
    }
    api
      .get<ApiRequestLog[]>(`/api/v1/api-keys/${selectedKeyId}/logs`)
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [selectedKeyId]);

  const selectedKey = useMemo(
    () => items.find((item) => item.id === selectedKeyId) ?? null,
    [items, selectedKeyId],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    setCreatedSecret(null);
    try {
      const created = await api.post<CreatedApiKey>("/api/v1/api-keys", {
        name,
        rateLimit,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setCreatedSecret(created);
      setSelectedKeyId(created.id);
      setName("GMB Admin API");
      setRateLimit(1000);
      setExpiresAt("");
      setNotice("API key created. Copy the secret before leaving this page.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create API key.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this API key? Existing integrations using it will stop working.")) {
      return;
    }
    try {
      setErr(null);
      await api.delete(`/api/v1/api-keys/${id}`);
      setNotice("API key revoked.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to revoke API key.");
    }
  }

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret);
    setNotice("Secret copied.");
  }

  async function fetchOpenApiSpec(): Promise<Blob> {
    const token = tokenStore.getAccess();
    const response = await fetch(`${API_BASE}/api/v1/api-keys/openapi.json`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new Error(`OpenAPI download failed (${response.status})`);
    }
    return response.blob();
  }

  async function handleOpenApi(action: "download" | "open") {
    setErr(null);
    setSpecBusy(action);
    try {
      const blob = await fetchOpenApiSpec();
      const href = URL.createObjectURL(blob);
      if (action === "open") {
        window.open(href, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "nexaflow-openapi.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to load OpenAPI spec.");
    } finally {
      setSpecBusy(null);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} products={products} signOut={signOut}>
      <GmbAdminConsole
        title="Setup API Key"
        description="Create tenant-scoped API keys for GMB automation, partner syncs, and external reporting tools."
        actions={
          <>
            <button
              type="button"
              onClick={() => void handleOpenApi("download")}
              disabled={Boolean(specBusy)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {specBusy === "download" ? "Preparing..." : "OpenAPI JSON"}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenApi("open")}
              disabled={Boolean(specBusy)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              <ExternalLink className="h-4 w-4" />
              {specBusy === "open" ? "Opening..." : "View spec"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),360px]">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Public API access</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Keys are reveal-once, rate-limited, tenant scoped, and logged. Use them for GMB automations that need NexaFlow data.
                  </p>
                </div>
                <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <ShieldCheck className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-white">
                <pre>{sampleCurl(apiBaseForDisplay())}</pre>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Send the secret as <span className="font-mono">Authorization: Bearer</span> or{" "}
                <span className="font-mono">X-NexaFlow-API-Key</span>.
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-950">Usage</h2>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                  7 days
                </span>
              </div>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                {(usage?.totalLast7Days ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-slate-500">requests across all keys</p>
              <div className="mt-4 flex h-20 items-end gap-1">
                {(usage?.byDay ?? []).map((day) => {
                  const max = Math.max(...(usage?.byDay ?? []).map((x) => x.count), 1);
                  const height = Math.round((day.count / max) * 100);
                  return (
                    <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-blue-600"
                        style={{ height: `${Math.max(height, 6)}%` }}
                        title={`${day.count} calls, ${day.errors} errors`}
                      />
                      <span className="text-[10px] text-slate-400">{day.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {createdSecret && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-emerald-950">
                    New key created: {createdSecret.name}
                  </h2>
                  <p className="mt-1 text-sm text-emerald-800">
                    This secret is shown once. Copy it now and store it in your password manager.
                  </p>
                  <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-200 bg-white p-3 font-mono text-xs text-slate-900">
                    {createdSecret.secret}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copySecret(createdSecret.secret)}
                  className="inline-flex flex-none items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  <Copy className="h-4 w-4" />
                  Copy secret
                </button>
              </div>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-[360px,1fr]">
            <form onSubmit={submit} className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-blue-600" />
                <h2 className="text-base font-semibold text-slate-950">Create key</h2>
              </div>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Key name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Rate limit / minute
                <input
                  type="number"
                  value={rateLimit}
                  onChange={(event) => setRateLimit(Number(event.target.value))}
                  min={60}
                  max={10000}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Expiry
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Creating..." : "Create API key"}
              </button>
            </form>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Active keys</h2>
                  <p className="text-xs text-slate-500">{items.length} configured</p>
                </div>
              </header>
              {items.length === 0 ? (
                <div className="p-8 text-sm text-slate-500">No API keys yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Rate</th>
                        <th className="px-4 py-3 font-semibold">Last used</th>
                        <th className="px-4 py-3 font-semibold">Expires</th>
                        <th className="px-4 py-3 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className={selectedKeyId === item.id ? "bg-blue-50/60" : "hover:bg-slate-50"}
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedKeyId(item.id)}
                              className="text-left font-semibold text-slate-950 hover:text-blue-700"
                            >
                              {item.name}
                            </button>
                            {item.user && (
                              <div className="mt-1 text-xs text-slate-500">
                                {item.user.name} - {item.user.email}
                              </div>
                            )}
                            <div className="mt-1 text-[10px] text-slate-400">
                              Created {formatDate(item.createdAt)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {item.rateLimit.toLocaleString()}/min
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDate(item.lastUsedAt)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDate(item.expiresAt)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => void revoke(item.id)}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Recent API calls</h2>
              <p className="text-xs text-slate-500">
                {selectedKey ? selectedKey.name : "Select a key to inspect usage."}
              </p>
            </header>
            {!selectedKeyId ? (
              <div className="p-6 text-sm text-slate-500">No API key selected.</div>
            ) : logs.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No calls logged for this key yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Time</th>
                      <th className="px-4 py-3 font-semibold">Request</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Latency</th>
                      <th className="px-4 py-3 font-semibold">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-4 py-3 text-slate-600">{formatDate(log.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-950">{log.method}</span>{" "}
                          <span className="font-mono text-xs text-slate-600">{log.path}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              log.statusCode >= 500
                                ? "bg-red-50 text-red-700"
                                : log.statusCode >= 400
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {log.statusCode}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{log.durationMs}ms</td>
                        <td className="px-4 py-3 text-slate-600">{log.ipAddress ?? "unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </GmbAdminConsole>
    </DashboardShell>
  );
}
