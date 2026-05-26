"use client";

// Partner / White-label settings.
//
// For now: just the custom email sender card (T-041 frontend). Future
// branding settings (logo, colors, custom CSS) land here too — the
// page already has the right shell.

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface EmailSender {
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailDomainVerifiedAt: string | null;
  emailDomainLastError: string | null;
}

interface DomainCheckResult {
  domain: string;
  spfPresent: boolean;
  dkimPresent: boolean;
  dmarcPresent: boolean;
  includeSeen: string[];
  verified: boolean;
  errors: string[];
}

export default function WhitelabelPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [sender, setSender] = useState<EmailSender | null>(null);
  const [draftAddress, setDraftAddress] = useState("");
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<DomainCheckResult | null>(null);

  async function refresh() {
    try {
      const data = await api.get<EmailSender>(
        "/api/v1/partner/whitelabel/email-sender",
      );
      setSender(data);
      setDraftAddress(data.emailFromAddress ?? "");
      setDraftName(data.emailFromName ?? "");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    setCheck(null);
    try {
      const data = await api.patch<EmailSender>(
        "/api/v1/partner/whitelabel/email-sender",
        {
          emailFromAddress: draftAddress.trim() || null,
          emailFromName: draftName.trim() || null,
        },
      );
      setSender(data);
      setNotice(
        "Saved. Run Verify domain to confirm SPF + DKIM records before emails route through it.",
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<DomainCheckResult>(
        "/api/v1/partner/whitelabel/email-sender/verify",
        {},
      );
      setCheck(result);
      if (result.verified) {
        setNotice(
          "Domain verified — tenant transactional emails will now send from this address.",
        );
        await refresh();
      } else {
        setErr("Verification failed. See the per-record check below.");
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Verify failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    const addr = draftAddress.trim();
    if (!addr.includes("@")) {
      setErr("Enter a valid email like notifications@yourdomain.com first.");
      return;
    }
    const domain = addr.split("@")[1];
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<DomainCheckResult>(
        "/api/v1/partner/whitelabel/email-sender/preview",
        { domain },
      );
      setCheck(result);
      setNotice(
        result.verified
          ? "DNS looks correct. Save then click Verify to lock it in."
          : "DNS check found issues. Fix them in your DNS provider then re-run.",
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  const verifiedAt = sender?.emailDomainVerifiedAt
    ? new Date(sender.emailDomainVerifiedAt)
    : null;
  const verifiedAge = verifiedAt
    ? Math.floor((Date.now() - verifiedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const verifiedStale = verifiedAge !== null && verifiedAge > 30;

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          White-label settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure how your workspace appears to customers — including the
          email address transactional notifications send from.
        </p>
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            err
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Email sender
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Send welcome / billing / agent-disabled emails from your own
              domain. Falls back to the platform default while unverified.
            </p>
          </div>
          {sender?.emailDomainVerifiedAt && !verifiedStale && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              verified
            </span>
          )}
          {verifiedStale && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              stale ({verifiedAge}d)
            </span>
          )}
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              From email address
              <input
                type="email"
                value={draftAddress}
                onChange={(e) => setDraftAddress(e.target.value)}
                placeholder="notifications@yourdomain.com"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-mono focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              From display name
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Acme Notifications"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={busy || !draftAddress.includes("@")}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Check DNS (preview)
            </button>
            <button
              type="button"
              onClick={() => void runVerify()}
              disabled={busy || !sender?.emailFromAddress}
              className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Verify domain
            </button>
          </div>
        </form>

        {sender?.emailDomainLastError && !check && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Last verification error:</strong>{" "}
            {sender.emailDomainLastError}
          </div>
        )}

        {check && <CheckPanel result={check} />}

        <div className="mt-5 rounded-md bg-slate-50 p-3 text-[11px] text-slate-600">
          <div className="font-semibold text-slate-700">
            Required DNS records at your domain
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>
              <span className="font-mono">SPF</span> (TXT at apex):{" "}
              <span className="font-mono text-slate-800">
                v=spf1 include:_spf.resend.com ~all
              </span>{" "}
              <span className="text-slate-400">
                (or your provider&apos;s include domain)
              </span>
            </li>
            <li>
              <span className="font-mono">DKIM</span> (TXT at{" "}
              <span className="font-mono">resend._domainkey.yourdomain.com</span>
              ): copy from your email provider&apos;s dashboard
            </li>
            <li>
              <span className="font-mono">DMARC</span> (TXT at{" "}
              <span className="font-mono">_dmarc.yourdomain.com</span>):{" "}
              recommended but not required for verification
            </li>
          </ul>
        </div>
      </section>
    </PartnerShell>
  );
}

function CheckPanel({ result }: { result: DomainCheckResult }) {
  return (
    <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="font-semibold text-slate-700">DNS check: {result.domain}</div>
      <div className="grid gap-1 sm:grid-cols-3">
        <CheckRow label="SPF" ok={result.spfPresent} />
        <CheckRow label="DKIM" ok={result.dkimPresent} />
        <CheckRow label="DMARC" ok={result.dmarcPresent} optional />
      </div>
      {result.includeSeen.length > 0 && (
        <div className="mt-1 text-[10px] text-slate-500">
          SPF includes:{" "}
          <span className="font-mono">{result.includeSeen.join(", ")}</span>
        </div>
      )}
      {result.errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-red-700">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckRow({
  label,
  ok,
  optional = false,
}: {
  label: string;
  ok: boolean;
  optional?: boolean;
}) {
  if (optional && !ok) {
    return (
      <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
        {label}: <span className="text-slate-500">optional, missing</span>
      </span>
    );
  }
  return (
    <span
      className={`rounded-md px-2 py-1 font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
      }`}
    >
      {label}: {ok ? "✓ present" : "✗ missing"}
    </span>
  );
}
