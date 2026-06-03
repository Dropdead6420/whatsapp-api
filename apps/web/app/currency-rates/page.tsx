"use client";

// SuperAdmin FX / currency-rate control (Claude Corrected Billing §3).
// Platform exchange rates the billing engine uses to convert a send
// priced in the rate row's currency into the customer's wallet currency:
// 1 base = rate quote. Backed by /api/v1/admin/currency-rates
// (GET/POST/PATCH/:id/deactivate).

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface CurrencyRateRow {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: string;
  source: string | null;
  notes: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

/** micros (string) → human rate (1 base = N quote). */
function microsToRate(micros: string): string {
  const n = Number(micros);
  if (!Number.isFinite(n)) return micros;
  return (n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** human rate → integer micros, or null when blank/invalid/non-positive. */
function rateToMicros(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1_000_000);
}

interface CreateForm {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
  supersedePrevious: boolean;
}

const EMPTY_FORM: CreateForm = {
  baseCurrency: "",
  quoteCurrency: "",
  rate: "",
  source: "manual",
  effectiveFrom: "",
  effectiveTo: "",
  notes: "",
  supersedePrevious: false,
};

export default function CurrencyRatesPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [rows, setRows] = useState<CurrencyRateRow[]>([]);
  const [base, setBase] = useState("");
  const [quote, setQuote] = useState("");
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
      if (base.trim()) params.set("baseCurrency", base.trim());
      if (quote.trim()) params.set("quoteCurrency", quote.trim());
      if (activeOnly) params.set("activeOnly", "true");
      const data = await api.get<CurrencyRateRow[]>(
        `/api/v1/admin/currency-rates?${params}`,
      );
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load currency rates");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, base, quote, activeOnly]);

  const update = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submitCreate = async () => {
    setErr(null);
    setNotice(null);
    const rateMicros = rateToMicros(form.rate);
    if (rateMicros === null) {
      setErr("Rate must be a positive number.");
      return;
    }
    const payload: Record<string, unknown> = {
      baseCurrency: form.baseCurrency.trim(),
      quoteCurrency: form.quoteCurrency.trim(),
      rateMicros,
      supersedePrevious: form.supersedePrevious,
    };
    if (form.source.trim()) payload.source = form.source.trim();
    if (form.effectiveFrom) payload.effectiveFrom = new Date(form.effectiveFrom).toISOString();
    if (form.effectiveTo) payload.effectiveTo = new Date(form.effectiveTo).toISOString();
    if (form.notes.trim()) payload.notes = form.notes.trim();

    setSaving(true);
    try {
      await api.post<CurrencyRateRow>("/api/v1/admin/currency-rates", payload);
      setNotice("Currency rate created.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create currency rate");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id: string) => {
    setErr(null);
    setNotice(null);
    try {
      await api.post<CurrencyRateRow>(`/api/v1/admin/currency-rates/${id}/deactivate`);
      setNotice("Currency rate deactivated.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to deactivate currency rate");
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
            Currency rates
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Platform FX rates used to convert a charge priced in one currency
            into the customer&rsquo;s wallet currency. A rate reads
            &ldquo;1 base = N quote&rdquo;; the newest active rate for a pair
            wins, with effective-dating.
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
          <h2 className="mb-4 text-sm font-semibold text-slate-900">New currency rate</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Base currency</span>
              <input
                value={form.baseCurrency}
                onChange={(e) => update("baseCurrency", e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={3}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Quote currency</span>
              <input
                value={form.quoteCurrency}
                onChange={(e) => update("quoteCurrency", e.target.value.toUpperCase())}
                placeholder="INR"
                maxLength={3}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Rate (1 base = ? quote)
              </span>
              <input
                value={form.rate}
                onChange={(e) => update("rate", e.target.value)}
                placeholder="83.25"
                inputMode="decimal"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Source</span>
              <input
                value={form.source}
                onChange={(e) => update("source", e.target.value)}
                placeholder="manual"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Effective from</span>
              <input
                type="datetime-local"
                value={form.effectiveFrom}
                onChange={(e) => update("effectiveFrom", e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Effective to</span>
              <input
                type="datetime-local"
                value={form.effectiveTo}
                onChange={(e) => update("effectiveTo", e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
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
          value={base}
          onChange={(e) => setBase(e.target.value.toUpperCase())}
          placeholder="Base (USD)"
          maxLength={3}
          className="w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
        <input
          value={quote}
          onChange={(e) => setQuote(e.target.value.toUpperCase())}
          placeholder="Quote (INR)"
          maxLength={3}
          className="w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
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
              <th className="px-4 py-3">Pair</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Effective</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {r.baseCurrency} → {r.quoteCurrency}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-900">
                  1 {r.baseCurrency} = {microsToRate(r.rateMicros)} {r.quoteCurrency}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.source ?? "—"}</td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {busy ? "Loading…" : "No currency rates yet. Add one above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </DashboardShell>
  );
}
