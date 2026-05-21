"use client";

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError, API_BASE, tokenStore } from "../../src/lib/api";

type ReportType =
  | "CAMPAIGN_PERFORMANCE"
  | "LEAD_FUNNEL"
  | "CONTACT_GROWTH"
  | "AI_USAGE";

type ReportFrequency = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

interface AnalyticsReport {
  id: string;
  name: string;
  type: ReportType;
  frequency: ReportFrequency;
  recipients: string[];
  filters: { rangeDays: number };
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveryError: string | null;
  createdAt: string;
}

interface ReportSnapshot {
  generatedAt: string;
  type: ReportType;
  range: { from: string; to: string; rangeDays: number };
  summary: Record<string, string | number | boolean | null>;
  rows: Array<Record<string, string | number | boolean | null>>;
}

const REPORT_TYPES: Array<{ value: ReportType; label: string }> = [
  { value: "CAMPAIGN_PERFORMANCE", label: "Campaign performance" },
  { value: "LEAD_FUNNEL", label: "Lead funnel" },
  { value: "CONTACT_GROWTH", label: "Contact growth" },
  { value: "AI_USAGE", label: "AI usage" },
];

const FREQUENCIES: Array<{ value: ReportFrequency; label: string }> = [
  { value: "NONE", label: "Manual" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString();
}

function typeLabel(type: ReportType): string {
  return REPORT_TYPES.find((item) => item.value === type)?.label ?? type;
}

export default function ReportsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [reports, setReports] = useState<AnalyticsReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("Monthly growth report");
  const [type, setType] = useState<ReportType>("CAMPAIGN_PERFORMANCE");
  const [frequency, setFrequency] = useState<ReportFrequency>("WEEKLY");
  const [rangeDays, setRangeDays] = useState(30);
  const [recipients, setRecipients] = useState("");

  async function refresh() {
    try {
      setErr(null);
      const data = await api.get<AnalyticsReport[]>("/api/v1/analytics/reports");
      setReports(data);
      setSelectedId((current) => current ?? data[0]?.id ?? null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load reports.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function createReport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    try {
      const created = await api.post<AnalyticsReport>("/api/v1/analytics/reports", {
        name,
        type,
        frequency,
        rangeDays,
        recipients: recipients
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setReports((items) => [created, ...items]);
      setSelectedId(created.id);
      setSnapshot(null);
      setName("Monthly growth report");
      setRecipients("");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create report.");
    }
  }

  async function runReport(report: AnalyticsReport, deliver: boolean) {
    setBusyId(report.id);
    setErr(null);
    try {
      const data = await api.post<ReportSnapshot>(
        `/api/v1/analytics/reports/${report.id}/run`,
        { deliver },
      );
      setSnapshot(data);
      setSelectedId(report.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to run report.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteReport(report: AnalyticsReport) {
    if (!confirm(`Delete ${report.name}?`)) return;
    setErr(null);
    try {
      await api.delete(`/api/v1/analytics/reports/${report.id}`);
      setReports((items) => items.filter((item) => item.id !== report.id));
      if (selectedId === report.id) {
        setSelectedId(null);
        setSnapshot(null);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete report.");
    }
  }

  async function downloadCsv(report: AnalyticsReport) {
    const token = tokenStore.getAccess();
    if (!token) return;
    const res = await fetch(
      `${API_BASE}/api/v1/analytics/reports/${report.id}/export.csv`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      setErr(`Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Analytics</p>
          <h1 className="text-2xl font-semibold text-slate-950">Reports</h1>
          <p className="text-sm text-slate-500">
            Save recurring analytics views and export CSV snapshots.
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {reports.length} saved {reports.length === 1 ? "report" : "reports"}
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        <form
          onSubmit={createReport}
          className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="text-base font-semibold text-slate-950">Create report</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={120}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Report type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            >
              {REPORT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Range
              <input
                type="number"
                min={1}
                max={365}
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Frequency
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                {FREQUENCIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Recipients
            <input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="owner@example.com, manager@example.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>
          <button
            type="submit"
            className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Save report
          </button>
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {reports.length === 0 ? (
            <div className="p-8 text-center">
              <h2 className="text-base font-semibold text-slate-950">
                No reports yet
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Create your first report to run and export analytics.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((report) => (
                <article
                  key={report.id}
                  className={`p-4 ${
                    selected?.id === report.id ? "bg-emerald-50/50" : "bg-white"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(report.id);
                        setSnapshot(null);
                      }}
                      className="text-left"
                    >
                      <h3 className="font-semibold text-slate-950">{report.name}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {typeLabel(report.type)} · {report.filters.rangeDays} days ·{" "}
                        {report.frequency.toLowerCase()}
                      </p>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => runReport(report, false)}
                        disabled={busyId === report.id}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                      >
                        {busyId === report.id ? "Running..." : "Run"}
                      </button>
                      <button
                        onClick={() => downloadCsv(report)}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => runReport(report, true)}
                        disabled={busyId === report.id || report.recipients.length === 0}
                        className="rounded-md border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-white disabled:opacity-50"
                      >
                        Email
                      </button>
                      <button
                        onClick={() => deleteReport(report)}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                    <div>
                      <dt className="font-semibold text-slate-500">Last run</dt>
                      <dd>{formatDate(report.lastRunAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Next run</dt>
                      <dd>{formatDate(report.nextRunAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Delivery</dt>
                      <dd>
                        {report.lastDeliveryStatus ?? "Not sent"}
                        {report.lastDeliveryError ? ` · ${report.lastDeliveryError}` : ""}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Latest run</h2>
          <p className="text-xs text-slate-500">
            {snapshot
              ? `${typeLabel(snapshot.type)} · generated ${formatDate(snapshot.generatedAt)}`
              : "Run a report to preview its summary."}
          </p>
        </div>
        {!snapshot ? (
          <div className="p-6 text-sm text-slate-500">No snapshot selected.</div>
        ) : (
          <div className="p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {Object.entries(snapshot.summary).map(([key, value]) => (
                <div key={key} className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {key}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {String(value)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {Object.keys(snapshot.rows[0] ?? {}).map((key) => (
                      <th key={key} className="px-3 py-2 font-semibold">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshot.rows.slice(0, 20).map((row, idx) => (
                    <tr key={`${snapshot.generatedAt}-${idx}`}>
                      {Object.keys(snapshot.rows[0] ?? {}).map((key) => (
                        <td key={key} className="px-3 py-2 text-slate-700">
                          {String(row[key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
