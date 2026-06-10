"use client";

// AdGrowly — Credit Engine (planning PDF §4). SUPER_ADMIN sets the credit cost
// of each AI/usage action; the app prices actions from active rules. Backed by
// module 13: /api/v1/admin/credit-rules (+ /actions, /cost-map).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Rule {
  id: string;
  action: string;
  label: string;
  description: string | null;
  cost: number;
  isActive: boolean;
}

interface KnownAction {
  action: string;
  label: string;
}

export default function CreditRulesPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [rules, setRules] = useState<Rule[]>([]);
  const [known, setKnown] = useState<KnownAction[]>([]);
  const [costInputs, setCostInputs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [action, setAction] = useState("");
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState("1");
  const [description, setDescription] = useState("");

  async function refresh() {
    try {
      setErr(null);
      const [list, actions] = await Promise.all([
        api.get<Rule[]>("/api/v1/admin/credit-rules"),
        api.get<KnownAction[]>("/api/v1/admin/credit-rules/actions"),
      ]);
      setRules(list);
      setKnown(actions);
      setCostInputs(Object.fromEntries(list.map((r) => [r.id, String(r.cost)])));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load credit rules (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  function pickKnown(a: string) {
    setAction(a);
    const match = known.find((k) => k.action === a);
    if (match && !label.trim()) setLabel(match.label);
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/credit-rules", {
        action: action.trim(),
        label: label.trim(),
        cost: Number(cost),
        description: description.trim() || undefined,
      });
      setAction("");
      setLabel("");
      setCost("1");
      setDescription("");
      setNotice("Credit rule created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create rule.");
    }
  }

  async function saveCost(id: string) {
    try {
      await api.patch(`/api/v1/admin/credit-rules/${id}`, { cost: Number(costInputs[id] || 0) });
      setNotice("Cost updated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update cost.");
    }
  }

  async function toggleActive(r: Rule) {
    try {
      await api.patch(`/api/v1/admin/credit-rules/${r.id}`, { isActive: !r.isActive });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to toggle.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this rule?")) return;
    try {
      await api.delete(`/api/v1/admin/credit-rules/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Super Admin</p>
        <h1 className="text-2xl font-semibold text-slate-950">Credit Engine</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Set the credit cost of each AI/usage action. The app prices every action from these rules — no hardcoded costs.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={create} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New rule</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Action
            <input value={action} onChange={(e) => pickKnown(e.target.value)} list="known-actions" required placeholder="ai.review_reply" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <datalist id="known-actions">
              {known.map((k) => <option key={k.action} value={k.action}>{k.label}</option>)}
            </datalist>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Cost (credits)
            <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Create rule</button>
        </form>

        <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-4 text-slate-500">No rules yet.</td></tr>
              )}
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{r.label}</div>
                    <div className="text-xs text-slate-400">{r.action}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={costInputs[r.id] ?? ""}
                        onChange={(e) => setCostInputs((c) => ({ ...c, [r.id]: e.target.value }))}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                      <button onClick={() => void saveCost(r.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Save</button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => void toggleActive(r)} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${r.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                      {r.isActive ? "active" : "inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => void remove(r.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
