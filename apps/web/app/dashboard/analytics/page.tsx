"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  Download,
  FileText,
  Mail,
  PlayCircle,
  RefreshCcw,
  Save,
  Send,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../../../src/hooks/useAuth";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { API_BASE, api, ApiClientError, tokenStore } from "../../../src/lib/api";

interface AnalyticsSummary {
  scope: "platform" | "tenant";
  tenantId?: string;
  totals: Record<string, number>;
  sendQuota?: {
    monthlyUsed: number;
    monthlyQuota: number;
    perSecondLimit: number;
    percentUsed: number;
  };
  planQuotas?: {
    contacts?: { used: number; limit: number };
    campaigns?: { used: number; limit: number };
    agentSeats?: { used: number; limit: number };
    aiCreditsPerMonth?: number;
  } | null;
  leadsByStatus?: Record<string, number>;
  campaignsByStatus?: Record<string, number>;
}

interface ReportSchedule {
  id: string;
  recipientEmail: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: "CSV" | "PDF";
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string | null;
  lastSentAt?: string | null;
  lastStatus: "SENT" | "FAILED" | "NEVER_RUN";
  lastError?: string | null;
}

interface ReportScheduleForm {
  recipientEmail: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: "CSV" | "PDF";
  enabled: boolean;
}

