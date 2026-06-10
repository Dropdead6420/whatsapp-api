"use client";

// AdGrowly — Business Profile / Locations (planning PDF §3 Connect GMB). The
// anchor entity: create and manage locations; their IDs feed every other GMB
// page. Backed by module 1: /api/v1/gmb/locations.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Location {
  id: string;
  name: string;
  placeId: string | null;
  phone: string | null;
  primaryCategory: string | null;
  address: { line: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null };
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
  rating: number | null;
  reviewCount: number;
  hasCredential: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  CONNECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  SUSPENDED: "bg-red-50 text-red-700 border-red-200",
};

export default function GmbLocationsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Location[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [phone, setPhone] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<Location[]>("/api/v1/gmb/locations"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load locations.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/locations", {
        name: name.trim(),
        placeId: placeId.trim() || undefined,
        phone: phone.trim() || undefined,
        primaryCategory: primaryCategory.trim() || undefined,
        addressLine: addressLine.trim() || undefined,
        city: city.trim() || undefined,
      });
      setName("");
      setPlaceId("");
      setPhone("");
      setPrimaryCategory("");
      setAddressLine("");
      setCity("");
      setNotice("Location created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create location.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this location?")) return;
    try {
      await api.delete(`/api/v1/gmb/locations/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  function copyId(id: string) {
    void navigator.clipboard?.writeText(id);
    setNotice("Location ID copied.");
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Business locations</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Manage your business locations. A location ID is used across reviews, ranking, citations, insights and reports.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={create} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Add location</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Place ID (connects it)
            <input value={placeId} onChange={(e) => setPlaceId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Category
            <input value={primaryCategory} onChange={(e) => setPrimaryCategory(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Address line
            <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Add location</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No locations yet.</p>}
          {items.map((l) => (
            <div key={l.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-800">{l.name}</span>
                  {l.primaryCategory && <span className="ml-2 text-xs text-slate-400">{l.primaryCategory}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[l.status]}`}>{l.status}</span>
                  <button onClick={() => void remove(l.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {[l.address.line, l.address.city, l.address.region].filter(Boolean).join(", ") || "No address"}
                {l.rating != null && ` · ${l.rating}★ (${l.reviewCount})`}
                {l.hasCredential ? " · credential set" : ""}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{l.id}</code>
                <button onClick={() => copyId(l.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Copy ID</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
