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

interface SubscribedLeadForm {
  id: string;
  formId: string;
  formName: string | null;
  pageId: string | null;
  pageName: string | null;
  importTag: string | null;
  isActive: boolean;
  lastFetchedAt: string | null;
  lastFetchError: string | null;
  importedCount: number;
  createdAt: string;
}

interface DiscoveredLeadForm {
  id: string;
  name?: string;
  status?: string;
  page?: { id: string; name?: string };
}

type AudienceStatus = "CREATING" | "READY" | "REFRESHING" | "FAILED";

interface MetaAudience {
  id: string;
  metaAudienceId: string | null;
  name: string;
  description: string | null;
  status: AudienceStatus;
  contactCount: number;
  uploadedCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  filterSpec: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface AudienceSpecInput {
  tagsAny?: string[];
  tagsAll?: string[];
  inactiveSinceDays?: number;
  interactedWithinDays?: number;
  aiScoreGte?: number;
  aiScoreLte?: number;
  hasEmail?: boolean;
}

interface MetaPage {
  id: string;
  name?: string;
}

interface CtwaDraftResponse {
  campaignId: string;
  adSetId: string;
  adsManagerUrl: string;
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

  // Lead Ads (slice 2)
  const [leadForms, setLeadForms] = useState<SubscribedLeadForm[]>([]);
  const [leadFormsBusy, setLeadFormsBusy] = useState(false);
  const [leadFormsErr, setLeadFormsErr] = useState<string | null>(null);
  const [showDiscover, setShowDiscover] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredLeadForm[] | null>(
    null,
  );
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);
  const [pendingImportTag, setPendingImportTag] = useState("meta-lead");

  // Audiences (slice 3)
  const [audiences, setAudiences] = useState<MetaAudience[]>([]);
  const [audiencesBusy, setAudiencesBusy] = useState(false);
  const [audiencesErr, setAudiencesErr] = useState<string | null>(null);
  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [audienceName, setAudienceName] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [audienceTagsAny, setAudienceTagsAny] = useState("");
  const [audienceMinAiScore, setAudienceMinAiScore] = useState("");
  const [audiencePreview, setAudiencePreview] = useState<{
    contactCount: number;
    hashableCount: number;
  } | null>(null);
  const [audiencePreviewBusy, setAudiencePreviewBusy] = useState(false);
  const [audienceSaving, setAudienceSaving] = useState(false);
  const [audienceSaveErr, setAudienceSaveErr] = useState<string | null>(null);

  // Click-to-WhatsApp drafts (slice 4)
  const [ctwaPages, setCtwaPages] = useState<MetaPage[]>([]);
  const [ctwaPagesBusy, setCtwaPagesBusy] = useState(false);
  const [showCtwaForm, setShowCtwaForm] = useState(false);
  const [ctwaPageId, setCtwaPageId] = useState("");
  const [ctwaName, setCtwaName] = useState("");
  const [ctwaDailyBudget, setCtwaDailyBudget] = useState("");
  const [ctwaGeoCsv, setCtwaGeoCsv] = useState("IN");
  const [ctwaSaving, setCtwaSaving] = useState(false);
  const [ctwaErr, setCtwaErr] = useState<string | null>(null);
  const [ctwaResult, setCtwaResult] = useState<CtwaDraftResponse | null>(null);

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

  async function loadLeadForms() {
    setLeadFormsBusy(true);
    setLeadFormsErr(null);
    try {
      const data = await api.get<SubscribedLeadForm[]>(
        "/api/v1/meta-ads/lead-forms",
      );
      setLeadForms(data);
    } catch (e) {
      setLeadFormsErr(
        e instanceof ApiClientError
          ? `Failed to load lead forms: ${e.message}`
          : "Failed to load lead forms.",
      );
    } finally {
      setLeadFormsBusy(false);
    }
  }

