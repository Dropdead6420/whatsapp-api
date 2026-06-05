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
  tokenExpiresAt: string | null;
  tokenExpiryWarning: "ok" | "warn" | "critical" | "expired" | null;
  businessName: string | null;
  businessVertical: string | null;
  businessAbout: string | null;
  businessProfileSyncedAt: string | null;
}

interface BusinessProfileResult {
  name: string | null;
  vertical: string | null;
  about: string | null;
  syncedAt: string;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const abs = d.toLocaleString();
  if (days < 0) return `expired ${Math.abs(days)} day(s) ago (${abs})`;
  if (days === 0) return `expires today (${abs})`;
  return `${days} day(s) — ${abs}`;
}

function expiryClass(warning: WhatsAppConfig["tokenExpiryWarning"]): string {
  switch (warning) {
    case "expired":
      return "bg-red-100 text-red-800 border-red-200";
    case "critical":
      return "bg-red-50 text-red-700 border-red-200";
    case "warn":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "ok":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

// Meta Embedded Signup (T-004). Lazy-load the FB SDK + open the
// Embedded Signup popup, listen for the WA_EMBEDDED_SIGNUP message
// (carries wabaId + phoneNumberId), and POST the code bundle to
// /api/v1/whatsapp/embedded-signup so the API can exchange + persist.

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

interface FbAuthResponse {
  code?: string;
  authResponse?: { code?: string };
  business_id?: string;
}

interface FbSdk {
  init(opts: { appId: string; version: string; xfbml?: boolean }): void;
  login(
    callback: (response: FbAuthResponse) => void,
    opts: {
      config_id: string;
      response_type?: string;
      override_default_response_type?: boolean;
      extras?: { setup?: Record<string, unknown> };
    },
  ): void;
}

const FB_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const FB_CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;

function loadFbSdk(appId: string): Promise<FbSdk> {
  if (typeof window === "undefined") return Promise.reject("ssr");
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: "v20.0" });
      if (window.FB) resolve(window.FB);
      else reject(new Error("FB SDK init failed"));
    };
    const existing = document.getElementById("facebook-jssdk");
    if (existing) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () =>
      reject(new Error("Failed to load Facebook SDK script"));
    document.body.appendChild(script);
  });
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
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [resubscribing, setResubscribing] = useState(false);
  const [profileAbout, setProfileAbout] = useState("");
  const [profileVertical, setProfileVertical] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  async function resubscribeWebhook() {
    setResubscribing(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<{ subscribed: boolean }>(
        "/api/v1/whatsapp/config/resubscribe",
      );
      setNotice(
        result.subscribed
          ? "Re-subscribed. Inbound messages will route here."
          : "Re-subscribe failed — check that the access token is still valid.",
      );
      await loadConfig();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Re-subscribe failed.");
    } finally {
      setResubscribing(false);
    }
  }

  const embeddedSignupConfigured = Boolean(FB_APP_ID && FB_CONFIG_ID);

  async function startEmbeddedSignup() {
    if (!FB_APP_ID || !FB_CONFIG_ID) return;
    setErr(null);
    setNotice(null);
    setSigningIn(true);

    // Listen for the WA_EMBEDDED_SIGNUP postMessage Meta emits from the
    // popup with the selected waba_id + phone_number_id.
    let waContext: { wabaId?: string; phoneNumberId?: string } = {};
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com") return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          waContext = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch {
        // not a WA signup message — ignore
      }
    };
    window.addEventListener("message", onMessage);

    try {
      const FB = await loadFbSdk(FB_APP_ID);
      const response = await new Promise<FbAuthResponse>((resolve) => {
        FB.login(resolve, {
          config_id: FB_CONFIG_ID,
          response_type: "code",
          override_default_response_type: true,
        });
      });

      const code = response.code ?? response.authResponse?.code;
      const businessId = response.business_id;
      if (!code) {
        throw new Error("Facebook login was cancelled or returned no code.");
      }
      if (!businessId || !waContext.wabaId || !waContext.phoneNumberId) {
        throw new Error(
          "Meta did not return the selected WhatsApp business / phone. Try again.",
        );
      }

      const saved = await api.post<WhatsAppConfig & { webhookSubscribed: boolean }>(
        "/api/v1/whatsapp/embedded-signup",
        {
          code,
          businessId,
          wabaId: waContext.wabaId,
          phoneNumberId: waContext.phoneNumberId,
        },
      );
      setNotice(
        saved.webhookSubscribed
          ? "Connected. Inbound messages will route here."
          : "Connected, but webhook subscribe failed — retry from the Sync button.",
      );
      await loadConfig();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : (e as Error).message,
      );
    } finally {
      window.removeEventListener("message", onMessage);
      setSigningIn(false);
    }
  }

  async function loadConfig() {
    setErr(null);
    try {
      const data = await api.get<WhatsAppConfig>("/api/v1/whatsapp/config");
      setConfig(data);
      setWabaId(data.wabaId ?? "");
      setPhoneNumberId(data.phoneNumberId ?? "");
      setProfileAbout(data.businessAbout ?? "");
      setProfileVertical(data.businessVertical ?? "");
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

  async function saveBusinessProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setErr(null);
    setNotice(null);
    try {
      await api.patch<BusinessProfileResult>("/api/v1/whatsapp/config/profile", {
        about: profileAbout.trim(),
        vertical: profileVertical.trim(),
      });
      await loadConfig();
      setNotice("Business profile updated on Meta.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Profile update failed");
    } finally {
      setSavingProfile(false);
    }
  }

  async function syncBusinessProfile() {
    setSyncingProfile(true);
    setErr(null);
    setNotice(null);
    try {
      const profile = await api.post<BusinessProfileResult>(
        "/api/v1/whatsapp/config/sync-profile",
      );
      // Reload full config so the panel reflects every field after the sync.
      await loadConfig();
      setNotice(
        profile.name
          ? `Business profile synced — ${profile.name}.`
          : "Business profile synced (Meta returned no display name yet).",
      );
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Business profile sync failed",
      );
    } finally {
      setSyncingProfile(false);
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

      {config?.tokenExpiryWarning &&
        config.tokenExpiryWarning !== "ok" && (
          <div
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${expiryClass(config.tokenExpiryWarning)}`}
          >
            <div>
              <div className="font-medium">
                {config.tokenExpiryWarning === "expired"
                  ? "Access token has expired."
                  : config.tokenExpiryWarning === "critical"
                  ? "Access token expires soon."
                  : "Access token expires within 14 days."}
              </div>
              <div className="mt-0.5 text-xs opacity-80">
                {formatExpiry(config.tokenExpiresAt)}. Re-run Connect with
                Meta to refresh before it lapses.
              </div>
            </div>
            <button
              type="button"
              disabled={resubscribing || !config.hasAccessToken}
              onClick={() => void resubscribeWebhook()}
              className="rounded-md border border-current/40 px-3 py-1.5 text-xs font-medium hover:bg-white/40 disabled:opacity-50"
            >
              {resubscribing ? "Re-subscribing…" : "Re-subscribe webhook"}
            </button>
          </div>
        )}

      {/* Meta Embedded Signup (T-004). Skipped when the FB app
          credentials aren't configured for this build. */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-blue-900">
              Connect with Meta (recommended)
            </h2>
            <p className="mt-1 text-xs text-blue-800/80">
              One-click onboarding — Meta returns the WhatsApp Business
              Account ID, phone number ID, and a long-lived access token.
              We encrypt and store everything; nothing leaves your browser
              in plain text after this step.
            </p>
            {!embeddedSignupConfigured && (
              <p className="mt-2 text-xs text-amber-700">
                Embedded Signup isn&apos;t configured for this build. Set{" "}
                <code>NEXT_PUBLIC_META_APP_ID</code> and{" "}
                <code>NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID</code> to
                enable the button below. Manual configuration still works.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!embeddedSignupConfigured || signingIn}
            onClick={() => void startEmbeddedSignup()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {signingIn ? "Connecting…" : "Connect with Meta"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form
          onSubmit={save}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-semibold">Connection (manual)</h2>
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
          {/* Business profile card. Visible once WhatsApp is connected;
              fields are pulled from Meta via /config/sync-profile. */}
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold">Business profile</h2>
              <button
                type="button"
                onClick={() => void syncBusinessProfile()}
                disabled={syncingProfile || !config?.hasAccessToken}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncingProfile ? "Syncing..." : "Sync from Meta"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Display name: <b>{config?.businessName ?? "—"}</b> (synced from Meta)
            </p>
            <form onSubmit={saveBusinessProfile} className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-slate-600">Vertical</span>
                <input
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                  value={profileVertical}
                  onChange={(e) => setProfileVertical(e.target.value)}
                  disabled={!config?.hasAccessToken}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">About</span>
                <textarea
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                  rows={3}
                  value={profileAbout}
                  onChange={(e) => setProfileAbout(e.target.value)}
                  disabled={!config?.hasAccessToken}
                />
              </label>
              <button
                type="submit"
                disabled={savingProfile || !config?.hasAccessToken}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingProfile ? "Saving…" : "Save to Meta"}
              </button>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Last synced:{" "}
              {config?.businessProfileSyncedAt
                ? new Date(config.businessProfileSyncedAt).toLocaleString()
                : "never"}
            </p>
          </div>

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
              <li>Outbound messages respect wallet balance, compliance, and per-second smoothing.</li>
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
