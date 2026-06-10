"use client";

// AdGrowly — Managed Services (planning: agency service packages). SUPER_ADMIN
// curates the package catalog and runs customer engagements through their
// status lifecycle. Backed by module 9: /api/v1/admin/managed-services.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const INTERVALS = ["ONE_TIME", "MONTHLY", "YEARLY"] as const;

// Allowed status transitions (mirrors managedService.service canTransition).
const NEXT: Record<string, string[]> = {
  REQUESTED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

interface Pkg {
  id: string;
  key: string;
  name: string;
  priceCents: number | null;
  currency: string;
  interval: string;
  deliverables: string[];
  isActive: boolean;
}

interface Engagement {
  id: string;
  tenantId: string;
  packageId: string;
  status: string;
  priceCentsSnapshot: number | null;
  currency: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: "bg-amber-50 text-amber-700 border-amber-200",
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PAUSED: "bg-sky-50 text-sky-700 border-sky-200",
  COMPLETED: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const money = (cents: number | null, currency: string | null) =>
  cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency ?? "USD"}`;

export default function ManagedServicesPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [interval, setInterval] = useState<string>("MONTHLY");
  const [deliverables, setDeliverables] = useState("");

  const [engTenantId, setEngTenantId] = useState("");
  const [engPackageId, setEngPackageId] = useState("");

  async function refresh() {
    try {
      setErr(null);
      const [pkgs, engs] = await Promise.all([
        api.get<Pkg[]>("/api/v1/admin/managed-services/packages"),
        api.get<Engagement[]>("/api/v1/admin/managed-services/engagements"),
      ]);
      setPackages(pkgs);
      setEngagements(engs);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function createPackage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/managed-services/packages", {
        key: key.trim(),
        name: name.trim(),
        priceCents: price ? Math.round(Number(price) * 100) : undefined,
        interval,
        deliverables: deliverables.split(",").map((d) => d.trim()).filter(Boolean),
      });
      setKey("");
      setName("");
      setPrice("");
      setDeliverables("");
      setNotice("Package created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create package.");
    }
  }

  async function togglePackage(p: Pkg) {
    try {
      await api.patch(`/api/v1/admin/managed-services/packages/${p.id}`, { isActive: !p.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to toggle.");
    }
  }

  async function createEngagement(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/managed-services/engagements", {
        tenantId: engTenantId.trim(),
        packageId: engPackageId.trim(),
      });
      setEngTenantId("");
      setEngPackageId("");
      setNotice("Engagement created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create engagement.");
    }
  }

  async function moveEngagement(id: string, status: string) {
    try {
      await api.patch(`/api/v1/admin/managed-services/engagements/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update engagement.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Super Admin</p>
        <h1 className="text-2xl font-semibold text-slate-950">Managed Services</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Curate done-for-you service packages and run customer engagements through their lifecycle.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Packages */}
        <div>
          <h2 className="mb-2 text-base font-semibold text-slate-950">Service packages</h2>
          <form onSubmit={createPackage} className="mb-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-3">
              <input value={key} onChange={(e) => setKey(e.target.value)} required placeholder="key (gmb-management)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <select value={interval} onChange={(e) => setInterval(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <input value={deliverables} onChange={(e) => setDeliverables(e.target.value)} placeholder="Deliverables, comma-separated" className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Create package</button>
          </form>
          <div className="space-y-2">
            {packages.length === 0 && <p className="text-sm text-slate-500">No packages.</p>}
            {packages.map((p) => (
              <div key={p.id} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800">{p.name}</span>
                  <button onClick={() => void togglePackage(p)} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${p.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    {p.isActive ? "active" : "inactive"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">{p.key} · {money(p.priceCents, p.currency)} / {p.interval}</p>
                {p.deliverables.length > 0 && <p className="mt-1 text-xs text-slate-500">{p.deliverables.join(" · ")}</p>}
                <code className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{p.id}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Engagements */}
        <div>
          <h2 className="mb-2 text-base font-semibold text-slate-950">Engagements</h2>
          <form onSubmit={createEngagement} className="mb-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <input value={engTenantId} onChange={(e) => setEngTenantId(e.target.value)} required placeholder="Customer (tenant) ID" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={engPackageId} onChange={(e) => setEngPackageId(e.target.value)} required placeholder="Package ID" className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Create engagement</button>
          </form>
          <div className="space-y-2">
            {engagements.length === 0 && <p className="text-sm text-slate-500">No engagements.</p>}
            {engagements.map((en) => (
              <div key={en.id} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">tenant {en.tenantId.slice(0, 10)}… · {money(en.priceCentsSnapshot, en.currency)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[en.status]}`}>{en.status}</span>
                </div>
                {NEXT[en.status]?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {NEXT[en.status].map((s) => (
                      <button key={s} onClick={() => void moveEngagement(en.id, s)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">→ {s}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
