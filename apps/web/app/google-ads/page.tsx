"use client";

// Google Ads dashboard (PRD §3.3.7, Phase 4 slice 1).
//
// Mirror of /meta-ads. Tenant pastes their Google Ads customer id + an
// OAuth refresh token; the server exchanges the refresh token for an
// access token on every call and runs GAQL queries against the
// Marketing API. Slice 2 will wire the full OAuth consent flow.

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Connection {
  customerId: string;
  loginCustomerId: string | null;
  customerName: string | null;
  currency: string | null;
  timeZoneName: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  advertisingChannelType?: string;
  startDate?: string;
  endDate?: string;
  metrics: {
    impressions: number;
    clicks: number;
    ctr: number;
    averageCpcMicros: number;
    costMicros: number;
    conversions: number;
  };
}

const DATE_PRESETS = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "LAST_14_DAYS", label: "Last 14 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
] as const;

type DatePreset = (typeof DATE_PRESETS)[number]["value"];

function formatNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "—";
}

function formatMicros(micros: number, code: string | null): string {
  const value = micros / 1_000_000;
  if (!Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString("en-IN", {
      style: "currency",
      currency: code ?? "USD",
      maximumFractionDigits: 2,
    });
  } catch {
    return `${code ?? ""} ${value.toFixed(2)}`;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "ENABLED":
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-800";
    case "PAUSED":
      return "bg-amber-100 text-amber-800";
    case "REMOVED":
    case "ENDED":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function GoogleAdsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [conn, setConn] = useState<Connection | null>(null);
  const [connBusy, setConnBusy] = useState(false);
  const [connErr, setConnErr] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("LAST_7_DAYS");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignsBusy, setCampaignsBusy] = useState(false);
  const [campaignsErr, setCampaignsErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [refreshToken, setRefreshToken] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loginCustomerId, setLoginCustomerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function loadConnection() {
    setConnBusy(true);
    setConnErr(null);
    try {
      const data = await api.get<Connection | null>(
        "/api/v1/google-ads/connection",
      );
      setConn(data);
    } catch (e) {
      setConnErr(
        e instanceof ApiClientError
          ? `Failed to load connection: ${e.message}`
          : "Failed to load connection.",
      );
    } finally {
      setConnBusy(false);
    }
  }

  async function loadCampaigns(preset: DatePreset = datePreset) {
    if (!conn) return;
    setCampaignsBusy(true);
    setCampaignsErr(null);
    try {
      const result = await api.get<{
        datePreset: DatePreset;
        campaigns: CampaignRow[];
      }>(`/api/v1/google-ads/campaigns?datePreset=${preset}`);
      setCampaigns(result.campaigns);
    } catch (e) {
      setCampaignsErr(
        e instanceof ApiClientError
          ? `Failed to load campaigns: ${e.message}`
          : "Failed to load campaigns.",
      );
    } finally {
      setCampaignsBusy(false);
    }
  }

  useEffect(() => {
    if (user) void loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (conn) void loadCampaigns(datePreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.customerId, datePreset]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.post("/api/v1/google-ads/connection", {
        refreshToken: refreshToken.trim(),
        customerId: customerId.trim(),
        loginCustomerId: loginCustomerId.trim() || undefined,
      });
      setShowForm(false);
      setRefreshToken("");
      setCustomerId("");
      setLoginCustomerId("");
      await loadConnection();
    } catch (e) {
      setSaveErr(
        e instanceof ApiClientError ? e.message : "Failed to save connection.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (
      !window.confirm(
        "Disconnect Google Ads? The refresh token will be removed and campaign data will no longer sync.",
      )
    ) {
      return;
    }
    try {
      await api.delete("/api/v1/google-ads/connection");
      setConn(null);
      setCampaigns([]);
    } catch (e) {
      setConnErr(
        e instanceof ApiClientError ? e.message : "Failed to disconnect.",
      );
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Google Ads
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Read-only view of your Google Ads campaigns. Connect a customer
            account to see live performance metrics from the Google Ads API.
          </p>
        </div>
        {conn && (
          <div className="flex gap-2">
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadCampaigns(datePreset)}
              disabled={campaignsBusy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {campaignsBusy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </header>

      {connErr && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {connErr}
        </div>
      )}

      {!connBusy && !conn && !showForm && (
        <section className="mb-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Connect a Google Ads account
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste a Google OAuth refresh token + your customer ID. The token
            is encrypted at rest and only used to read campaign data.
          </p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Connect customer account
          </button>
        </section>
      )}

      {showForm && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              {conn ? "Replace connection" : "Connect Google Ads"}
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setSaveErr(null);
              }}
              className="text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Get a refresh token by running NexaFlow&apos;s Google OAuth flow
            against your account with the{" "}
            <code className="font-mono">https://www.googleapis.com/auth/adwords</code>{" "}
            scope. Customer ID is the 10-digit number at the top of Google
            Ads (dashes optional).
          </p>
          {saveErr && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveErr}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              OAuth refresh token
              <textarea
                required
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="1//0g..."
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                Customer ID
                <input
                  required
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="123-456-7890"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Manager (MCC) login customer ID
                <input
                  value={loginCustomerId}
                  onChange={(e) => setLoginCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Verifying…" : "Save & verify"}
              </button>
            </div>
          </form>
        </section>
      )}

      {conn && (
        <section className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Connected account
                </div>
                <div className="mt-0.5 text-base font-semibold text-slate-900">
                  {conn.customerName ?? conn.customerId}
                </div>
                <div className="text-xs text-slate-600">
                  <code className="font-mono">{conn.customerId}</code>
                  {conn.loginCustomerId && (
                    <>
                      {" via "}
                      <code className="font-mono">{conn.loginCustomerId}</code>
                    </>
                  )}
                  {conn.currency && ` · ${conn.currency}`}
                  {conn.timeZoneName && ` · ${conn.timeZoneName}`}
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                {conn.lastSyncedAt && (
                  <div>
                    Last sync{" "}
                    {new Date(conn.lastSyncedAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
                {conn.lastSyncError && (
                  <div className="text-red-700">{conn.lastSyncError}</div>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 sm:flex-col">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Disconnect
            </button>
          </div>
        </section>
      )}

      {conn && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          {campaignsErr && (
            <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {campaignsErr}
            </div>
          )}
          {campaignsBusy && campaigns.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Loading campaigns…
            </div>
          )}
          {!campaignsBusy && campaigns.length === 0 && !campaignsErr && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No campaigns found in this customer account for the selected
              date range.
            </div>
          )}
          {campaigns.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Campaign</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Channel</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Impressions
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                    <th className="px-3 py-2 text-right font-semibold">CTR</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg CPC</th>
                    <th className="px-3 py-2 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Conversions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {c.name}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {c.id}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusColor(c.status)}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {c.advertisingChannelType ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.metrics.impressions)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.metrics.clicks)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {(c.metrics.ctr * 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatMicros(c.metrics.averageCpcMicros, conn.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatMicros(c.metrics.costMicros, conn.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.metrics.conversions)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Slice 1 scope:</strong> read-only campaigns + metrics. Future
        slices: AI quality-score insights, smart bidding recommendations,
        call tracking integration, full OAuth consent flow (so customers
        don&apos;t paste refresh tokens).
      </div>
    </DashboardShell>
  );
}
