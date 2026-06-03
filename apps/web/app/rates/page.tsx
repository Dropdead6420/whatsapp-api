"use client";

// SuperAdmin WhatsApp rate-table control (Claude Corrected Billing §3).
// CRUD over the rate rows the billing engine reads to price every
// chargeable send: base + provider cost (in micros), tax/gateway bps,
// per country / category / provider, with effective-dating. Backed by
// /api/v1/admin/rates (GET/POST/PATCH/:id/deactivate).

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type Category = "MARKETING" | "UTILITY" | "AUTHENTICATION" | "SERVICE";
type Provider = "META" | "GUPSHUP" | "DIALOG_360" | "TWILIO" | "HAPTIK";

const CATEGORIES: Category[] = ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"];
const PROVIDERS: Provider[] = ["META", "GUPSHUP", "DIALOG_360", "TWILIO", "HAPTIK"];

interface RateRow {
  id: string;
  countryCode: string;
  category: Category;
  providerKey: Provider;
  currency: string;
  baseCostMicros: string;
  providerCostMicros: string;
  taxBps: number;
  gatewayFeeBps: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
}

const CATEGORY_TONE: Record<Category, string> = {
  MARKETING: "bg-violet-50 text-violet-700",
  UTILITY: "bg-sky-50 text-sky-700",
  AUTHENTICATION: "bg-amber-50 text-amber-800",
  SERVICE: "bg-emerald-50 text-emerald-700",
};

