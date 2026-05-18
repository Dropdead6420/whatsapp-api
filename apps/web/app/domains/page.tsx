"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type PortalType = "PARTNER" | "CUSTOMER" | "DEMO" | "API" | "TRACKING";
type DomainStatus =
  | "PENDING_DNS"
  | "DNS_FOUND"
  | "TXT_VERIFIED"
  | "SSL_PENDING"
  | "SSL_ACTIVE"
  | "LIVE"
  | "FAILED"
  | "SUSPENDED";

interface TenantSummary {
  id: string;
  name: string;
  type: string;
}

interface DomainRecord {
  type: "CNAME" | "TXT";
  host: string;
  value: string;
  purpose: string;
}

interface ConnectedDomain {
  id: string;
  tenantId: string;
  tenant?: TenantSummary;
  domain: string;
  portalType: PortalType;
  status: DomainStatus;
  dnsStatus: string;
  sslStatus: string;
  isPrimary: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  records: DomainRecord[];
  createdAt: string;
}

const PORTAL_TYPES: Array<{ value: PortalType; label: string; hint: string }> = [
  { value: "PARTNER", label: "Partner portal", hint: "partner.agency.com" },
  { value: "CUSTOMER", label: "Customer portal", hint: "app.agency.com" },
  { value: "DEMO", label: "Demo portal", hint: "demo.agency.com" },
  { value: "API", label: "API domain", hint: "api.agency.com" },
  { value: "TRACKING", label: "Tracking domain", hint: "track.agency.com" },
];

function statusClass(status: DomainStatus) {
  if (status === "LIVE" || status === "SSL_ACTIVE") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "SUSPENDED" || status === "FAILED") {
    return "bg-red-50 text-red-700";
  }
  if (status === "SSL_PENDING" || status === "TXT_VERIFIED") {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-slate-100 text-slate-700";
}

function niceStatus(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

export default function DomainsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN"],
  });
  const [domains, setDomains] = useState<ConnectedDomain[]>([]);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [domain, setDomain] = useState("");
  const [portalType, setPortalType] = useState<PortalType>("CUSTOMER");
  const [isPrimary, setIsPrimary] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const selectedPortal = useMemo(
    () => PORTAL_TYPES.find((item) => item.value === portalType),
    [portalType],
  );

  async function loadDomains() {
    if (!user) return;
    setErr(null);
    try {
      const query = isSuperAdmin && tenantId ? `?tenantId=${tenantId}` : "";
      setDomains(await api.get<ConnectedDomain[]>(`/api/v1/domains${query}`));
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Failed to load domains");
    }
  }

  async function loadTenants() {
    if (!isSuperAdmin) return;
    try {
      const data = await api.get<TenantSummary[]>("/api/v1/tenants?limit=100");
      setTenants(data);
    } catch {
      setTenants([]);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadDomains();
    void loadTenants();
  }, [user, tenantId]);

  async function createDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const created = await api.post<ConnectedDomain>("/api/v1/domains", {
        domain,
        portalType,
        isPrimary,
        ...(isSuperAdmin && tenantId ? { tenantId } : {}),
      });
      setDomains((current) => [created, ...current]);
      setDomain("");
      setIsPrimary(false);
      setNotice("Domain added. Add the DNS records below, then run verification.");
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Domain setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshDomain(id: string) {
    setErr(null);
    setNotice(null);
    try {
      const checked = await api.post<ConnectedDomain>(`/api/v1/domains/${id}/check`);
      setDomains((items) => items.map((item) => (item.id === id ? checked : item)));
      setNotice("DNS verification checked.");
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Verification failed");
    }
  }

  async function patchDomain(id: string, body: Record<string, unknown>) {
    setErr(null);
    setNotice(null);
    try {
      const updated = await api.patch<ConnectedDomain>(`/api/v1/domains/${id}`, body);
      setDomains((items) => items.map((item) => (item.id === id ? updated : item)));
      setNotice("Domain updated.");
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Update failed");
    }
  }

  async function deleteDomain(id: string) {
    if (!window.confirm("Remove this domain from NexaFlow?")) return;
    setErr(null);
    setNotice(null);
    try {
      await api.delete(`/api/v1/domains/${id}`);
      setDomains((items) => items.filter((item) => item.id !== id));
      setNotice("Domain removed.");
    } catch (error) {
      setErr(error instanceof ApiClientError ? error.message : "Delete failed");
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">White-label Domains</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect partner, customer, demo, API, and tracking domains with generated DNS records.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <form
          onSubmit={createDomain}
          className="self-start rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-semibold">Add domain</h2>

          {isSuperAdmin && (
            <label className="mt-4 block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Tenant
              </span>
              <select
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                <option value="">Select tenant</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.type})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Portal type
            </span>
            <select
              value={portalType}
              onChange={(event) => setPortalType(event.target.value as PortalType)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            >
              {PORTAL_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Domain
            </span>
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder={selectedPortal?.hint}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>

          <label className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-slate-700">Make primary</span>
              <span className="text-xs text-slate-500">
                Existing primary domain for the same portal type will be replaced.
              </span>
            </span>
          </label>

          <button
            disabled={busy}
            className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Adding..." : "Generate DNS records"}
          </button>
        </form>

        <section className="space-y-4">
          {domains.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No domains connected yet.
            </div>
          )}

          {domains.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{item.domain}</h2>
                    {item.isPrimary && (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                        Primary
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusClass(item.status)}`}
                    >
                      {niceStatus(item.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {PORTAL_TYPES.find((type) => type.value === item.portalType)?.label}{" "}
                    {item.tenant ? `for ${item.tenant.name}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshDomain(item.id)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                  >
                    Verify DNS
                  </button>
                  {!item.isPrimary && (
                    <button
                      type="button"
                      onClick={() => void patchDomain(item.id, { isPrimary: true })}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                    >
                      Make primary
                    </button>
                  )}
                  {isSuperAdmin && item.status !== "LIVE" && (
                    <button
                      type="button"
                      onClick={() => void patchDomain(item.id, { status: "LIVE" })}
                      className="rounded-md border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      Mark live
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteDomain(item.id)}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Host</th>
                      <th className="px-3 py-2 text-left">Value</th>
                      <th className="px-3 py-2 text-left">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {item.records.map((record) => (
                      <tr key={`${item.id}-${record.type}`}>
                        <td className="px-3 py-2 font-medium">{record.type}</td>
                        <td className="px-3 py-2 font-mono text-xs">{record.host}</td>
                        <td className="px-3 py-2 font-mono text-xs">{record.value}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{record.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="mt-4 grid gap-3 text-xs text-slate-500 md:grid-cols-3">
                <div>
                  <dt className="font-medium uppercase tracking-wide">DNS</dt>
                  <dd className="mt-1 capitalize">{niceStatus(item.dnsStatus)}</dd>
                </div>
                <div>
                  <dt className="font-medium uppercase tracking-wide">SSL</dt>
                  <dd className="mt-1 capitalize">{niceStatus(item.sslStatus)}</dd>
                </div>
                <div>
                  <dt className="font-medium uppercase tracking-wide">Last checked</dt>
                  <dd className="mt-1">
                    {item.lastCheckedAt
                      ? new Date(item.lastCheckedAt).toLocaleString()
                      : "Not checked yet"}
                  </dd>
                </div>
              </dl>

              {item.lastError && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {item.lastError}
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
    </DashboardShell>
  );
}
