"use client";

// AdGrowly — SuperAdmin Partners overview ("Partners Wallet Management").
// Read-only table: wallet balance + org counts per partner. Backed by
// GET /api/v1/admin/partner-overview.

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface PartnerRow {
  id: string;
  name: string;
  type: string;
  walletBalance: number;
  totalOrgs: number;
  gmbOrgs: number;
}

const TYPE_LABELS: Record<string, string> = {
  RESELLER: "Reseller (A)",
  BRING_YOUR_OWN_META: "Own Meta/BSP (B)",
  HYBRID: "Hybrid (C)",
};

export default function PartnerOverviewPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creditTarget, setCreditTarget] = useState<PartnerRow | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        setErr(null);
        setRows(await api.get<PartnerRow[]>("/api/v1/admin/partner-overview"));
      } catch (e) {
        setErr(e instanceof ApiClientError ? e.message : "Unable to load partners (Super Admin only).");
      }
    })();
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const totals = useMemo(
    () => ({
      partners: rows.length,
      orgs: rows.reduce((s, r) => s + r.totalOrgs, 0),
      gmbOrgs: rows.reduce((s, r) => s + r.gmbOrgs, 0),
      balance: rows.reduce((s, r) => s + r.walletBalance, 0),
    }),
    [rows],
  );

  async function submitCredit() {
    if (!creditTarget) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) {
      setErr("Enter a positive whole number of credits.");
      return;
    }
    if (!reason.trim()) {
      setErr("Enter a reason for the adjustment.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ balanceCredits: number }>(
        `/api/v1/admin/partner-overview/${creditTarget.id}/credit`,
        { amountCredits: n, reason: reason.trim() },
      );
      setRows((prev) => prev.map((row) => (row.id === creditTarget.id ? { ...row, walletBalance: r.balanceCredits } : row)));
      setNotice(`Added ${n.toLocaleString()} credits to ${creditTarget.name}.`);
      setCreditTarget(null);
      setAmount("");
      setReason("");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to add credits.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Super Admin</p>
        <h1 className="text-2xl font-semibold text-slate-950">Partners Wallet Management</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Wallet balance and org footprint for every partner. Top-ups are handled from the partner&apos;s wallet.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Partners", value: totals.partners },
          { label: "Total orgs", value: totals.orgs },
          { label: "GMB orgs", value: totals.gmbOrgs },
          { label: "Wallet credits", value: totals.balance.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partners..."
            className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No partners found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Partner name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Wallet balance</th>
                <th className="px-4 py-3 text-right">Total orgs</th>
                <th className="px-4 py-3 text-right">GMB orgs</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{r.walletBalance.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.totalOrgs}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.gmbOrgs}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setCreditTarget(r); setAmount(""); setReason(""); setErr(null); }}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Add credits
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-950">Add credits</h2>
            <p className="mt-1 text-sm text-slate-500">
              Top up <span className="font-medium text-slate-700">{creditTarget.name}</span> (partner wallet, current{" "}
              {creditTarget.walletBalance.toLocaleString()} credits).
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Credits to add
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Reason
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. goodwill credit, manual top-up"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCreditTarget(null)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitCredit()}
                disabled={busy}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Adding..." : "Add credits"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
