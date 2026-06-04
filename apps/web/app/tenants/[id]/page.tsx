"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../src/hooks/useAuth";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { startImpersonation } from "../../../src/lib/api";
import { api, ApiClientError } from "../../../src/lib/api";

interface TenantDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  partnerModel: PartnerModel | null;
  partnerMarginEnabled: boolean;
  domain: string | null;
  logoUrl: string | null;
  brandColors: string | null;
  customCss: string | null;
  messageQuotaPerMonth: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  createdAt: string;
  _count?: {
    users: number;
    contacts: number;
    campaigns: number;
    conversations: number;
  };
  subscriptions?: Array<{
    id: string;
    status: string;
    currentPeriodEnd: string;
    plan: { displayName: string; priceInPaisa: number };
  }>;
}

interface BrandColors {
  primary?: string;
  secondary?: string;
  accent?: string;
}

type PartnerModel = "RESELLER" | "BRING_YOUR_OWN_META" | "HYBRID";

interface CreditLine {
  id: string;
  limitCredits: number;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  dueDate: string | null;
  approvedByUserId: string | null;
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  suspendedAt: string | null;
}

function parseColors(raw: string | null): BrandColors {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BrandColors;
  } catch {
    return {};
  }
}

export default function TenantDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { user, loading: authLoading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [featureRegistry, setFeatureRegistry] = useState<
    Array<{ key: string; label: string }>
  >([]);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [featureSaving, setFeatureSaving] = useState(false);

  // Credit-line panel state (Claude FINAL §4 slice 8/11).
  const [creditLines, setCreditLines] = useState<CreditLine[]>([]);
  const [newLineLimit, setNewLineLimit] = useState("");
  const [newLineDueDate, setNewLineDueDate] = useState("");
  const [newLineNotes, setNewLineNotes] = useState("");
  const [creditLineBusy, setCreditLineBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    status: "ACTIVE",
    domain: "",
    logoUrl: "",
    primary: "#10B981",
    secondary: "#1E293B",
    accent: "#F59E0B",
    customCss: "",
    messageQuotaPerMonth: 10000,
    contactLimit: 1000,
    agentLimit: 5,
    aiCreditsPerMonth: 1000,
    partnerModel: "RESELLER" as PartnerModel,
    partnerMarginEnabled: false,
  });

  async function load() {
    if (!id) return;
    setErr(null);
    try {
      const data = await api.get<TenantDetail>(`/api/v1/tenants/${id}`);
      setTenant(data);
      const colors = parseColors(data.brandColors);
      setForm({
        name: data.name,
        status: data.status,
        domain: data.domain ?? "",
        logoUrl: data.logoUrl ?? "",
        primary: colors.primary ?? "#10B981",
        secondary: colors.secondary ?? "#1E293B",
        accent: colors.accent ?? "#F59E0B",
        customCss: data.customCss ?? "",
        messageQuotaPerMonth: data.messageQuotaPerMonth,
        contactLimit: data.contactLimit,
        agentLimit: data.agentLimit,
        aiCreditsPerMonth: data.aiCreditsPerMonth,
        partnerModel: data.partnerModel ?? "RESELLER",
        partnerMarginEnabled: data.partnerMarginEnabled,
      });
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load tenant");
    }
  }

  async function loadFeatures() {
    if (!id) return;
    try {
      const [reg, current] = await Promise.all([
        api.get<Array<{ key: string; label: string }>>(
          "/api/v1/admin/features/registry",
        ),
        api.get<{ features: Record<string, boolean> }>(
          `/api/v1/admin/tenants/${id}/features`,
        ),
      ]);
      setFeatureRegistry(reg);
      setFeatures(current.features);
    } catch {
      // Non-fatal — UI just doesn't show the section
    }
  }

  async function toggleFeature(key: string) {
    const next = !features[key];
    setFeatureSaving(true);
    try {
      const result = await api.patch<{ features: Record<string, boolean> }>(
        `/api/v1/admin/tenants/${id}/features`,
        { features: { [key]: next } },
      );
      setFeatures(result.features);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to toggle feature");
    } finally {
      setFeatureSaving(false);
    }
  }

  /**
   * Loads every credit line ever issued to this tenant — the
   * service-layer partial UNIQUE keeps only one ACTIVE row, but
   * we want the full history for the audit panel.
   */
  async function loadCreditLines() {
    if (!id) return;
    try {
      const lines = await api.get<CreditLine[]>(
        `/api/v1/admin/credit-lines?tenantId=${id}&limit=50`,
      );
      setCreditLines(lines);
    } catch {
      setCreditLines([]);
    }
  }

  async function openCreditLine() {
    if (!id) return;
    const limit = Number(newLineLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      setErr("Limit must be a positive integer (credits).");
      return;
    }
    setCreditLineBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const body: Record<string, unknown> = {
        tenantId: id,
        limitCredits: limit,
      };
      if (newLineDueDate) {
        // datetime-local → ISO with timezone; gateway accepts both.
        body.dueDate = new Date(newLineDueDate).toISOString();
      }
      if (newLineNotes.trim()) body.notes = newLineNotes.trim();
      await api.post("/api/v1/admin/credit-lines", body);
      setInfo("Credit line opened. Wallet flipped to POSTPAID.");
      setNewLineLimit("");
      setNewLineDueDate("");
      setNewLineNotes("");
      await loadCreditLines();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to open credit line.",
      );
    } finally {
      setCreditLineBusy(false);
    }
  }

  async function transitionCreditLine(
    lineId: string,
    kind: "suspend" | "reactivate" | "close",
  ) {
    setCreditLineBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await api.post(`/api/v1/admin/credit-lines/${lineId}/${kind}`, {});
      setInfo(
        kind === "close"
          ? "Credit line closed. Wallet reset to PREPAID."
          : kind === "suspend"
            ? "Credit line suspended. Wallet temporarily PREPAID."
            : "Credit line reactivated. Wallet back to POSTPAID.",
      );
      await loadCreditLines();
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : `Failed to ${kind} credit line.`,
      );
    } finally {
      setCreditLineBusy(false);
    }
  }

  useEffect(() => {
    if (user && id) {
      load();
      loadFeatures();
      loadCreditLines();
    }
  }, [user, id]);

  if (authLoading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  if (!tenant && !err) return <div className="p-10 text-sm text-slate-500">Loading tenant…</div>;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        status: form.status,
        domain: form.domain || undefined,
        logoUrl: form.logoUrl || undefined,
        brandColors: {
          primary: form.primary,
          secondary: form.secondary,
          accent: form.accent,
        },
        customCss: form.customCss || undefined,
        messageQuotaPerMonth: form.messageQuotaPerMonth,
        contactLimit: form.contactLimit,
        agentLimit: form.agentLimit,
        aiCreditsPerMonth: form.aiCreditsPerMonth,
      };
      if (tenant?.type === "WHITE_LABEL") {
        payload.partnerModel = form.partnerModel;
        payload.partnerMarginEnabled = form.partnerMarginEnabled;
      }
      await api.patch(`/api/v1/tenants/${id}`, payload);
      setInfo("Tenant updated.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function suspend() {
    if (!id || !tenant) return;
    if (!confirm(`Suspend ${tenant.name}? Users will be locked out.`)) return;
    try {
      await api.patch(`/api/v1/tenants/${id}`, { status: "SUSPENDED" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Suspend failed");
    }
  }

  async function activate() {
    if (!id) return;
    try {
      await api.patch(`/api/v1/tenants/${id}`, { status: "ACTIVE" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Activate failed");
    }
  }

  async function softDelete() {
    if (!id || !tenant) return;
    if (!confirm(`Soft-delete ${tenant.name}? This sets status to DELETED.`)) return;
    try {
      await api.delete(`/api/v1/tenants/${id}`);
      router.push("/tenants");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Delete failed");
    }
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/tenants" className="text-sm text-slate-500 hover:underline">
            ← Tenants
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{tenant?.name ?? "Tenant"}</h1>
          <p className="text-sm text-slate-500">
            {tenant?.type} · created {tenant && new Date(tenant.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          {tenant?.status === "ACTIVE" && (
            <button
              onClick={async () => {
                if (!tenant?.id) return;
                const reason = window.prompt(
                  "Reason for impersonating this tenant (audit log):",
                  "",
                );
                if (reason === null) return; // cancelled
                try {
                  await startImpersonation({
                    targetTenantId: tenant.id,
                    reason: reason.trim() || undefined,
                  });
                  // Hard reload — every component needs to re-read the
                  // new (impersonation) token from localStorage.
                  window.location.href = "/dashboard";
                } catch (e) {
                  const msg =
                    e instanceof Error ? e.message : "Failed to impersonate";
                  setErr(msg);
                }
              }}
              className="rounded-md border border-purple-300 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100"
              title="Step into this tenant as their BUSINESS_ADMIN to debug. All actions audited; destructive ops blocked."
            >
              👁 Impersonate
            </button>
          )}
          {tenant?.status === "ACTIVE" ? (
            <button
              onClick={suspend}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              Suspend
            </button>
          ) : tenant?.status === "SUSPENDED" ? (
            <button
              onClick={activate}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Reactivate
            </button>
          ) : null}
          <button
            onClick={softDelete}
            className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </header>

      {tenant?._count && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBox label="Users" value={tenant._count.users} />
          <StatBox label="Contacts" value={tenant._count.contacts} />
          <StatBox label="Campaigns" value={tenant._count.campaigns} />
          <StatBox label="Conversations" value={tenant._count.conversations} />
        </div>
      )}

      {info && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {info}
        </div>
      )}
      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            Identity
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tenant name">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="input"
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="DELETED">Deleted</option>
              </select>
            </Field>
            <Field label="Custom domain">
              <input
                value={form.domain}
                onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                className="input"
                placeholder="app.example.com"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">
            White-label branding
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Applied to the tenant's portal and outbound emails.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Logo URL">
              <input
                value={form.logoUrl}
                onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                className="input"
                placeholder="https://…/logo.png"
              />
            </Field>
            <div /> {/* spacer */}
            <Field label="Primary color">
              <ColorInput
                value={form.primary}
                onChange={(v) => setForm((f) => ({ ...f, primary: v }))}
              />
            </Field>
            <Field label="Secondary color">
              <ColorInput
                value={form.secondary}
                onChange={(v) => setForm((f) => ({ ...f, secondary: v }))}
              />
            </Field>
            <Field label="Accent color">
              <ColorInput
                value={form.accent}
                onChange={(v) => setForm((f) => ({ ...f, accent: v }))}
              />
            </Field>
            <div /> {/* spacer */}
            <div className="md:col-span-2">
              <BrandPreview
                logoUrl={form.logoUrl}
                primary={form.primary}
                secondary={form.secondary}
                accent={form.accent}
                tenantName={form.name}
              />
            </div>
            <div className="md:col-span-2">
              <Field
                label="Custom CSS"
                hint="Optional. Applied at the bottom of the cascade for fine-tuning."
              >
                <textarea
                  rows={4}
                  value={form.customCss}
                  onChange={(e) => setForm((f) => ({ ...f, customCss: e.target.value }))}
                  className="input font-mono text-xs"
                  placeholder=".nx-sidebar { background: var(--brand-primary); }"
                />
              </Field>
            </div>
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
                value={form.messageQuotaPerMonth}
                onChange={(e) =>
                  setForm((f) => ({ ...f, messageQuotaPerMonth: Number(e.target.value) }))
                }
                className="input"
              />
            </Field>
            <Field label="Contact limit">
              <input
                type="number"
                min={0}
                value={form.contactLimit}
                onChange={(e) => setForm((f) => ({ ...f, contactLimit: Number(e.target.value) }))}
                className="input"
              />
            </Field>
            <Field label="Agent limit">
              <input
                type="number"
                min={0}
                value={form.agentLimit}
                onChange={(e) => setForm((f) => ({ ...f, agentLimit: Number(e.target.value) }))}
                className="input"
              />
            </Field>
            <Field label="AI credits / month">
              <input
                type="number"
                min={0}
                value={form.aiCreditsPerMonth}
                onChange={(e) =>
                  setForm((f) => ({ ...f, aiCreditsPerMonth: Number(e.target.value) }))
                }
                className="input"
              />
            </Field>
          </div>
        </section>

        {tenant?.type === "WHITE_LABEL" && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">
              Partner commercial model
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Controls how this white-label partner funds customers and how partner
              margin is shown in billing reports.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Partner model"
                hint="Reseller uses platform-owned WABA, BYO Meta uses partner-owned provider credentials, Hybrid supports both."
              >
                <select
                  value={form.partnerModel}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      partnerModel: e.target.value as PartnerModel,
                    }))
                  }
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
                    Allows partner-funded wallets and includes agency profit in
                    partner billing dashboards.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={form.partnerMarginEnabled}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      partnerMarginEnabled: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4"
                />
              </label>
            </div>
          </section>
        )}

        {featureRegistry.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">
              Feature flags
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Toggle features per tenant. Disabled features return 403 to API
              calls and are hidden from the tenant's UI.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {featureRegistry.map((f) => {
                const on = features[f.key] !== false;
                return (
                  <label
                    key={f.key}
                    className={`flex cursor-pointer items-center justify-between rounded-md border p-3 text-sm transition-colors ${
                      on
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="font-medium">{f.label}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {f.key}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={featureSaving}
                      onChange={() => toggleFeature(f.key)}
                      className="h-4 w-4"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {tenant?.subscriptions && tenant.subscriptions.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
              Subscriptions
            </h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {tenant.subscriptions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{s.plan.displayName}</div>
                    <div className="text-xs text-slate-500">
                      Renews {new Date(s.currentPeriodEnd).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
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
            {busy ? "Saving…" : "Save changes"}
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
          background: white;
        }
        .input:focus {
          outline: none;
          border-color: rgb(16 185 129);
          box-shadow: 0 0 0 1px rgb(16 185 129);
        }
      `}</style>

      <section className="mt-8 rounded-lg border border-purple-200 bg-purple-50/40 p-5">
        <header className="mb-4">
          <h2 className="text-sm font-semibold text-purple-900">
            Postpaid credit line
          </h2>
          <p className="mt-0.5 text-xs text-purple-800">
            Only one ACTIVE line per tenant. Opening flips the wallet to
            POSTPAID with this limit; closing or suspending resets it.
          </p>
        </header>

        {(() => {
          const active = creditLines.find((l) => l.status === "ACTIVE");
          if (!active) {
            return (
              <div className="rounded-md border border-purple-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-purple-700">
                  No active credit line
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Open a new line below. The wallet stays PREPAID until you do.
                </p>
              </div>
            );
          }
          return (
            <div className="rounded-md border border-purple-300 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-purple-700">
                    Active
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {active.limitCredits.toLocaleString("en-IN")} credits limit
                  </p>
                  <p className="text-xs text-slate-500">
                    Opened {new Date(active.openedAt).toLocaleDateString()}
                    {active.dueDate
                      ? ` · due ${new Date(active.dueDate).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void transitionCreditLine(active.id, "suspend")}
                    disabled={creditLineBusy}
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Suspend
                  </button>
                  <button
                    type="button"
                    onClick={() => void transitionCreditLine(active.id, "close")}
                    disabled={creditLineBusy}
                    className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
              </div>
              {active.notes && (
                <p className="mt-2 text-xs italic text-slate-600">
                  {active.notes}
                </p>
              )}
            </div>
          );
        })()}

        {!creditLines.some((l) => l.status === "ACTIVE") && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wide text-purple-900">
                Limit (credits)
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={newLineLimit}
                onChange={(e) => setNewLineLimit(e.target.value)}
                className="mt-1 w-full rounded-md border border-purple-200 bg-white px-3 py-2 text-sm"
                placeholder="100000"
                disabled={creditLineBusy}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wide text-purple-900">
                Due date (optional)
              </span>
              <input
                type="datetime-local"
                value={newLineDueDate}
                onChange={(e) => setNewLineDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-purple-200 bg-white px-3 py-2 text-sm"
                disabled={creditLineBusy}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-purple-900">
                Notes (audit trail — e.g. "Enterprise contract #1234")
              </span>
              <textarea
                value={newLineNotes}
                onChange={(e) => setNewLineNotes(e.target.value)}
                rows={2}
                maxLength={1024}
                className="mt-1 w-full rounded-md border border-purple-200 bg-white px-3 py-2 text-sm"
                disabled={creditLineBusy}
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => void openCreditLine()}
                disabled={creditLineBusy || !newLineLimit}
                className="rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-600 disabled:opacity-50"
              >
                {creditLineBusy ? "Working…" : "Open credit line"}
              </button>
            </div>
          </div>
        )}

        {creditLines.filter((l) => l.status !== "ACTIVE").length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              History
            </h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
              {creditLines
                .filter((l) => l.status !== "ACTIVE")
                .map((line) => (
                  <li
                    key={line.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <div>
                      <span
                        className={`mr-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          line.status === "SUSPENDED"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {line.status}
                      </span>
                      <span className="font-medium text-slate-900">
                        {line.limitCredits.toLocaleString("en-IN")} credits
                      </span>
                      <span className="ml-2 text-slate-500">
                        opened{" "}
                        {new Date(line.openedAt).toLocaleDateString()}
                        {line.closedAt
                          ? ` · closed ${new Date(line.closedAt).toLocaleDateString()}`
                          : line.suspendedAt
                            ? ` · suspended ${new Date(line.suspendedAt).toLocaleDateString()}`
                            : ""}
                      </span>
                    </div>
                    {line.status === "SUSPENDED" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void transitionCreditLine(line.id, "reactivate")
                          }
                          disabled={creditLineBusy}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void transitionCreditLine(line.id, "close")
                          }
                          disabled={creditLineBusy}
                          className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-md border border-slate-300"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input font-mono text-xs"
      />
    </div>
  );
}

function BrandPreview({
  logoUrl,
  primary,
  secondary,
  accent,
  tenantName,
}: {
  logoUrl: string;
  primary: string;
  secondary: string;
  accent: string;
  tenantName: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Live preview
      </div>
      <div
        className="rounded-md p-4 text-sm"
        style={{ background: secondary, color: "white" }}
      >
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="logo"
              className="h-8 w-8 rounded bg-white object-contain p-1"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded text-sm font-bold"
              style={{ background: primary, color: "white" }}
            >
              {tenantName.charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <span className="font-semibold">{tenantName || "Tenant name"}</span>
        </div>
        <button
          type="button"
          className="mt-3 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ background: primary, color: "white" }}
        >
          Primary CTA
        </button>
        <button
          type="button"
          className="ml-2 mt-3 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ background: accent, color: "white" }}
        >
          Accent
        </button>
      </div>
    </div>
  );
}
