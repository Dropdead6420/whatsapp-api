"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

// SuperAdmin UI for ProviderRoute (T-005e). Lists routes across the
// platform, lets the operator create a new route per (tenant,
// phoneNumberId?), edit isActive / providerKey / config, or delete.
// `config` is JSON; the server encrypts it before writing and only
// returns a redacted preview here.

type ProviderKey = "META" | "GUPSHUP" | "DIALOG_360" | "TWILIO" | "HAPTIK";
const PROVIDER_KEYS: ProviderKey[] = [
  "META",
  "GUPSHUP",
  "DIALOG_360",
  "TWILIO",
  "HAPTIK",
];

interface Route {
  id: string;
  tenantId: string;
  providerKey: ProviderKey;
  phoneNumberId: string | null;
  isActive: boolean;
  configPreview: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export default function ProviderRoutesPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [routes, setRoutes] = useState<Route[]>([]);
  const [tenantFilter, setTenantFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form
  const [createOpen, setCreateOpen] = useState(false);
  const [newTenantId, setNewTenantId] = useState("");
  const [newProvider, setNewProvider] = useState<ProviderKey>("META");
  const [newPhoneNumberId, setNewPhoneNumberId] = useState("");
  const [newConfigJson, setNewConfigJson] = useState("");

  async function load() {
    setErr(null);
    try {
      const params = tenantFilter.trim()
        ? `?tenantId=${encodeURIComponent(tenantFilter.trim())}`
        : "";
      const data = await api.get<Route[]>(
        `/api/v1/admin/provider-routes${params}`,
      );
      setRoutes(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to load routes",
      );
    }
  }

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      let config: Record<string, unknown> | null = null;
      if (newConfigJson.trim()) {
        try {
          config = JSON.parse(newConfigJson) as Record<string, unknown>;
        } catch {
          throw new Error("Config must be valid JSON (object).");
        }
      }
      await api.post<Route>("/api/v1/admin/provider-routes", {
        tenantId: newTenantId.trim(),
        providerKey: newProvider,
        phoneNumberId: newPhoneNumberId.trim() || null,
        config,
      });
      setInfo("Route created.");
      setNewTenantId("");
      setNewPhoneNumberId("");
      setNewConfigJson("");
      setNewProvider("META");
      setCreateOpen(false);
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(route: Route) {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await api.patch(`/api/v1/admin/provider-routes/${route.id}`, {
        isActive: !route.isActive,
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(route: Route) {
    if (
      !confirm(
        `Delete route for tenant ${route.tenantId}${route.phoneNumberId ? ` / phone ${route.phoneNumberId}` : ""}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.delete(`/api/v1/admin/provider-routes/${route.id}`);
      setInfo("Route deleted.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            WhatsApp provider routes
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick the BSP each tenant talks to. No rows = Meta Cloud everywhere.
            Credentials in <code>config</code> are envelope-encrypted at rest;
            this UI only shows the shape, not the values.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen((v) => !v)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {createOpen ? "Cancel" : "+ New route"}
        </button>
      </header>

      {err && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {err}
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {info}
        </div>
      )}

      {createOpen && (
        <form
          onSubmit={onCreate}
          className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Tenant ID *
              </span>
              <input
                required
                value={newTenantId}
                onChange={(e) => setNewTenantId(e.target.value)}
                placeholder="cmp96vh32…"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-900"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Provider *
              </span>
              <select
                value={newProvider}
                onChange={(e) =>
                  setNewProvider(e.target.value as ProviderKey)
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                {PROVIDER_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Phone number ID (optional)
              </span>
              <input
                value={newPhoneNumberId}
                onChange={(e) => setNewPhoneNumberId(e.target.value)}
                placeholder="Leave empty for tenant default"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-900"
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Config (JSON, optional) — encrypted on save
            </span>
            <textarea
              rows={4}
              value={newConfigJson}
              onChange={(e) => setNewConfigJson(e.target.value)}
              placeholder='{"apiKey":"sk_...","appName":"MyApp","source":"919..."}'
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Create route"}
            </button>
          </div>
        </form>
      )}

      <div className="mb-3 flex items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Filter by tenant
          </span>
          <input
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            placeholder="tenant cuid"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-900"
          />
        </label>
        <button
          onClick={() => void load()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          Apply
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Config preview</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-slate-400"
                >
                  No routes — every tenant falls through to Meta Cloud.
                </td>
              </tr>
            )}
            {routes.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{r.tenantId}</td>
                <td className="px-3 py-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium">
                    {r.providerKey}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.phoneNumberId ?? (
                    <span className="text-slate-400">default</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => void toggleActive(r)}
                    disabled={busy}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      r.isActive
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    } disabled:opacity-60`}
                  >
                    {r.isActive ? "Active" : "Disabled"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {r.configPreview ? (
                    <span className="font-mono text-xs">
                      {Object.entries(r.configPreview)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("  ·  ")}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(r.updatedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => void onDelete(r)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:underline disabled:opacity-60"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
