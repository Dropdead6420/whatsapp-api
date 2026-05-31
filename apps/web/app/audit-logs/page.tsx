"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface AuditLogItem {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string | null;
  oldValues: string | null;
  newValues: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  tenant?: { id: string; name: string; type: string };
  user?: { id: string; name: string; email: string; role: string };
}

interface AuditResponse {
  items: AuditLogItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AuditLogsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "BUSINESS_ADMIN"],
  });
  const [logs, setLogs] = useState<AuditResponse | null>(null);
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // SuperAdmin sees the cross-tenant feed; BUSINESS_ADMIN only sees
  // their own tenant's trail. The two endpoints share a wire format
  // so the rest of this page renders identically — the only visible
  // difference is the Tenant column, hidden for the own-tenant view.
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const endpointBase = isSuperAdmin
    ? "/api/v1/admin/audit-logs"
    : "/api/v1/audit-logs";

  async function loadLogs(nextAction = action, nextResource = resource) {
    setErr(null);
    const params = new URLSearchParams({ limit: "50" });
    if (nextAction.trim()) params.set("action", nextAction.trim());
    if (nextResource.trim()) params.set("resource", nextResource.trim());
    try {
      const data = await api.get<AuditResponse>(
        `${endpointBase}?${params.toString()}`,
      );
      setLogs(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load audit logs");
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadLogs();
  }

  useEffect(() => {
    if (!user) return;
    void loadLogs("", "");
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isSuperAdmin
            ? "Security and mutation trail across the platform."
            : "Security and mutation trail for your workspace — who changed what and when."}
        </p>
      </header>

      <form
        onSubmit={applyFilters}
        className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-[1fr_1fr_auto]"
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Action
          </span>
          <input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="CREATE, UPDATE, LOGIN"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Resource
          </span>
          <input
            value={resource}
            onChange={(event) => setResource(event.target.value)}
            placeholder="Tenant, Contact, Campaign"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
        </label>
        <button className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Apply
        </button>
      </form>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              {isSuperAdmin && <th className="px-4 py-3">Tenant</th>}
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs?.items.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{log.user?.name ?? log.userId}</div>
                  <div className="text-xs text-slate-500">{log.user?.email}</div>
                </td>
                {isSuperAdmin && (
                  <td className="px-4 py-3 text-slate-600">
                    {log.tenant?.name ?? log.tenantId}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {log.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{log.resource}</div>
                  <div className="max-w-[180px] truncate text-xs text-slate-500">
                    {log.resourceId ?? "No resource id"}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{log.ipAddress ?? "-"}</td>
              </tr>
            ))}
            {logs?.items.length === 0 && !err && (
              <tr>
                <td
                  colSpan={isSuperAdmin ? 6 : 5}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No audit logs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
