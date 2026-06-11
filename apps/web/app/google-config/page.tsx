"use client";

// SuperAdmin — Google Business Profile API Configuration. Stores the platform's
// Google OAuth app credentials (client id/secret, redirect URI, scope, enable).
// The secret is write-only: GET returns last4 only; leave the field blank to
// keep the existing secret. Backed by GET/PUT /api/v1/admin/google-config.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface SafeConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  enabled: boolean;
  hasSecret: boolean;
  secretLast4: string | null;
}

export default function GoogleConfigPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scope, setScope] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [hasSecret, setHasSecret] = useState(false);
  const [secretLast4, setSecretLast4] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        setErr(null);
        const c = await api.get<SafeConfig>("/api/v1/admin/google-config");
        setClientId(c.clientId);
        setRedirectUri(c.redirectUri);
        setScope(c.scope);
        setEnabled(c.enabled);
        setHasSecret(c.hasSecret);
        setSecretLast4(c.secretLast4);
      } catch (e) {
        setErr(e instanceof ApiClientError ? e.message : "Unable to load configuration (Super Admin only).");
      }
    })();
  }, [user]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { clientId: clientId.trim(), redirectUri: redirectUri.trim(), scope: scope.trim(), enabled };
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      const c = await api.put<SafeConfig>("/api/v1/admin/google-config", body);
      setClientSecret("");
      setHasSecret(c.hasSecret);
      setSecretLast4(c.secretLast4);
      setScope(c.scope);
      setNotice("Configuration saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save configuration.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-950">Google Business Profile</h1>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">API Configuration</span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            OAuth credentials for Google Business Profile API: locations, reviews, replies, and insights.
          </p>
        </div>
        <p className="max-w-xs text-sm text-slate-400">Set credentials, callback targets, scopes, and toggles for this provider.</p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <form onSubmit={save} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="rounded-md border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Status</p>
          <div className="mt-2 flex items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="status" checked={enabled} onChange={() => setEnabled(true)} /> Enable
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="status" checked={!enabled} onChange={() => setEnabled(false)} /> Disable
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Google OAuth Client ID
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Google OAuth Client Secret
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={hasSecret ? `•••• ${secretLast4 ?? ""} (leave blank to keep)` : "Enter client secret"}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Authorized redirect URI
            <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="https://.../google-business/callback" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            OAuth scope
            <input value={scope} onChange={(e) => setScope(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            This page only stores provider API settings. Channel accounts themselves are managed in the user dashboard.
          </p>
          <button type="submit" disabled={busy} className="flex-none rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "Saving..." : "Save configuration"}
          </button>
        </div>
      </form>
    </DashboardShell>
  );
}
