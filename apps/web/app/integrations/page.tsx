"use client";

// Integrations Hub (Complete Planning PDF §2.22). Browse the connector
// catalog and manage connections. Credentials are stored in the Secret
// Vault and referenced by id; per-connector data sync is a follow-up.

import { useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Connector {
  provider: string;
  name: string;
  category: string;
  authType: string;
  description: string;
}

interface Integration {
  id: string;
  provider: string;
  label: string;
  status: string;
  hasCredential: boolean;
  externalAccountLabel: string | null;
}

export default function IntegrationsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [catalog, setCatalog] = useState<Connector[]>([]);
  const [connected, setConnected] = useState<Integration[]>([]);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setCatalog(await api.get<Connector[]>("/api/v1/integrations/catalog"));
      setConnected(await api.get<Integration[]>("/api/v1/integrations"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load integrations.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function connect(c: Connector) {
    setBusyProvider(c.provider);
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/integrations", { provider: c.provider, label: c.name });
      setNotice(`${c.name} connected. Add credentials in the Secret Vault and link them here.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to connect.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnect(id: string) {
    if (!window.confirm("Disconnect this integration?")) return;
    try {
      await api.delete(`/api/v1/integrations/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to disconnect.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const connectedProviders = new Set(connected.map((i) => i.provider));

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Integrations</p>
        <h1 className="text-2xl font-semibold text-slate-950">Connect your tools</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Link stores, spreadsheets, calendars, automation and payments. Keys live
          in the Secret Vault.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {connected.length > 0 && (
        <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Connected</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {connected.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800">
                  {i.label}
                  <span className="ml-2 text-xs text-slate-500">{i.provider}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.hasCredential ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {i.hasCredential ? "key linked" : "no key"}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.status === "CONNECTED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{i.status}</span>
                  <button onClick={() => void disconnect(i.id)} className="rounded-md border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-50">Disconnect</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-950">Available</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.map((c) => (
            <article key={c.provider} className="flex flex-col rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-950">{c.name}</h3>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{c.category}</span>
              </div>
              <p className="mt-1 flex-1 text-sm text-slate-500">{c.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-400">{c.authType}</span>
                <button
                  type="button"
                  onClick={() => void connect(c)}
                  disabled={busyProvider === c.provider}
                  className="rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busyProvider === c.provider ? "Connecting..." : connectedProviders.has(c.provider) ? "Add another" : "Connect"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
