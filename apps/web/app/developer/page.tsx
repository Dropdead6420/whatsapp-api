"use client";

import { FormEvent, useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { API_BASE, api, ApiClientError, tokenStore } from "../../src/lib/api";

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

interface ApiUsageSummary {
  totalLast7Days: number;
  byDay: Array<{ date: string; count: number; errors: number }>;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

const PUBLIC_ENDPOINTS = [
  {
    method: "GET",
    path: "/api/public/v1/status",
    description: "Validate a key and inspect tenant context.",
  },
  {
    method: "GET",
    path: "/api/public/v1/contacts?search=riya&tag=vip",
    description: "List contacts with pagination, search, tag, and opt-out filters.",
  },
  {
    method: "POST",
    path: "/api/public/v1/contacts",
    description: "Create a contact with phone, name, tags, and custom fields.",
  },
  {
    method: "PATCH",
    path: "/api/public/v1/contacts/{id}",
    description: "Update CRM fields, lifecycle stage, tags, or opt-out state.",
  },
  {
    method: "GET",
    path: "/api/public/v1/leads?status=NEW",
    description: "List leads with contact details and optional status/contact filters.",
  },
  {
    method: "POST",
    path: "/api/public/v1/leads",
    description: "Create a lead and trigger LEAD_CREATED webhooks/flows.",
  },
  {
    method: "PATCH",
    path: "/api/public/v1/leads/{id}",
    description: "Move a lead through the pipeline or update value/probability.",
  },
  {
    method: "GET",
    path: "/api/public/v1/conversations/{id}/messages",
    description: "Read messages in a tenant-scoped WhatsApp conversation.",
  },
] as const;

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
  const [usage, setUsage] = useState<ApiUsageSummary | null>(null);
  const [specBusy, setSpecBusy] = useState<"download" | "open" | null>(null);

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
    if (user) {
      void refresh();
      api
        .get<ApiUsageSummary>("/api/v1/api-keys/usage-summary")
        .then(setUsage)
        .catch(() => setUsage(null));
    }
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

      {usage && (
        <div className="mb-5 rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="font-semibold text-slate-950">API usage (7 days)</div>
          <p className="mt-1 text-xs text-slate-500">
            {usage.totalLast7Days} requests across all keys
          </p>
          <div className="mt-3 flex items-end gap-1 h-24">
            {usage.byDay.map((d) => {
              const max = Math.max(...usage.byDay.map((x) => x.count), 1);
              const h = Math.round((d.count / max) * 100);
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-emerald-500"
                    style={{ height: `${Math.max(h, 4)}%` }}
                    title={`${d.count} calls, ${d.errors} errors`}
                  />
                  <span className="text-[9px] text-slate-400">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr,360px]">
        <section className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-semibold text-slate-950">Public API v1</div>
              <p className="mt-1 text-xs text-slate-500">
                Tenant-scoped REST access for contacts, leads, conversations, and CRM syncs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleOpenApi("download")}
                disabled={Boolean(specBusy)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {specBusy === "download" ? "Preparing..." : "OpenAPI JSON"}
              </button>
              <button
                type="button"
                onClick={() => void handleOpenApi("open")}
                disabled={Boolean(specBusy)}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {specBusy === "open" ? "Opening..." : "View spec"}
              </button>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Method</th>
                  <th className="px-3 py-2 font-semibold">Endpoint</th>
                  <th className="px-3 py-2 font-semibold">Use</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {PUBLIC_ENDPOINTS.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <td className="px-3 py-2">
                      <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs font-semibold text-emerald-700">
                        {endpoint.method}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-slate-700">
                        {endpoint.path}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {endpoint.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="font-semibold text-slate-950">Quick test</div>
          <div className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-white">
            <pre>{sampleCurl(apiBaseForDisplay())}</pre>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Use <span className="font-mono">Authorization: Bearer</span> or{" "}
            <span className="font-mono">X-NexaFlow-API-Key</span>. Every request is
            logged and limited per key.
          </p>
        </section>
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

function sampleCurl(baseUrl: string): string {
  return [
    "curl -s \\",
    `  -H "Authorization: Bearer nxf_live_..." \\`,
    `  "${baseUrl}/api/public/v1/status"`,
  ].join("\n");
}
