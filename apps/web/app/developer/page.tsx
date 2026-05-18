"use client";

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

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
  userAgent: string | null;
  createdAt: string;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export default function DeveloperPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN"],
  });
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("Production API");
  const [rateLimit, setRateLimit] = useState(1000);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreatedApiKey | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ApiRequestLog[]>([]);

  async function refresh() {
    try {
      setErr(null);
      const data = await api.get<ApiKeyItem[]>("/api/v1/api-keys");
      setItems(data);
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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setCreatedSecret(null);
    try {
      const created = await api.post<CreatedApiKey>("/api/v1/api-keys", {
        name,
        rateLimit,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setCreatedSecret(created);
      setName("Production API");
      setRateLimit(1000);
      setExpiresAt("");
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
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to revoke API key.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Developer</p>
          <h1 className="text-2xl font-semibold text-slate-950">API keys</h1>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {items.length} active {items.length === 1 ? "key" : "keys"}
        </div>
      </div>

      <div className="mb-5 rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <div className="font-semibold text-slate-950">Sandbox endpoint</div>
        <div className="mt-2 rounded-md bg-slate-950 p-3 font-mono text-xs text-white">
          GET {apiBaseForDisplay()}/api/public/v1/status
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Send the API key as <span className="font-mono">Authorization: Bearer</span> or <span className="font-mono">X-NexaFlow-API-Key</span>. The request will appear in the selected key logs.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {createdSecret && (
        <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-950">
            New key created: {createdSecret.name}
          </div>
          <div className="mt-2 rounded-md border border-emerald-200 bg-white p-3 font-mono text-xs text-slate-900">
            {createdSecret.secret}
          </div>
          <p className="mt-2 text-xs text-emerald-800">
            This secret is shown once. Store it before leaving this page.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        <form
          onSubmit={submit}
          className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="text-base font-semibold text-slate-950">Create key</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={80}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Rate limit / minute
            <input
              type="number"
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              min={60}
              max={10000}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Expiry
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create API key"}
          </button>
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center">
              <h2 className="text-base font-semibold text-slate-950">
                No API keys yet
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Create the first key for this tenant.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Rate</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">Last used</th>
                    <th className="px-4 py-3 font-semibold">Expires</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{item.name}</div>
                        {item.user && (
                          <div className="mt-1 text-xs text-slate-500">
                            {item.user.name} - {item.user.email}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.rateLimit.toLocaleString()}/min
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(item.lastUsedAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(item.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelectedKeyId(item.id)}
                          className="mr-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Logs
                        </button>
                        <button
                          onClick={() => revoke(item.id)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
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

      <section className="mt-6 rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Recent API calls</h2>
            <p className="text-xs text-slate-500">
              {selectedKeyId
                ? items.find((item) => item.id === selectedKeyId)?.name ?? "Selected key"
                : "Select a key to inspect usage."}
            </p>
          </div>
          {selectedKeyId && (
            <button
              onClick={() => setSelectedKeyId(null)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
        {!selectedKeyId ? (
          <div className="p-6 text-sm text-slate-500">No API key selected.</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No calls logged for this key yet.
          </div>
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
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-950">
                        {log.method}
                      </span>{" "}
                      <span className="font-mono text-xs text-slate-600">
                        {log.path}
                      </span>
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
                    <td className="px-4 py-3 text-slate-600">
                      {log.durationMs}ms
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {log.ipAddress ?? "unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

function apiBaseForDisplay(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}
