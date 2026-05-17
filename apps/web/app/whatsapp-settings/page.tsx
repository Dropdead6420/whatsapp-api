"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface WhatsAppConfig {
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  hasAccessToken: boolean;
  accessTokenPreview: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  accountStatus: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

function qualityClass(value: string | null) {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("green") || normalized.includes("high")) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (normalized.includes("yellow") || normalized.includes("medium")) {
    return "bg-amber-50 text-amber-700";
  }
  if (normalized.includes("red") || normalized.includes("low")) {
    return "bg-red-50 text-red-700";
  }
  return "bg-slate-100 text-slate-600";
}

export default function WhatsAppSettingsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN"],
  });
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function loadConfig() {
    setErr(null);
    try {
      const data = await api.get<WhatsAppConfig>("/api/v1/whatsapp/config");
      setConfig(data);
      setWabaId(data.wabaId ?? "");
      setPhoneNumberId(data.phoneNumberId ?? "");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load WhatsApp settings");
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadConfig();
  }, [user]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const saved = await api.patch<WhatsAppConfig>("/api/v1/whatsapp/config", {
        wabaId: wabaId.trim() || null,
        phoneNumberId: phoneNumberId.trim() || null,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        clearAccessToken: clearToken,
      });
      setConfig(saved);
      setAccessToken("");
      setClearToken(false);
      setNotice("WhatsApp configuration saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncStatus() {
    setSyncing(true);
    setErr(null);
    setNotice(null);
    try {
      const synced = await api.post<WhatsAppConfig>("/api/v1/whatsapp/config/sync");
      setConfig(synced);
      setNotice(
        synced.lastSyncError
          ? "Sync attempted, but Meta returned an error. Check the status panel."
          : "WhatsApp quality status synced.",
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect Meta WhatsApp Business API and monitor phone-number quality health.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form
          onSubmit={save}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-semibold">Connection</h2>
          <p className="mt-1 text-xs text-slate-500">
            Use the phone number ID from Meta, not the customer-facing phone number.
          </p>

          <label className="mt-5 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              WABA ID
            </span>
            <input
              value={wabaId}
              onChange={(event) => setWabaId(event.target.value)}
              placeholder="123456789012345"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Phone Number ID
            </span>
            <input
              value={phoneNumberId}
              onChange={(event) => setPhoneNumberId(event.target.value)}
              placeholder="123456789012345"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Access Token
            </span>
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder={
                config?.hasAccessToken
                  ? `Stored: ${config.accessTokenPreview}`
                  : "Paste a permanent Meta system-user token"
              }
              type="password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </label>

          <label className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={clearToken}
              onChange={(event) => setClearToken(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-slate-700">Clear stored token</span>
              <span className="text-xs text-slate-500">
                This disables outbound sends, templates, appointments, campaigns, and flow message nodes.
              </span>
            </span>
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save settings"}
            </button>
            <button
              type="button"
              onClick={() => void syncStatus()}
              disabled={syncing || !config?.hasAccessToken || !phoneNumberId.trim()}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Sync Meta status"}
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold">Quality Health</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Quality rating</dt>
                <dd>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${qualityClass(config?.qualityRating ?? null)}`}>
                    {config?.qualityRating ?? "Unknown"}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Messaging tier</dt>
                <dd className="text-right font-medium text-slate-700">
                  {config?.messagingLimitTier ?? "Unknown"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Account status</dt>
                <dd className="text-right font-medium text-slate-700">
                  {config?.accountStatus ?? "Unknown"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Display phone</dt>
                <dd className="text-right font-medium text-slate-700">
                  {config?.displayPhoneNumber ?? "Not synced"}
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {config?.lastSyncedAt
                ? `Last synced ${new Date(config.lastSyncedAt).toLocaleString()}`
                : "Not synced yet."}
            </div>
            {config?.lastSyncError && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {config.lastSyncError}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold">Operational Guardrails</h2>
            <ul className="mt-3 space-y-2 text-xs text-slate-600">
              <li>Outbound messages still respect monthly quota and per-second smoothing.</li>
              <li>Opted-out contacts are blocked before any send leaves NexaFlow.</li>
              <li>STOP, UNSUBSCRIBE, CANCEL, and STOP ALL close the conversation automatically.</li>
              <li>Access tokens are write-only in the app UI.</li>
            </ul>
          </div>
        </aside>
      </div>
    </DashboardShell>
  );
}
