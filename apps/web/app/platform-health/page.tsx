"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface ServiceHealth {
  name: string;
  status: "ok" | "error";
  latencyMs: number;
  detail?: string;
}

interface PlatformHealth {
  overall: "ok" | "degraded";
  checkedAt: string;
  services: ServiceHealth[];
}

export default function PlatformHealthPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function loadHealth() {
    setRefreshing(true);
    setErr(null);
    try {
      const next = await api.get<PlatformHealth>("/api/v1/admin/health");
      setHealth(next);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load health");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadHealth();
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform Health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live checks for the core services required to run NexaFlow.
          </p>
        </div>
        <button
          onClick={() => void loadHealth()}
          disabled={refreshing}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {refreshing ? "Checking..." : "Refresh"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Overall
          </div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              health?.overall === "ok" ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {health?.overall ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Services
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {health?.services.filter((service) => service.status === "ok").length ?? "-"}
            <span className="text-base text-slate-400">
              /{health?.services.length ?? "-"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Last Check
          </div>
          <div className="mt-2 text-sm font-medium text-slate-700">
            {health ? new Date(health.checkedAt).toLocaleString() : "-"}
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Latency</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {health?.services.map((service) => (
              <tr key={service.name}>
                <td className="px-4 py-3 font-medium capitalize">{service.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      service.status === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {service.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{service.latencyMs}ms</td>
                <td className="px-4 py-3 text-slate-500">{service.detail ?? "Healthy"}</td>
              </tr>
            ))}
            {!health && !err && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                  Loading health checks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
