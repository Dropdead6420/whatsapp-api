"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useAutoSave } from "../../src/hooks/useAutoSave";

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInPaisa: number;
  isActive: boolean;
  createdAt: string;
}

function formatPrice(paisa: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

export default function ServicesPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const userScope = `${user?.tenantId ?? "anon"}:${user?.id ?? "anon"}`;
  const [items, setItems] = useState<Service[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm, formStatus, clearForm] = useAutoSave<{
    name: string;
    description: string;
    durationMinutes: number;
    priceInPaisa: number;
  }>(
    `services-form:${userScope}`,
    { name: "", description: "", durationMinutes: 30, priceInPaisa: 50000 },
    {
      isEmpty: (v) => {
        const f = v as { name: string; description: string } | null;
        return !f || (!f.name?.trim() && !f.description?.trim());
      },
    },
  );
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const data = await api.get<Service[]>("/api/v1/services");
      setItems(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post("/api/v1/services", {
        name: form.name,
        description: form.description || undefined,
        durationMinutes: form.durationMinutes,
        priceInPaisa: form.priceInPaisa,
      });
      setShowForm(false);
      clearForm();
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(s: Service) {
    try {
      await api.patch(`/api/v1/services/${s.id}`, { isActive: !s.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this service?")) return;
    try {
      await api.delete(`/api/v1/services/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed");
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  const bookingUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/book/${user.tenantId}`
      : "";

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-slate-500">
            Services your customers can book online. Shared on your public booking page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showForm && formStatus !== "idle" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                formStatus === "saving"
                  ? "bg-slate-100 text-slate-600"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              <span
                className={
                  formStatus === "saving"
                    ? "h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                    : "h-1.5 w-1.5 rounded-full bg-emerald-500"
                }
              />
              {formStatus === "saving" ? "Saving…" : "Saved"}
            </span>
          )}
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showForm ? "Cancel" : "+ New service"}
          </button>
        </div>
      </header>

      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="font-medium text-emerald-900">📅 Your public booking link</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 rounded bg-white px-2 py-1 text-xs">
            {bookingUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(bookingUrl)}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs hover:bg-emerald-100"
          >
            Copy
          </button>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs hover:bg-emerald-100"
          >
            Open ↗
          </a>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">Service name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Haircut + Beard Trim"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Description (optional)
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Includes wash, cut, style, and beard shaping"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Duration (minutes)
            </label>
            <input
              type="number"
              min={5}
              max={1440}
              required
              value={form.durationMinutes}
              onChange={(e) =>
                setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Price (₹)
            </label>
            <input
              type="number"
              min={0}
              required
              value={form.priceInPaisa / 100}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  priceInPaisa: Math.round(Number(e.target.value) * 100),
                }))
              }
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save service"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((s) => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3">
                  <div className="font-medium">{s.name}</div>
                  {s.description && (
                    <div className="text-xs text-slate-500">{s.description}</div>
                  )}
                </td>
                <td className="px-4 py-3">{s.durationMinutes} min</td>
                <td className="px-4 py-3 font-medium">{formatPrice(s.priceInPaisa)}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(s)}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      s.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {s.isActive ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => remove(s.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && !err && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  No services yet. Add one to start accepting bookings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
