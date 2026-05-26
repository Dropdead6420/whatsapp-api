"use client";

// Meta Marketing API dashboard (PRD §3.3.6, Phase 4 slice 1).
//
// Lets operators connect a Facebook/Instagram ad account by pasting a
// long-lived user access token + ad account id, then reads campaigns +
// per-campaign insights from Meta's Graph API.
//
// Slice 1 is read-only. Future slices add ad creation, Lead Ads sync,
// and audience export. The token is encrypted server-side.

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Connection {
  adAccountId: string;
  adAccountName: string | null;
  businessName: string | null;
  currency: string | null;
  timeZoneName: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface CampaignInsights {
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  spend?: string;
  reach?: string;
  frequency?: string;
  unique_clicks?: string;
  date_start?: string;
  date_stop?: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time?: string;
  updated_time?: string;
  insights: CampaignInsights | null;
}

const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_28d", label: "Last 28 days" },
  { value: "this_month", label: "This month" },
] as const;

type DatePreset = (typeof DATE_PRESETS)[number]["value"];

function formatNumber(s: string | undefined): string {
  if (!s) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}

function formatCurrency(s: string | undefined, code: string | null): string {
  if (!s) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  // Marketing API returns spend as a decimal string (e.g. "12.34") in
  // account currency, not micros. We render with the account ISO code
  // when available; locale picks the symbol.
  try {
    return n.toLocaleString("en-IN", {
      style: "currency",
      currency: code ?? "USD",
      maximumFractionDigits: 2,
    });
  } catch {
    return `${code ?? ""} ${n.toFixed(2)}`;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-800";
    case "PAUSED":
      return "bg-amber-100 text-amber-800";
    case "DELETED":
    case "ARCHIVED":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function MetaAdsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });

  const [conn, setConn] = useState<Connection | null>(null);
  const [connBusy, setConnBusy] = useState(false);
  const [connErr, setConnErr] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsBusy, setCampaignsBusy] = useState(false);
  const [campaignsErr, setCampaignsErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function loadConnection() {
    setConnBusy(true);
    setConnErr(null);
    try {
      const data = await api.get<Connection | null>(
        "/api/v1/meta-ads/connection",
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
        campaigns: Campaign[];
      }>(`/api/v1/meta-ads/campaigns?datePreset=${preset}`);
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
  }, [conn?.adAccountId, datePreset]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.post("/api/v1/meta-ads/connection", {
        accessToken: accessToken.trim(),
        adAccountId: adAccountId.trim(),
      });
      setShowForm(false);
      setAccessToken("");
      setAdAccountId("");
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
        "Disconnect Meta Ads? The access token will be removed and campaign data will no longer sync.",
      )
    ) {
      return;
    }
    try {
      await api.delete("/api/v1/meta-ads/connection");
      setConn(null);
      setCampaigns([]);
    } catch (e) {
      setConnErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to disconnect.",
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
            Meta Ads
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Read-only view of your Facebook + Instagram ad campaigns. Connect
            an ad account to see live performance metrics from Meta&apos;s
            Marketing API.
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

      {/* Connection card */}
      {!connBusy && !conn && !showForm && (
        <section className="mb-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Connect a Meta Ads account
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste a Facebook Marketing API access token + ad account ID. The
            token is encrypted at rest and only used to read campaign data.
          </p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Connect ad account
          </button>
        </section>
      )}

      {showForm && (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              {conn ? "Replace connection" : "Connect Meta Ads"}
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
            Get a long-lived token from{" "}
            <a
              href="https://developers.facebook.com/tools/explorer/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 hover:text-emerald-800"
            >
              Graph API Explorer
            </a>{" "}
            with the <code className="font-mono">ads_read</code> permission,
            then exchange it for a long-lived token. Ad account id looks like{" "}
            <code className="font-mono">act_1234567890</code> or just the
            numeric portion.
          </p>
          {saveErr && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveErr}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Access token
              <textarea
                required
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="EAAB..."
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Ad account ID
              <input
                required
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="act_1234567890"
              />
            </label>
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
                  {conn.adAccountName ?? `act_${conn.adAccountId}`}
                </div>
                <div className="text-xs text-slate-600">
                  {conn.businessName && `${conn.businessName} · `}
                  <code className="font-mono">act_{conn.adAccountId}</code>
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

      {/* Campaign table */}
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
              No campaigns found in this ad account.
            </div>
          )}
          {campaigns.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Campaign</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Objective</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Impressions
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                    <th className="px-3 py-2 text-right font-semibold">CTR</th>
                    <th className="px-3 py-2 text-right font-semibold">Spend</th>
                    <th className="px-3 py-2 text-right font-semibold">Reach</th>
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
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusColor(c.effective_status ?? c.status)}`}
                        >
                          {c.effective_status ?? c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {c.objective ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.insights?.impressions)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.insights?.clicks)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {c.insights?.ctr
                          ? `${Number(c.insights.ctr).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatCurrency(c.insights?.spend, conn.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(c.insights?.reach)}
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
        <strong>Slice 1 scope:</strong> read-only campaigns + insights. Future
        slices: click-to-WhatsApp ad creation, Meta Lead Ads → CRM auto-sync,
        custom audience export from your contact list, AI campaign optimizer.
      </div>
    </DashboardShell>
  );
}