/** micros (string) → human amount in currency units. */
function microsToAmount(micros: string): string {
  const n = Number(micros);
  if (!Number.isFinite(n)) return micros;
  return (n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function bpsToPct(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** amount in currency units → integer micros, or null when blank/invalid. */
function amountToMicros(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000);
}

interface CreateForm {
  countryCode: string;
  category: Category;
  providerKey: Provider;
  currency: string;
  baseCost: string;
  providerCost: string;
  taxBps: string;
  gatewayFeeBps: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
  supersedePrevious: boolean;
}

const EMPTY_FORM: CreateForm = {
  countryCode: "",
  category: "MARKETING",
  providerKey: "META",
  currency: "INR",
  baseCost: "",
  providerCost: "",
  taxBps: "0",
  gatewayFeeBps: "0",
  effectiveFrom: "",
  effectiveTo: "",
  notes: "",
  supersedePrevious: false,
};

export default function RatesPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [rows, setRows] = useState<RateRow[]>([]);
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState<Category | "ALL">("ALL");
  const [provider, setProvider] = useState<Provider | "ALL">("ALL");
  const [activeOnly, setActiveOnly] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (country.trim()) params.set("countryCode", country.trim());
      if (category !== "ALL") params.set("category", category);
      if (provider !== "ALL") params.set("providerKey", provider);
      if (activeOnly) params.set("activeOnly", "true");
      const data = await api.get<RateRow[]>(`/api/v1/admin/rates?${params}`);
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load rates");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, country, category, provider, activeOnly]);

  const update = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submitCreate = async () => {
    setErr(null);
    setNotice(null);
    const baseMicros = amountToMicros(form.baseCost);
    if (baseMicros === null) {
      setErr("Base cost must be a non-negative number.");
      return;
    }
    const providerMicros =
      form.providerCost.trim() === "" ? 0 : amountToMicros(form.providerCost);
    if (providerMicros === null) {
      setErr("Provider cost must be a non-negative number.");
      return;
    }

    const payload: Record<string, unknown> = {
      countryCode: form.countryCode.trim(),
      category: form.category,
      providerKey: form.providerKey,
      currency: form.currency.trim() || "INR",
      baseCostMicros: baseMicros,
      providerCostMicros: providerMicros,
      taxBps: Number(form.taxBps || "0"),
      gatewayFeeBps: Number(form.gatewayFeeBps || "0"),
      supersedePrevious: form.supersedePrevious,
    };
    if (form.effectiveFrom) payload.effectiveFrom = new Date(form.effectiveFrom).toISOString();
    if (form.effectiveTo) payload.effectiveTo = new Date(form.effectiveTo).toISOString();
    if (form.notes.trim()) payload.notes = form.notes.trim();

    setSaving(true);
    try {
      await api.post<RateRow>("/api/v1/admin/rates", payload);
      setNotice("Rate created.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create rate");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id: string) => {
    setErr(null);
    setNotice(null);
    try {
      await api.post<RateRow>(`/api/v1/admin/rates/${id}/deactivate`);
      setNotice("Rate deactivated.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to deactivate rate");
    }
  };

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Platform · Billing
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            WhatsApp rates
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            The rate engine prices every chargeable send from these rows —
            matched by country, message category, and provider, newest
            effective date wins. Amounts are per message in the row&rsquo;s
            currency.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((s) => !s);
            setNotice(null);
            setErr(null);
          }}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? "Close" : "Add rate"}
        </button>
      </div>

      {showForm && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">New rate</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Country code</span>
              <input
                value={form.countryCode}
                onChange={(e) => update("countryCode", e.target.value)}
                placeholder="IN, US, or DEFAULT"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Category</span>
              <select
                value={form.category}
                onChange={(e) => update("category", e.target.value as Category)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Provider</span>
              <select
                value={form.providerKey}
                onChange={(e) => update("providerKey", e.target.value as Provider)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Currency</span>
              <input
                value={form.currency}
                onChange={(e) => update("currency", e.target.value.toUpperCase())}
                placeholder="INR"
                maxLength={3}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Base cost / msg
              </span>
              <input
                value={form.baseCost}
                onChange={(e) => update("baseCost", e.target.value)}
                placeholder="0.88"
                inputMode="decimal"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Provider cost / msg
              </span>
              <input
                value={form.providerCost}
                onChange={(e) => update("providerCost", e.target.value)}
                placeholder="0 (optional)"
                inputMode="decimal"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Tax (bps)</span>
              <input
                value={form.taxBps}
                onChange={(e) => update("taxBps", e.target.value)}
                inputMode="numeric"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Gateway fee (bps)
              </span>
              <input
                value={form.gatewayFeeBps}
                onChange={(e) => update("gatewayFeeBps", e.target.value)}
                inputMode="numeric"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Effective from
              </span>
              <input
                type="datetime-local"
                value={form.effectiveFrom}
                onChange={(e) => update("effectiveFrom", e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Effective to
              </span>
              <input
                type="datetime-local"
                value={form.effectiveTo}
                onChange={(e) => update("effectiveTo", e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-slate-700">Notes</span>
              <input
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="optional"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.supersedePrevious}
                onChange={(e) => update("supersedePrevious", e.target.checked)}
              />
              Supersede any overlapping active rate
            </label>
            <button
              onClick={() => void submitCreate()}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create rate"}
            </button>
          </div>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Country (IN, DEFAULT)"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "ALL")}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="ALL">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider | "ALL")}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="ALL">All providers</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Active only
        </label>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {rows.length} rows · {activeCount} active
        </span>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Base / msg</th>
              <th className="px-4 py-3">Provider cost</th>
              <th className="px-4 py-3">Tax · Gateway</th>
              <th className="px-4 py-3">Effective</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3 font-medium text-slate-900">{r.countryCode}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CATEGORY_TONE[r.category]}`}
                  >
                    {r.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700">{r.providerKey}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">
                  {microsToAmount(r.baseCostMicros)} {r.currency}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {microsToAmount(r.providerCostMicros)} {r.currency}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {bpsToPct(r.taxBps)} · {bpsToPct(r.gatewayFeeBps)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(r.effectiveFrom).toLocaleDateString()}
                  {" → "}
                  {r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString() : "open"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      r.isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {r.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {r.isActive && (
                    <button
                      onClick={() => void deactivate(r.id)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  {busy ? "Loading…" : "No rates match these filters. Add one above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </DashboardShell>
  );
}
