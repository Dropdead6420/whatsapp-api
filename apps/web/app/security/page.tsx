"use client";

// Security settings — two-factor authentication (Complete Planning PDF §28).
// Self-service enrolment for the TOTP backend (/api/v1/2fa): enable →
// scan/enter the secret in an authenticator app → confirm with a code →
// it's then required at login. English-first; localisation is a follow-up.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
}

interface EnrollmentChallenge {
  secret: string;
  otpauthUrl: string;
}

export default function SecurityPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [challenge, setChallenge] = useState<EnrollmentChallenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setStatus(await api.get<TwoFactorStatus>("/api/v1/2fa/status"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load 2FA status.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function beginEnroll() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const data = await api.post<EnrollmentChallenge>("/api/v1/2fa/enroll", {});
      setChallenge(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to start enrolment.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const next = await api.post<TwoFactorStatus>("/api/v1/2fa/enroll/confirm", { token: code.trim() });
      setStatus(next);
      setChallenge(null);
      setCode("");
      setNotice("Two-factor authentication is now enabled.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Invalid verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const token = window.prompt("Enter a current 6-digit code to disable two-factor authentication:");
    if (!token) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const next = await api.post<TwoFactorStatus>("/api/v1/2fa/disable", { token: token.trim() });
      setStatus(next);
      setNotice("Two-factor authentication has been disabled.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to disable two-factor.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Security</p>
        <h1 className="text-2xl font-semibold text-slate-950">Two-factor authentication</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Add a second step at login using an authenticator app (Google Authenticator,
          Authy, 1Password, etc.).
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <section className="max-w-xl rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-950">Status</div>
            <p className="mt-1 text-sm text-slate-500">
              {status?.enabled
                ? "Enabled — a code is required at every login."
                : status?.pending
                  ? "Enrolment started but not yet confirmed."
                  : "Not enabled."}
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              status?.enabled
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {status?.enabled ? "ON" : "OFF"}
          </span>
        </div>

        {!status?.enabled && !challenge && (
          <button
            type="button"
            onClick={() => void beginEnroll()}
            disabled={busy}
            className="mt-5 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Starting..." : "Enable two-factor"}
          </button>
        )}

        {status?.enabled && (
          <button
            type="button"
            onClick={() => void disable()}
            disabled={busy}
            className="mt-5 rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Disable two-factor
          </button>
        )}

        {challenge && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <div className="text-sm font-semibold text-slate-950">1. Add this secret to your app</div>
            <p className="mt-1 text-xs text-slate-500">
              Enter this key manually, or use the setup link below.
            </p>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm tracking-widest text-slate-900 break-all">
              {challenge.secret}
            </div>
            <a
              href={challenge.otpauthUrl}
              className="mt-2 inline-block text-xs font-semibold text-emerald-700 underline break-all"
            >
              otpauth setup link
            </a>

            <form onSubmit={confirmEnroll} className="mt-4">
              <label className="block text-sm font-medium text-slate-700">
                2. Enter the 6-digit code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-2 font-mono text-lg tracking-widest outline-none focus:border-slate-900"
                />
              </label>
              <div className="mt-4 flex gap-2">
                <button
                  type="submit"
                  disabled={busy || code.trim().length !== 6}
                  className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Verifying..." : "Confirm & enable"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                  }}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
