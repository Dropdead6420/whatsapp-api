"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../src/hooks/useAuth";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { api, ApiClientError } from "../../../src/lib/api";

type TenantType = "DIRECT" | "WHITE_LABEL" | "BUSINESS";
type PartnerModel = "RESELLER" | "BRING_YOUR_OWN_META" | "HYBRID";

export default function NewTenantPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [name, setName] = useState("");
  const [type, setType] = useState<TenantType>("DIRECT");
  const [domain, setDomain] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [messageQuota, setMessageQuota] = useState(10000);
  const [contactLimit, setContactLimit] = useState(1000);
  const [agentLimit, setAgentLimit] = useState(5);
  const [aiCredits, setAiCredits] = useState(1000);
  const [partnerModel, setPartnerModel] = useState<PartnerModel>("RESELLER");
  const [partnerMarginEnabled, setPartnerMarginEnabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        domain: domain.trim() || undefined,
        adminEmail: adminEmail.trim(),
        adminName: adminName.trim(),
        adminPassword,
        messageQuotaPerMonth: messageQuota,
        contactLimit,
        agentLimit,
        aiCreditsPerMonth: aiCredits,
      };
      if (type === "WHITE_LABEL") {
        payload.partnerModel = partnerModel;
        payload.partnerMarginEnabled = partnerMarginEnabled;
      }
      const created = await api.post<{ tenant: { id: string }; admin: { id: string } }>(
        "/api/v1/tenants",
        payload,
      );
      router.push(`/tenants/${created.tenant.id}`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <Link href="/tenants" className="text-sm text-slate-500 hover:underline">
          ← Tenants
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Create new tenant</h1>
        <p className="text-sm text-slate-500">
          Provisions the tenant account and its admin user. The admin can log in immediately.
        </p>
      </header>

      <form onSubmit={submit} className="max-w-3xl space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            Tenant details
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tenant name" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="input"
                placeholder="Cutz & Bangs"
              />
            </Field>
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TenantType)}
                className="input"
              >
                <option value="DIRECT">Direct business</option>
                <option value="WHITE_LABEL">White-label reseller</option>
                <option value="BUSINESS">Business (under reseller)</option>
              </select>
            </Field>
            <Field
              label="Custom domain"
              hint="Optional. For white-label: e.g. app.youragency.com"
            >
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="input"
                placeholder="app.example.com"
              />
            </Field>
          </div>
        </section>

        {type === "WHITE_LABEL" && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">
              Partner commercial model
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Configure how this reseller funds customers and whether margin is
              tracked in partner billing dashboards.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Partner model"
                hint="Reseller uses platform-owned WABA, BYO Meta uses partner credentials, Hybrid supports both."
              >
                <select
                  value={partnerModel}
                  onChange={(e) => setPartnerModel(e.target.value as PartnerModel)}
                  className="input"
                >
                  <option value="RESELLER">Reseller</option>
                  <option value="BRING_YOUR_OWN_META">Bring your own Meta</option>
                  <option value="HYBRID">Hybrid</option>
                </select>
              </Field>
              <label className="flex h-full cursor-pointer items-start justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm hover:bg-slate-100">
                <div>
                  <div className="font-medium text-slate-900">
                    Enable partner margin
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Turns on partner-funded wallet economics and agency profit
                    reporting for this reseller.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={partnerMarginEnabled}
                  onChange={(e) => setPartnerMarginEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
              </label>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            Admin user
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Admin name" required>
              <input
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field label="Admin email" required>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field
              label="Initial password"
              required
              hint="Minimum 8 characters. The admin should change this on first login."
            >
              <input
                type="text"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
                minLength={8}
                className="input"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            Limits
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Messages / month">
              <input
                type="number"
                min={0}
                value={messageQuota}
                onChange={(e) => setMessageQuota(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Contact limit">
              <input
                type="number"
                min={0}
                value={contactLimit}
                onChange={(e) => setContactLimit(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Agent limit">
              <input
                type="number"
                min={0}
                value={agentLimit}
                onChange={(e) => setAgentLimit(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="AI credits / month">
              <input
                type="number"
                min={0}
                value={aiCredits}
                onChange={(e) => setAiCredits(Number(e.target.value))}
                className="input"
              />
            </Field>
          </div>
        </section>

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link
            href="/tenants"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create tenant"}
          </button>
        </div>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid rgb(203 213 225);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: none;
          border-color: rgb(16 185 129);
          box-shadow: 0 0 0 1px rgb(16 185 129);
        }
      `}</style>
    </DashboardShell>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
