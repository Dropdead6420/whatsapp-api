"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface CustomerTenant {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  _count: { users: number; contacts: number; campaigns: number };
}

export default function PartnerCustomersPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [customers, setCustomers] = useState<CustomerTenant[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    adminEmail: "",
    adminName: "",
    adminPassword: "",
  });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const res = await api.get<CustomerTenant[]>("/api/v1/partner/customers");
      setCustomers(res);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/v1/partner/customers", form);
      setShowForm(false);
      setForm({ name: "", adminEmail: "", adminName: "", adminPassword: "" });
      await refresh();
    } catch (ex) {
      setErr(ex instanceof ApiClientError ? ex.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-slate-500">Business accounts under your agency.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add customer
        </button>
      </div>

      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

      {showForm && (
        <form
          onSubmit={createCustomer}
          className="mb-6 rounded-lg border border-slate-200 bg-white p-4 space-y-3"
        >
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Business name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Admin name"
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            required
          />
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            type="email"
            placeholder="Admin email"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            required
          />
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            type="password"
            placeholder="Temporary password"
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            required
            minLength={8}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Campaigns</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3">{c.status}</td>
                <td className="px-4 py-3">{c._count.contacts}</td>
                <td className="px-4 py-3">{c._count.campaigns}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