  async function handleDiscover() {
    setDiscoverBusy(true);
    setDiscoverErr(null);
    setDiscovered(null);
    try {
      const data = await api.get<DiscoveredLeadForm[]>(
        "/api/v1/meta-ads/lead-forms/discover",
      );
      setDiscovered(data);
    } catch (e) {
      setDiscoverErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to discover lead forms.",
      );
    } finally {
      setDiscoverBusy(false);
    }
  }

  async function handleSubscribe(form: DiscoveredLeadForm) {
    try {
      await api.post("/api/v1/meta-ads/lead-forms", {
        formId: form.id,
        formName: form.name,
        pageId: form.page?.id,
        pageName: form.page?.name,
        importTag: pendingImportTag.trim() || undefined,
      });
      await loadLeadForms();
    } catch (e) {
      setDiscoverErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to subscribe to form.",
      );
    }
  }

  async function handleUnsubscribe(formRowId: string) {
    if (!window.confirm("Stop importing leads from this form?")) return;
    try {
      await api.delete(`/api/v1/meta-ads/lead-forms/${formRowId}`);
      await loadLeadForms();
    } catch (e) {
      setLeadFormsErr(
        e instanceof ApiClientError ? e.message : "Failed to unsubscribe.",
      );
    }
  }

  // Auto-load subscribed forms whenever a connection is present.
  useEffect(() => {
    if (conn) void loadLeadForms();
    else setLeadForms([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.adAccountId]);

  // Audiences
  function buildAudienceSpec(): AudienceSpecInput {
    const spec: AudienceSpecInput = {};
    const tags = audienceTagsAny
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 0) spec.tagsAny = tags;
    const score = audienceMinAiScore.trim();
    if (score) {
      const n = Number(score);
      if (Number.isFinite(n) && n >= 0 && n <= 1) {
        spec.aiScoreGte = n;
      }
    }
    return spec;
  }

  async function loadAudiences() {
    setAudiencesBusy(true);
    setAudiencesErr(null);
    try {
      const data = await api.get<MetaAudience[]>("/api/v1/meta-ads/audiences");
      setAudiences(data);
    } catch (e) {
      setAudiencesErr(
        e instanceof ApiClientError
          ? `Failed to load audiences: ${e.message}`
          : "Failed to load audiences.",
      );
    } finally {
      setAudiencesBusy(false);
    }
  }

  async function handleAudiencePreview() {
    setAudiencePreviewBusy(true);
    setAudienceSaveErr(null);
    try {
      const data = await api.post<{
        contactCount: number;
        hashableCount: number;
      }>("/api/v1/meta-ads/audiences/preview", buildAudienceSpec());
      setAudiencePreview(data);
    } catch (e) {
      setAudienceSaveErr(
        e instanceof ApiClientError ? e.message : "Failed to preview audience.",
      );
    } finally {
      setAudiencePreviewBusy(false);
    }
  }

  async function handleCreateAudience(e: FormEvent) {
    e.preventDefault();
    setAudienceSaving(true);
    setAudienceSaveErr(null);
    try {
      await api.post("/api/v1/meta-ads/audiences", {
        name: audienceName.trim(),
        description: audienceDescription.trim() || undefined,
        spec: buildAudienceSpec(),
      });
      setShowAudienceForm(false);
      setAudienceName("");
      setAudienceDescription("");
      setAudienceTagsAny("");
      setAudienceMinAiScore("");
      setAudiencePreview(null);
      await loadAudiences();
    } catch (e) {
      setAudienceSaveErr(
        e instanceof ApiClientError ? e.message : "Failed to create audience.",
      );
    } finally {
      setAudienceSaving(false);
    }
  }

  async function handleRefreshAudience(id: string) {
    try {
      await api.post(`/api/v1/meta-ads/audiences/${id}/refresh`);
      await loadAudiences();
    } catch (e) {
      setAudiencesErr(
        e instanceof ApiClientError ? e.message : "Failed to refresh audience.",
      );
    }
  }

  async function handleDeleteAudience(id: string) {
    if (
      !window.confirm(
        "Remove this audience from NexaFlow? The Meta-side audience stays put so your retargeting ads keep working.",
      )
    ) {
      return;
    }
    try {
      await api.delete(`/api/v1/meta-ads/audiences/${id}`);
      await loadAudiences();
    } catch (e) {
      setAudiencesErr(
        e instanceof ApiClientError ? e.message : "Failed to delete audience.",
      );
    }
  }

  useEffect(() => {
    if (conn) void loadAudiences();
    else setAudiences([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.adAccountId]);

  // Click-to-WhatsApp pages
  async function loadCtwaPages() {
    setCtwaPagesBusy(true);
    setCtwaErr(null);
    try {
      const data = await api.get<MetaPage[]>("/api/v1/meta-ads/pages");
      setCtwaPages(data);
      if (data.length > 0 && !ctwaPageId) setCtwaPageId(data[0].id);
    } catch (e) {
      setCtwaErr(
        e instanceof ApiClientError ? e.message : "Failed to load pages.",
      );
    } finally {
      setCtwaPagesBusy(false);
    }
  }

  async function handleCreateCtwa(e: FormEvent) {
    e.preventDefault();
    setCtwaSaving(true);
    setCtwaErr(null);
    setCtwaResult(null);
    try {
      const budget = Number(ctwaDailyBudget) * 100; // operator types whole units; backend wants minor units
      if (!Number.isFinite(budget) || budget < 1) {
        throw new Error("Daily budget must be a positive number.");
      }
      const geoCountries = ctwaGeoCsv
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s));
      const data = await api.post<CtwaDraftResponse>(
        "/api/v1/meta-ads/click-to-whatsapp",
        {
          pageId: ctwaPageId,
          campaignName: ctwaName.trim(),
          dailyBudgetMinor: Math.floor(budget),
          geoCountries: geoCountries.length > 0 ? geoCountries : undefined,
        },
      );
      setCtwaResult(data);
      setCtwaName("");
      setCtwaDailyBudget("");
    } catch (e) {
      setCtwaErr(
        e instanceof ApiClientError
          ? e.message
          : (e as Error).message ?? "Failed to create draft.",
      );
    } finally {
      setCtwaSaving(false);
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

      {/* Lead Ads section (slice 2) */}
      {conn && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Lead Ads → CRM auto-sync
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Pick which Meta Lead Ad forms feed your CRM. New submissions
                are imported as Contact + Lead rows every 10 minutes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDiscover((v) => !v);
                if (!showDiscover && discovered === null) void handleDiscover();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {showDiscover ? "Hide forms" : "Browse forms"}
            </button>
          </div>

          {leadFormsErr && (
            <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {leadFormsErr}
            </div>
          )}

          {leadForms.length === 0 && !leadFormsBusy && !showDiscover && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No forms subscribed yet. Click <em>Browse forms</em> to pick from
              the forms attached to your ad account&apos;s pages.
            </div>
          )}

          {leadForms.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Form</th>
                    <th className="px-3 py-2 font-semibold">Page</th>
                    <th className="px-3 py-2 font-semibold">Import tag</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Imported
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Last sync
                    </th>
                    <th className="px-3 py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leadForms.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {f.formName ?? `Form ${f.formId}`}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {f.formId}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {f.pageName ?? f.pageId ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {f.importTag ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                            {f.importTag}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {f.importedCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-600">
                        {f.lastFetchedAt
                          ? new Date(f.lastFetchedAt).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "queued"}
                        {f.lastFetchError && (
                          <div className="text-red-700">
                            {f.lastFetchError.slice(0, 80)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleUnsubscribe(f.id)}
                          className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                        >
                          Unsubscribe
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showDiscover && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <label className="block text-xs font-semibold text-slate-700">
                  Import tag (added to every Contact)
                  <input
                    value={pendingImportTag}
                    onChange={(e) => setPendingImportTag(e.target.value)}
                    maxLength={80}
                    className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="meta-lead"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleDiscover()}
                  disabled={discoverBusy}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {discoverBusy ? "Listing…" : "Refresh list"}
                </button>
              </div>

              {discoverErr && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {discoverErr}
                </div>
              )}

              {discovered && discovered.length === 0 && !discoverBusy && (
                <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-500">
                  No lead forms found on the pages this ad account can read.
                  Check that the access token has the
                  <code className="ml-1 font-mono">leads_retrieval</code> +
                  <code className="ml-1 font-mono">pages_show_list</code>{" "}
                  permissions.
                </div>
              )}

              {discovered && discovered.length > 0 && (
                <ul className="space-y-2">
                  {discovered.map((f) => {
                    const subscribed = leadForms.find((s) => s.formId === f.id);
                    return (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">
                            {f.name ?? `Form ${f.id}`}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {f.id}
                            {f.page?.name && (
                              <span className="ml-2 font-sans text-slate-600">
                                · {f.page.name}
                              </span>
                            )}
                            {f.status && (
                              <span className="ml-2 font-sans uppercase text-slate-500">
                                {f.status}
                              </span>
                            )}
                          </div>
                        </div>
                        {subscribed ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                            Subscribed
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSubscribe(f)}
                            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                          >
                            Subscribe
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* Audience export section (slice 3) */}
      {conn && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Custom audience export
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Push a slice of your contact list to Meta as a Custom Audience.
                Phone numbers are SHA-256 hashed before upload — the raw
                numbers never leave NexaFlow. Use the audience in Ads Manager
                for retargeting.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAudienceForm((v) => !v)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {showAudienceForm ? "Cancel" : "+ New audience"}
            </button>
          </div>

          {audiencesErr && (
            <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {audiencesErr}
            </div>
          )}

          {showAudienceForm && (
            <form
              onSubmit={handleCreateAudience}
              className="border-b border-slate-200 bg-slate-50 px-4 py-4 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Name
                  <input
                    required
                    value={audienceName}
                    onChange={(e) => setAudienceName(e.target.value)}
                    maxLength={120}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="Win-back salon regulars"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Description (optional)
                  <input
                    value={audienceDescription}
                    onChange={(e) => setAudienceDescription(e.target.value)}
                    maxLength={800}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="Contacts tagged 'regular' who haven't visited in 30d"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Tags (any of these, comma-separated)
                  <input
                    value={audienceTagsAny}
                    onChange={(e) => setAudienceTagsAny(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    placeholder="regular, vip"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Minimum AI score (0-1)
                  <input
                    value={audienceMinAiScore}
                    onChange={(e) => setAudienceMinAiScore(e.target.value)}
                    type="number"
                    min={0}
                    max={1}
                    step="0.05"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="0.50"
                  />
                </label>
              </div>

              {audiencePreview && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <strong>{audiencePreview.contactCount.toLocaleString()}</strong>{" "}
                  contacts match this filter ·{" "}
                  <strong>{audiencePreview.hashableCount.toLocaleString()}</strong>{" "}
                  will be uploaded after deduplication.
                </div>
              )}

              {audienceSaveErr && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {audienceSaveErr}
                </div>
              )}

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleAudiencePreview()}
                  disabled={audiencePreviewBusy}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {audiencePreviewBusy ? "Counting…" : "Preview size"}
                </button>
                <button
                  type="submit"
                  disabled={audienceSaving || !audienceName.trim()}
                  className="rounded-md bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {audienceSaving ? "Uploading…" : "Create + upload"}
                </button>
              </div>
            </form>
          )}

          {audiences.length === 0 && !audiencesBusy && !showAudienceForm && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No audiences exported yet. Click <em>New audience</em> to send a
              segment to Meta.
            </div>
          )}

          {audiences.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Audience</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Matched
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Uploaded
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Last sync
                    </th>
                    <th className="px-3 py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audiences.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {a.name}
                        </div>
                        {a.description && (
                          <div className="text-[11px] text-slate-500">
                            {a.description}
                          </div>
                        )}
                        {a.metaAudienceId && (
                          <div className="font-mono text-[10px] text-slate-500">
                            meta:{a.metaAudienceId}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            a.status === "READY"
                              ? "bg-emerald-100 text-emerald-800"
                              : a.status === "FAILED"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {a.contactCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                        {a.uploadedCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-600">
                        {a.lastSyncedAt
                          ? new Date(a.lastSyncedAt).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                        {a.lastSyncError && (
                          <div className="text-red-700">
                            {a.lastSyncError.slice(0, 80)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void handleRefreshAudience(a.id)}
                            disabled={
                              a.status === "REFRESHING" || a.status === "CREATING"
                            }
                            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            Refresh
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteAudience(a.id)}
                            className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Click-to-WhatsApp ad drafts (slice 4) */}
      {conn && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Click-to-WhatsApp ads
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Spin up a paused Campaign + ad set wired to a WhatsApp
                destination. Open the result in Ads Manager to attach
                creative + finalise targeting before going live.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCtwaForm((v) => !v);
                setCtwaResult(null);
                setCtwaErr(null);
                if (!showCtwaForm && ctwaPages.length === 0) void loadCtwaPages();
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {showCtwaForm ? "Cancel" : "+ New CTWA draft"}
            </button>
          </div>

          {showCtwaForm && (
            <form onSubmit={handleCreateCtwa} className="space-y-3 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Facebook Page
                  <select
                    required
                    value={ctwaPageId}
                    onChange={(e) => setCtwaPageId(e.target.value)}
                    disabled={ctwaPagesBusy || ctwaPages.length === 0}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    {ctwaPagesBusy && <option>Loading pages…</option>}
                    {!ctwaPagesBusy && ctwaPages.length === 0 && (
                      <option value="">No pages available</option>
                    )}
                    {ctwaPages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name ?? p.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Campaign name
                  <input
                    required
                    value={ctwaName}
                    onChange={(e) => setCtwaName(e.target.value)}
                    maxLength={200}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="Salon launch — WhatsApp"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Daily budget ({conn.currency ?? "currency"})
                  <input
                    required
                    type="number"
                    min={1}
                    step="1"
                    value={ctwaDailyBudget}
                    onChange={(e) => setCtwaDailyBudget(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    placeholder="500"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Target countries (2-letter codes, comma-separated)
                  <input
                    value={ctwaGeoCsv}
                    onChange={(e) => setCtwaGeoCsv(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    placeholder="IN, AE"
                  />
                </label>
              </div>

              {ctwaErr && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {ctwaErr}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={
                    ctwaSaving ||
                    !ctwaPageId ||
                    !ctwaName.trim() ||
                    !ctwaDailyBudget
                  }
                  className="rounded-md bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {ctwaSaving ? "Creating on Meta…" : "Create paused draft"}
                </button>
              </div>
            </form>
          )}

          {ctwaResult && (
            <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-4">
              <h3 className="text-sm font-semibold text-emerald-900">
                Draft created in PAUSED state
              </h3>
              <p className="mt-1 text-xs text-emerald-800">
                Campaign ID{" "}
                <code className="font-mono">{ctwaResult.campaignId}</code> · Ad
                set ID <code className="font-mono">{ctwaResult.adSetId}</code>.
                Open Ads Manager to attach creative + review.
              </p>
              <a
                href={ctwaResult.adsManagerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                Open in Meta Ads Manager →
              </a>
            </div>
          )}

          {!showCtwaForm && !ctwaResult && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              Click <em>+ New CTWA draft</em> to spin up a paused campaign
              wired to WhatsApp.
            </div>
          )}
        </section>
      )}

      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Slice 4 shipped:</strong> Click-to-WhatsApp ad drafts. Meta
        Ads suite is feature-complete per PRD §3.3.6 except for the AI
        campaign optimizer + full Facebook OAuth flow.
      </div>
    </DashboardShell>
  );
}