function compact(value: number | undefined) {
  return new Intl.NumberFormat("en-IN", {
    notation: Math.abs(value ?? 0) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function currencyPaisa(value: number | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format((value ?? 0) / 100);
}

function titleize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function fileNameFromDisposition(disposition: string | null, fallbackExt: string) {
  const match = disposition?.match(/filename="?([^"]+)"?/);
  return (
    match?.[1] ??
    `nexaflow-analytics-${new Date().toISOString().slice(0, 10)}.${fallbackExt}`
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AnalyticsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ReportScheduleForm>({
    recipientEmail: "",
    frequency: "WEEKLY",
    format: "PDF",
    enabled: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState<"save" | "run" | null>(null);

  async function loadSummary() {
    setErr(null);
    try {
      const data = await api.get<AnalyticsSummary>("/api/v1/analytics/summary");
      setSummary(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load analytics");
    }
  }

  async function loadSchedule() {
    try {
      const data = await api.get<ReportSchedule | null>(
        "/api/v1/analytics/report-schedule",
      );
      setSchedule(data);
      setScheduleForm({
        recipientEmail: data?.recipientEmail ?? user?.email ?? "",
        frequency: data?.frequency ?? "WEEKLY",
        format: data?.format ?? "PDF",
        enabled: data?.enabled ?? false,
      });
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to load report schedule",
      );
    }
  }

  async function saveSchedule() {
    setErr(null);
    setScheduleBusy("save");
    try {
      const data = await api.put<ReportSchedule>(
        "/api/v1/analytics/report-schedule",
        scheduleForm,
      );
      setSchedule(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to save schedule");
    } finally {
      setScheduleBusy(null);
    }
  }

  async function runScheduleNow() {
    setErr(null);
    setScheduleBusy("run");
    try {
      const data = await api.post<ReportSchedule>(
        "/api/v1/analytics/report-schedule/run-now",
      );
      setSchedule(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to send report");
    } finally {
      setScheduleBusy(null);
    }
  }

  async function downloadExport(kind: "csv" | "pdf") {
    setErr(null);
    setDownloading(kind);
    try {
      const token = tokenStore.getAccess();
      const res = await fetch(`${API_BASE}/api/v1/analytics/export.${kind}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileNameFromDisposition(
        res.headers.get("Content-Disposition"),
        kind,
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${kind.toUpperCase()} export failed`);
    } finally {
      setDownloading(null);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadSummary();
    void loadSchedule();
  }, [user]);

  const cards = useMemo(() => {
    if (!summary) return [];
    if (summary.scope === "platform") {
      return [
        ["Active tenants", compact(summary.totals.activeTenants), "of platform accounts"],
        ["MRR", currencyPaisa(summary.totals.mrrInPaisa), "active subscriptions"],
        ["Messages this month", compact(summary.totals.messagesMonth), "all tenants"],
        ["AI cost this month", currencyPaisa((summary.totals.aiCostInCents ?? 0) * 100), "tracked usage"],
      ];
    }
    return [
      ["Contacts", compact(summary.totals.contacts), "CRM records"],
      ["Messages this month", compact(summary.totals.messagesMonth), "tenant usage"],
      ["Active conversations", compact(summary.totals.activeConversations), "open threads"],
      ["Leads", compact(summary.totals.leads), "pipeline records"],
    ];
  }, [summary]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {summary?.scope === "platform" ? "Platform report" : "Workspace report"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Live performance summary with export-ready reporting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void downloadExport("csv")}
            disabled={Boolean(downloading) || !summary}
            className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloading === "csv" ? "Exporting..." : "Download CSV"}
          </button>
          <button
            type="button"
            onClick={() => void downloadExport("pdf")}
            disabled={Boolean(downloading) || !summary}
            className="inline-flex items-center gap-2 rounded-md border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {downloading === "pdf" ? "Exporting..." : "Download PDF"}
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <MetricCard key={label} label={label} value={value} hint={hint} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <StatusPanel
          title="Campaigns"
          icon={<BarChart3 className="h-4 w-4" />}
          rows={summary?.campaignsByStatus}
        />
        {summary?.scope === "tenant" ? (
          <StatusPanel
            title="Leads"
            icon={<TrendingUp className="h-4 w-4" />}
            rows={summary.leadsByStatus}
          />
        ) : (
          <StatusPanel
            title="Platform Totals"
            icon={<TrendingUp className="h-4 w-4" />}
            rows={{
              tenants: summary?.totals.tenants ?? 0,
              contacts: summary?.totals.contacts ?? 0,
              conversations: summary?.totals.conversations ?? 0,
              campaigns: summary?.totals.campaigns ?? 0,
            }}
          />
        )}
      </section>

      {summary?.sendQuota && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                <Send className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-950">Send quota</h2>
                <p className="text-xs text-slate-500">
                  {compact(summary.sendQuota.monthlyUsed)} of{" "}
                  {compact(summary.sendQuota.monthlyQuota)} monthly sends used
                </p>
              </div>
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {summary.sendQuota.percentUsed}%
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, summary.sendQuota.percentUsed)}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Per-second smoothing limit: {summary.sendQuota.perSecondLimit}/sec.
          </p>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div className="flex gap-3">
            <span className="rounded-md bg-indigo-50 p-2 text-indigo-700">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-950">
                Scheduled report delivery
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Email this analytics report automatically to the right operator.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
              schedule?.enabled
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {schedule?.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_0.8fr_0.8fr_auto]">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Recipient email</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
              <Mail className="h-4 w-4 text-slate-400" />
              <input
                value={scheduleForm.recipientEmail}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    recipientEmail: event.target.value,
                  }))
                }
                placeholder="owner@example.com"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Frequency</span>
            <select
              value={scheduleForm.frequency}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  frequency: event.target.value as ReportScheduleForm["frequency"],
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Format</span>
            <select
              value={scheduleForm.format}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  format: event.target.value as ReportScheduleForm["format"],
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              <option value="PDF">PDF</option>
              <option value="CSV">CSV</option>
            </select>
          </label>

          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={scheduleForm.enabled}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            Auto-send
          </label>
        </div>

        <div className="mt-4 flex flex-col justify-between gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center">
          <div className="grid gap-1 text-xs text-slate-500 md:grid-cols-3 md:gap-6">
            <span>Next run: {formatDateTime(schedule?.nextRunAt)}</span>
            <span>Last sent: {formatDateTime(schedule?.lastSentAt)}</span>
            <span>
              Status:{" "}
              <strong className="font-semibold text-slate-700">
                {schedule?.lastStatus ?? "NEVER_RUN"}
              </strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveSchedule()}
              disabled={Boolean(scheduleBusy)}
              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {scheduleBusy === "save" ? "Saving..." : "Save schedule"}
            </button>
            <button
              type="button"
              onClick={() => void runScheduleNow()}
              disabled={Boolean(scheduleBusy) || !schedule}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <PlayCircle className="h-4 w-4" />
              {scheduleBusy === "run" ? "Sending..." : "Send now"}
            </button>
          </div>
        </div>

        {schedule?.lastError && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Last error: {schedule.lastError}
          </div>
        )}
      </section>

      {summary?.planQuotas && (
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <QuotaCard label="Contacts" quota={summary.planQuotas.contacts} />
          <QuotaCard label="Campaigns" quota={summary.planQuotas.campaigns} />
          <QuotaCard label="Agent seats" quota={summary.planQuotas.agentSeats} />
        </section>
      )}
    </DashboardShell>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function StatusPanel({
  title,
  rows,
  icon,
}: {
  title: string;
  rows?: Record<string, number>;
  icon: ReactNode;
}) {
  const entries = Object.entries(rows ?? {}).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <span className="text-emerald-700">{icon}</span>
        {title}
      </div>
      <div className="mt-4 space-y-3">
        {entries.map(([key, value]) => {
          const width = total ? Math.max(6, Math.round((value / total) * 100)) : 0;
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">{titleize(key)}</span>
                <span className="text-slate-500">{compact(value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            No data yet.
          </div>
        )}
      </div>
    </div>
  );
}

function QuotaCard({
  label,
  quota,
}: {
  label: string;
  quota?: { used: number; limit: number };
}) {
  const percent = quota ? Math.round((quota.used / Math.max(1, quota.limit)) * 100) : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">{label}</h3>
        <span className="text-xs font-medium text-slate-500">{percent}%</span>
      </div>
      <div className="mt-2 text-sm text-slate-600">
        {compact(quota?.used)} / {compact(quota?.limit)}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}
