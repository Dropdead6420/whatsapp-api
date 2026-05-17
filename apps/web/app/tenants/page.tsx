"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Tenant {
  id: string;
  name: string;
  type: string;
  status: string;
  domain: string | null;
  createdAt: string;
  _count?: { users: number; contacts: number; campaigns: number };
}

export default function TenantsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<Tenant[]>("/api/v1/tenants?limit=50")
      .then(setTenants)
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : "Failed to load"));
  }, [user]);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-slate-500">{tenants.length} accounts</p>
        </div>
        <Link
          href="/tenants/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New tenant
        </Link>
      </header>

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
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => {
                  window.location.href = `/tenants/${t.id}`;
                }}
              >
                <td className="px-4 py-3 font-medium">
                  <Link href={`/tenants/${t.id}`} className="hover:underline">
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{t.type}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      t.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{t.domain ?? "—"}</td>
                <td className="px-4 py-3">{t._count?.users ?? 0}</td>
                <td className="px-4 py-3">{t._count?.contacts ?? 0}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {tenants.length === 0 && !err && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No tenants yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
