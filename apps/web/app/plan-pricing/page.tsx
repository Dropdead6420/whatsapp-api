"use client";

// AdGrowly — SuperAdmin "Manage Defaults": default subscription pricing matrix.
// Per scope (Partners vs Self): plans x {monthly, quarterly, yearly} + per
// add-location prices. Prices edited in rupees, stored as paise.
// Backed by GET/PUT /api/v1/admin/plan-pricing.

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type Scope = "PARTNER" | "SELF";

interface PricingRowApi {
  planName: string;
  sortOrder: number;
  monthlyPaisa: number;
  quarterlyPaisa: number;
  yearlyPaisa: number;
  addLocationMonthlyPaisa: number;
  addLocationQuarterlyPaisa: number;
  addLocationYearlyPaisa: number;
}

// Editable row in rupees (strings for inputs).
interface Row {
  planName: string;
  monthly: string;
  quarterly: string;
  yearly: string;
  addMonthly: string;
  addQuarterly: string;
  addYearly: string;
}

const rupees = (paise: number) => (paise ? String(Math.round(paise / 100)) : "");
const toPaise = (rupeesStr: string) => Math.max(0, Math.round(Number(rupeesStr || 0) * 100)) || 0;

const FIELDS: { key: keyof Row; label: string }[] = [
  { key: "monthly", label: "Monthly" },
  { key: "addMonthly", label: "Add Loc (mo)" },
  { key: "quarterly", label: "Quarterly" },
  { key: "addQuarterly", label: "Add Loc (qtr)" },
  { key: "yearly", label: "Yearly" },
  { key: "addYearly", label: "Add Loc (yr)" },
];

export default function PlanPricingPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [scope, setScope] = useState<Scope>("PARTNER");
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (s: Scope) => {
    try {
      setErr(null);
      setNotice(null);
      const data = await api.get<PricingRowApi[]>(`/api/v1/admin/plan-pricing?scope=${s}`);
      setRows(
        data.map((r) => ({
          planName: r.planName,
          monthly: rupees(r.monthlyPaisa),
          quarterly: rupees(r.quarterlyPaisa),
          yearly: rupees(r.yearlyPaisa),
          addMonthly: rupees(r.addLocationMonthlyPaisa),
          addQuarterly: rupees(r.addLocationQuarterlyPaisa),
          addYearly: rupees(r.addLocationYearlyPaisa),
        })),
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load pricing (Super Admin only).");
    }
  }, []);

  useEffect(() => {
    if (user) void load(scope);
  }, [user, scope, load]);

  function setCell(i: number, key: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const plans = rows
        .filter((r) => r.planName.trim())
        .map((r, i) => ({
          planName: r.planName.trim(),
          sortOrder: i,
          monthlyPaisa: toPaise(r.monthly),
          quarterlyPaisa: toPaise(r.quarterly),
          yearlyPaisa: toPaise(r.yearly),
          addLocationMonthlyPaisa: toPaise(r.addMonthly),
          addLocationQuarterlyPaisa: toPaise(r.addQuarterly),
          addLocationYearlyPaisa: toPaise(r.addYearly),
        }));
      await api.put("/api/v1/admin/plan-pricing", { scope, plans });
      setNotice("Pricing updated.");
      await load(scope);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update pricing.");
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
        <h1 className="text-2xl font-semibold text-slate-950">Manage Defaults — Pricing</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Default subscription pricing (₹/month) per plan and billing cycle, with optional per-add-location pricing.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4 inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm">
        {(["PARTNER", "SELF"] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded px-4 py-1.5 text-sm font-medium ${scope === s ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {s === "PARTNER" ? "Partners" : "Self"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Plan name</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-3 text-right">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <input
                    value={r.planName}
                    onChange={(e) => setCell(i, "planName", e.target.value)}
                    placeholder="Plan name"
                    className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </td>
                {FIELDS.map((f) => (
                  <td key={f.key} className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={r[f.key]}
                      onChange={(e) => setCell(i, f.key, e.target.value)}
                      placeholder="0"
                      className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={FIELDS.length + 1} className="px-4 py-8 text-center text-sm text-slate-500">
                  No plans yet — add one to set default pricing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setRows((prev) => [...prev, { planName: "", monthly: "", quarterly: "", yearly: "", addMonthly: "", addQuarterly: "", addYearly: "" }])}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Add plan
        </button>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Update Pricing"}
        </button>
      </div>
    </DashboardShell>
  );
}
